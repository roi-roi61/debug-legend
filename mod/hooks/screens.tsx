import { atom, read, update } from 'claude-code'
import type { RenderElement, RenderInput } from 'claude-code'

import type { JobId, SaveData, SlotId, Tab } from '../types'
import type { Toggle, Volume } from './actions'
import { challenge, changeVolume, chooseJob, cycleLanguage, decide, dismissAway, dismissShare, evolveHero, greetShop, openPane, pressLamp, summaryLines, toggleSetting, visitMine, visitNightMarket } from './actions'
import { syncBgm } from './audio'
import { intentUrl, momentText, statusText } from './share'
import { auraFor, enemyFigure, enemyFigureById, heroFigure, heroTitle, itemName, plusColor, rarityColor, rarityName } from './art'
import { attackSeconds, bossHpLeft, canEvolve, heroHpNow, hitDamage, hpTimeline, isFarming, isJobUnlocked, jobCooldownLeft, killRate, nextEvolutionLevel, retryIn, stageProgress, travelLeft } from './battle'
import { BALANCE, EVOLUTION, JOB_CHANGE, TIME, TRAVEL } from './config'
import { expToNext } from './fuel'
import { SLOTS, combatPower, effectiveItemPower } from './gear'
import type { $ } from './persist'
import { background, today } from './persist'
import { SCENE, bandSvg, battleScene, chestSvg, dropSvg, slotSvg } from './scene'
import { T, currentLanguage } from './texts'
import { buildLabel } from './build'
import { isNew, isUnlocked, READY } from './calendar'
import { calendarTab, hasMissions, rankLines, tabHasNew, tabHasNotice } from './daily-screens'
import { hasGather, gatherHasNotice, gatherTab } from './mine-screen'
import { hasTown, townTab } from './shop-screen'
import { hasPets, petsTab } from './pet-screen'
import { petFigures } from './pet-art'
import { activePets } from './pets'
import { note } from './debuglog'
import { psychicTab } from './psychic-screen'
import { ADVANCED_JOBS, BOSS_STAGE, WAVE, stageGroup, waveSlot, waveView } from './world'

// 入力欄の上の帯（簡素）と、サイドの広い画面（派手）。
// デスクトップ・スマホは Svg の絵、ターミナルは文字だけ。

const saveView = atom({ plugin: 'debug-legend', key: 'save' } as const, null)
const problem = atom({ plugin: 'debug-legend', key: 'problem' } as const, null)
const tabAtom = atom({ plugin: 'debug-legend', key: 'tab' } as const, 'battle')
const jobChoice = atom({ plugin: 'debug-legend', key: 'jobChoice' } as const, null)
const jobSection = atom({ plugin: 'debug-legend', key: 'jobSection' } as const, 'job')
const workingState = atom({ plugin: 'debug-legend', key: 'isWorking' } as const, false)

const TABS: readonly Tab[] = ['battle', 'gear', 'job', 'town', 'gather', 'pets', 'calendar', 'status', 'settings']

function bar(ratio: number, width = 10): string {
  const filled = Math.max(0, Math.min(width, Math.round(ratio * width)))

  return '■'.repeat(filled) + '□'.repeat(width - filled)
}

const isBossStage = (save: SaveData): boolean => save.stage.stage >= BOSS_STAGE && !save.isCleared

/**
 * 帯の「▶ STAGE 2-3」を出すか: 移動中（ボスに負けて章の面をめぐって稼ぐときの移動も）と、新しいステージに着いて 4 秒以内
 */
function isFreshStage(save: SaveData, isBusy: boolean): boolean {
  if (travelLeft(save) > 0) {
    return true
  }
  const speed = isBusy ? TIME.workingMultiplier : 1
  if (isBossStage(save)) {
    return (TRAVEL.seconds + save.stage.bossTime) / speed < 4
  }

  return save.stage.kills < 1 && (TRAVEL.seconds + save.stage.kills / Math.max(1e-6, killRate(save))) / speed < 4
}

const expPercent = (save: SaveData): number => Math.floor((save.exp / expToNext(save.level)) * 100)

function stageLine(save: SaveData): string {
  const ratio = isBossStage(save) ? bossHpLeft(save) : stageProgress(save)

  return `${T.stageName(save.stage.chapter, save.stage.stage)} ${bar(ratio)} ${Math.floor(ratio * 100)}%`
}

// ---- 帯 ----

export async function drawBand($: $, e: RenderInput<'AbovePrompt'>) {
  const save = await read($, saveView)
  const why = await read($, problem)
  const isBusy = e.props.isWorking
  const { Box, Button, Text } = $.ui.resolve(e)

  if (why !== null) {
    return <Text dimColor>{T.paused(why)}</Text>
  }
  if (save === null) {
    return undefined
  }
  const open = <Button key="open" label={T.openPane} hotkey="o" onPress={() => background(openPane($))} />
  const isFolded = save.settings.isBandFolded
  const fold = <Button key="fold" label={isFolded ? T.unfold : T.fold} plain dimColor onPress={() => toggleSetting($, 'isBandFolded')} />
  if (isFolded) {
    return (
      <Box flexDirection="row" gap={1}>
        <Text color="#ffd60a">{T.bandFolded(save.level, save.lamps)}</Text>
        {save.away !== null && <Text dimColor>{T.awayTitle(Math.round(save.away.ms / 60_000))}</Text>}
        {open}
        {fold}
      </Box>
    )
  }
  const away = save.away
  const awayLine =
    away === null ? null : (
      <Box flexDirection="row" gap={1}>
        <Text color="#ffd60a">
          {T.awayTitle(Math.round(away.ms / 60_000))} {T.awayLine(away.levels, away.stages, Math.floor(away.exp), away.gold)}
        </Text>
        <Button key="away-ok" label={T.awayOk} onPress={() => dismissAway($)} />
      </Box>
    )

  if (e.surface === 'terminal') {
    return (
      <Box flexDirection="row" gap={2}>
        <Text>{stageLine(save)}</Text>
        <Text bold>
          {T.levelLine(save.level)} {T.bandExp(expPercent(save))}
        </Text>
        <Text color="#ffd60a" bold>
          {T.drops(save.lamps)}
        </Text>
        {isBusy && <Text dimColor>{T.working}</Text>}
        {open}
        {fold}
        {awayLine}
      </Box>
    )
  }

  const { Svg } = $.ui.resolve(e)
  const hero = heroFigure(save.job, save.evolution)
  // 帯には、いま戦っている敵（群れのうちまだ倒していない先頭）を出す
  const frontId = stageGroup(save.stage.chapter, save.stage.stage)[Math.floor(save.stage.kills + 1e-9)]
  const enemy = frontId === undefined ? enemyFigure(save.stage.chapter, save.stage.stage) : enemyFigureById(save.stage.chapter, frontId, false)
  // 帯は小さく: 主人公の高さを 48px（作業中は 32px）に縮めて出す
  const height = isBusy ? 32 : 48
  // 移動中は、主人公が小さく走り、着いたら敵が出る（移動の残り、実時間の秒）
  const shared = (await read($, workingState)) ? TIME.workingMultiplier : 1
  const source = bandSvg(hero, enemy, isBusy, heroHpNow(save), travelLeft(save) / shared, petFigures(activePets(save))[0])
  const ratio = height / Math.max(hero.h * hero.scale, enemy.h * enemy.scale)
  const width = Math.round((hero.w * hero.scale + 24 + enemy.w * enemy.scale) * ratio)

  return (
    <Box flexDirection="row" alignItems="center" gap={1}>
      <Svg source={source} alt={T.battleAlt(enemy.name)} width={width} height={height} isInteractive />
      <Box flexDirection="column">
        {isFreshStage(save, isBusy) ? (
          <Text bold color="#ffd60a">
            {T.bandNext(save.stage.chapter, save.stage.stage)}
          </Text>
        ) : (
          <Text>{stageLine(save)}</Text>
        )}
        <Box flexDirection="row" gap={1}>
          <Text bold>{T.levelLine(save.level)}</Text>
          <Text dimColor>{T.bandExp(expPercent(save))}</Text>
          <Text color="#ffd60a" bold>
            {T.drops(save.lamps)}
          </Text>
          {isBusy && <Text dimColor>{T.working}</Text>}
        </Box>
        {awayLine}
      </Box>
      {open}
      {fold}
    </Box>
  )
}

// ---- サイド画面 ----

type Els = ReturnType<$['ui']['resolve']>

/** 前に描いたサイド画面（記録用） */
let lastDrawn = ''

export async function drawPane($: $, e: RenderInput<'Pane'>) {
  const save = await read($, saveView)
  const why = await read($, problem)
  const current = await read($, tabAtom)
  const choice = await read($, jobChoice)
  const { Box, Button, Link, Text } = $.ui.resolve(e)
  const now = await $.clock.now()
  const day = await today($)

  if (why !== null) {
    return <Text>{T.paused(why)}</Text>
  }
  if (save === null) {
    return <Text dimColor>…</Text>
  }
  // 描き直しの記録（映しているセーブの様子が変わったときだけ）: どのタブを、どの画面で描いたか。
  // 撃破のあとに render が無ければ、サイド画面が描き直されていない（隠れている、など）
  const drawn = `${current}-${e.surface}-${save.lastTickAt}`
  if (drawn !== lastDrawn) {
    lastDrawn = drawn
    note(now, 'render', `${current} ${e.surface} ${save.stage.chapter}-${save.stage.stage} ${isBossStage(save) ? `ボス ${save.stage.bossTime.toFixed(1)}s` : `撃破 ${save.stage.kills.toFixed(2)}`}`)
  }

  const tabs = (
    <Box flexDirection="row" flexWrap="wrap" gap={1}>
      {TABS.filter(id => (id !== 'town' || hasTown(save)) && (id !== 'gather' || hasGather(save)) && (id !== 'pets' || hasPets(save))).map((id, i) => (
        <Button
          key={`tab-${id}`}
          label={tabHasNew(save, id) || (id === 'job' && isNew(save, 'psychic')) ? `${T.tabs[id]} ${T.unlockNew}` : tabHasNotice(save, id, day, now) || (id === 'gather' && gatherHasNotice(save, now)) ? `${T.tabs[id]} !` : T.tabs[id]}
          hotkey={String(i + 1)}
          variant={id === current ? 'primary' : 'secondary'}
          onPress={async () => {
            await update($, tabAtom, () => id)
            await syncBgm($)
            if (id === 'town') {
              // その日はじめて街に来たら、店主にあいさつ（好感度 +2）
              background(greetShop($))
              // 闇市を開いたまま街に戻ったときも、来店の印を書く（開いていなければ何もしない）
              background(visitNightMarket($))
            }
            if (id === 'gather') {
              // 鉱山: 日付が変わっていれば今日の分に切り替え、階を作っておく
              background(visitMine($))
            }
          }}
        />
      ))}
    </Box>
  )

  // Lv・戦闘力・経験値は、どのタブでもいちばん上に出す（下だと画面の高さによって切れるため）
  const power = combatPower(save)
  const need = expToNext(save.level)
  const status = (
    <Box flexDirection="column">
      <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
        <Text bold>{T.levelLine(save.level)}</Text>
        <Text>{heroTitle(save.job, save.evolution)}</Text>
        <Text bold>{T.power(power)}</Text>
        <Text color="#ffd60a">{T.drops(save.lamps)}</Text>
        {save.titles.current === null ? null : <Text dimColor>〔{T.titleName[save.titles.current] ?? save.titles.current}〕</Text>}
      </Box>
      <Text>
        {bar(save.exp / need, 20)} {T.expLine(Math.floor(save.exp), need)}
      </Text>
    </Box>
  )

  let body
  if (current === 'gear') {
    body = gearTab($, e, save)
  } else if (current === 'job') {
    body = await jobTab($, $.ui.resolve(e), save, choice, now, day)
  } else if (current === 'pets' && hasPets(save)) {
    body = await petsTab($, $.ui.resolve(e), save)
  } else if (current === 'status') {
    const percent = Math.floor(stageProgress(save) * 100)
    body = (
      <Box flexDirection="column">
        {summaryLines(save, day, expToNext(save.level), percent).map(line => (
          <Text>{line}</Text>
        ))}
        {hasMissions(save) ? rankLines(save).map(line => <Text>{line}</Text>) : null}
        <Link href={intentUrl(statusText(save))} label={T.shareStatusLink} />
        <Text dimColor>{T.buildLine(buildLabel())}</Text>
      </Box>
    )
  } else if (current === 'town' && hasTown(save)) {
    body = await townTab($, $.ui.resolve(e), save)
  } else if (current === 'gather' && hasGather(save)) {
    body = await gatherTab($, $.ui.resolve(e), save, e.surface === 'terminal')
  } else if (current === 'calendar') {
    const els = $.ui.resolve(e)
    body = await calendarTab($, els, save, { Svg: 'Svg' in els ? els.Svg : undefined, isWide: e.props.bodyColumns * 7 >= 680 })
  } else if (current === 'settings') {
    body = settingsTab($, $.ui.resolve(e), save)
  } else {
    body = battleTab($, e, save, now, await read($, workingState))
  }

  return (
    <Box flexDirection="column" gap={1}>
      {status}
      {tabs}
      {body}
    </Box>
  )
}

/** ランプのボタンと、確認待ちの「装備する / 売る」 */
function lampControls($: $, els: Els, save: SaveData) {
  const { Box, Button, Text } = els
  const pending = save.pending
  if (pending !== null) {
    const diff = pending.power - (save.equipment[pending.slot]?.power ?? 0)
    return (
      <Box flexDirection="column" alignItems="center">
        <Text color={rarityColor(pending.rarity)}>{T.pendingLine(`${rarityName(pending.rarity)} ${itemName(pending)}`, pending.power, diff)}</Text>
        <Box flexDirection="row" gap={1}>
          <Button key="equip" label={T.equipNow} hotkey="e" variant="primary" onPress={() => decide($, 'equip')} />
          <Button key="sell" label={T.sellNow} hotkey="s" onPress={() => decide($, 'sell')} />
        </Box>
      </Box>
    )
  }
  if (save.lamps <= 0) {
    return <Text dimColor>{T.lampEmpty}</Text>
  }

  return <Button key="lamp" label={T.lamp(save.lamps)} hotkey="l" variant="primary" onPress={() => pressLamp($)} />
}

function lastDropLine(els: Els, save: SaveData) {
  const { Text } = els
  const drop = save.lastDrop
  if (drop === null) {
    return <Text dimColor>{T.noDrop}</Text>
  }

  return (
    <Text color={rarityColor(drop.item.rarity)}>
      {T.dropLine(rarityName(drop.item.rarity), itemName(drop.item), drop.item.power)} {T.dropAction[drop.action](drop.gold)}
    </Text>
  )
}

/** 戦闘画面の Svg を、同じ中身のあいだは使い回す（HP バーの値を描いたときのままにして、10 秒ごとに作り直さないため） */
const HP_RESYNC_MS = 30_000
const scenes = new Map<string, ReturnType<typeof battleScene>>()

let lastKey = ''

function cachedScene(key: string, now: number, make: () => ReturnType<typeof battleScene>): ReturnType<typeof battleScene> {
  const hit = scenes.get(key)
  if (key !== lastKey) {
    // 戦闘画面の Svg が入れ替わるとき（新しく作った / 前に作ったものを使った）を記録する
    note(now, 'scene', `${hit === undefined ? '作成' : '再利用'} ${key}`)
    lastKey = key
  }
  if (hit !== undefined) {
    return hit
  }
  const scene = make()
  scenes.set(key, scene)
  while (scenes.size > 8) {
    const oldest = scenes.keys().next().value
    if (oldest === undefined) {
      break
    }
    scenes.delete(oldest)
  }

  return scene
}

function battleTab($: $, e: RenderInput<'Pane'>, save: SaveData, now: number, isWorking: boolean) {
  const els = $.ui.resolve(e)
  const { Box, Text } = els
  const damage = hitDamage(save)
  const attack = attackSeconds(save)

  if (e.surface === 'terminal') {
    return (
      <Box flexDirection="column" gap={1}>
        {awayBox($, els, save)}
        {shareBox($, els, save)}
        <Text bold>{stageLine(save)}</Text>
        {bossLine($, els, save)}
        <Text>{T.damageLine(damage, attack)}</Text>
        <Box flexDirection="column">
          {SLOTS.map(slot => slotText(els, save, slot))}
        </Box>
        {lastDropLine(els, save)}
        {lampControls($, els, save)}
      </Box>
    )
  }

  const { Svg } = $.ui.resolve(e)
  const hero = heroFigure(save.job, save.evolution)
  const aura = auraFor(save.job, save.evolution, hero.isStandIn)
  const enemy = enemyFigure(save.stage.chapter, save.stage.stage)
  const isBoss = isBossStage(save)
  const ratio = isBoss ? bossHpLeft(save) : stageProgress(save)
  const members = stageGroup(save.stage.chapter, save.stage.stage)
  const defeated = Math.floor(save.stage.kills + 1e-9)
  // 画面に出すのは、いまの波（3 匹ずつ）の残りだけ。位置は波の中の添字（0〜2）
  const wave = waveView(members, defeated)
  const group = wave.members.map(({ id, slot }) => ({ figure: enemyFigureById(save.stage.chapter, id, false), slot }))
  // ボスの登場の演出は、ボス戦が始まって 1.5 秒までの描き直しだけ（途中で宝箱を開けても最初からに見えないように）
  const isBossIntro = save.stage.bossTime < 1.5
  // 進化してから 8 秒以内の描き直しなら、進化の演出（光って大きくなる）を出す
  const isEvolving = save.share?.kind === 'evolve' && now - save.share.at < 8_000
  const speed = isWorking ? TIME.workingMultiplier : 1
  // 移動中（次の群れ・ボスのところまで）: 主人公が走り、背景が流れ、次の群れが歩いて入ってくる。実時間の秒にして渡す
  const travelNow = travelLeft(save)
  const travel = travelNow > 0 ? { elapsed: (TRAVEL.seconds - travelNow) / speed, total: TRAVEL.seconds / speed } : undefined
  // 倒れたばかりの敵（倒してから 1.5 秒以内）: 倒れる演出を 1 回出す。群れを全部倒して次の群れのところに来たときは、前の群れの最後の 1 匹
  // （群れの 1 匹目は、移動のぶん（移動した秒数）も足す）
  const progress = save.stage.kills - defeated
  const sinceKill = ((defeated === 0 ? TRAVEL.seconds - travelNow : 0) + progress / Math.max(1e-6, killRate(save))) / speed
  // 前の群れ: ボスに負けて稼いでいるときは面がとぶので、前にいた面（from）の群れ。無ければ 1 つ前の面
  const from = save.stage.from ?? save.stage.stage - 1
  const previous = from >= 1 ? stageGroup(save.stage.chapter, from) : []
  const fallenId = isBoss || sinceKill > 1.5 ? undefined : defeated > 0 ? members[defeated - 1] : previous[previous.length - 1]
  const fallen =
    fallenId === undefined
      ? undefined
      : { figure: enemyFigureById(save.stage.chapter, fallenId, false), ...(defeated > 0 ? waveSlot(members.length, defeated - 1) : waveSlot(previous.length, previous.length - 1)) }
  // 波を倒し終えて次の波になったとき（移動中でなく、倒してから 1.5 秒以内）: 次の波が右から短く歩いて入ってくる
  const waveIn = !isBoss && travel === undefined && defeated > 0 && defeated % WAVE === 0 && defeated < members.length && sinceKill <= 1.5
  const bossName = isBoss ? (T.enemy[enemy.id] ?? enemy.name) : undefined
  // ステージ移行の画面（移動の途中で暗転 → ステージ名 → 明けると次の群れ）: 新しいステージへ移動しているときだけ。章の 1 面目は章の名前。
  // ボスに負けて章の面をめぐって稼ぐときも、面が変わるので出す
  const cut =
    travel !== undefined
      ? save.stage.stage === 1
        ? { title: T.chapterCut(save.stage.chapter, T.chapterName[save.stage.chapter - 1] ?? ''), sub: T.stageCut(save.stage.chapter, 1) }
        : { title: T.stageCut(save.stage.chapter, save.stage.stage) }
      : undefined
  // いまの敵（ボス）との戦いが始まった時刻（戦闘の秒数。移動中なら移動が始まった時刻）。敵ごとに別の Svg にして、前の敵の Svg を使い回さない
  const fightStart =
    Math.round((save.battleSeconds - (travel !== undefined ? TRAVEL.seconds - travelNow : isBoss ? save.stage.bossTime : progress / Math.max(1e-6, killRate(save)))) * 10) / 10
  // 戦闘画面の中身（ダメージの数字・攻撃の速さ・絵）が変わったら、Svg を作り直して必ず新しい絵にする（装備を変えたのに数字が古いままにならないように）
  // HP バーの動きは、Svg を作ったときの値から始まる。作り直すのは、敵を倒した・装備が変わった・作業中かどうかが変わったとき、
  // それと 30 秒ごと（ずれを直すため）だけ。10 秒ごとの描き直しでは同じ Svg を使い回す（重くならないように）
  // 一緒に戦うペット（遠征に出ているペットは除く）。形態が変わったら絵を作り直す
  const pets = petFigures(activePets(save))
  const sceneKey = `pets-${pets.map(p => p.id).join('+')}-scene-${save.stage.chapter}-${isBoss ? 'b' : `${save.stage.stage}-${defeated}`}@${fightStart}-${damage}-${attack}-${hero.id}-${aura?.level ?? 0}-${isEvolving ? 'e' : ''}${cut === undefined ? '' : 'c'}${travel === undefined ? '' : 't'}-${speed}-${Math.floor(now / HP_RESYNC_MS)}-${currentLanguage()}`
  const scene = cachedScene(sceneKey, now, () =>
    battleScene({ chapter: save.stage.chapter, hero, enemy, damage, isBoss, attack, aura, group, groupSize: wave.size, foesLeft: members.length - defeated, waveIn, isBossIntro, isEvolving, hp: hpTimeline(save, speed), bossName, fallen, cut, travel, pets }),
  )
  // 1 マスはおよそ 7px。入るなら 2 倍、入らなければ 1 倍で出す（整数倍でくっきり）
  const scale = e.props.bodyColumns * 7 >= 680 ? 2 : 1
  const slotColumn = (slots: readonly SlotId[]) => <Box flexDirection="column" gap={1}>{slots.map(slot => slotCell(els, Svg, save, slot))}</Box>

  return (
    <Box flexDirection="column" gap={1}>
      {awayBox($, els, save)}
      {shareBox($, els, save)}
      <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
        <Text bold>{T.stageName(save.stage.chapter, save.stage.stage)}</Text>
        <Text dimColor>{T.chapterName[save.stage.chapter - 1]}</Text>
        <Text color={isBoss ? '#ff4d6d' : undefined}>
          {isBoss ? `${T.bossHp} ` : ''}
          {bar(ratio, 20)} {Math.floor(ratio * 100)}%
        </Text>
        <Text dimColor>{enemy.name}</Text>
        <Text dimColor>{T.damageLine(damage, attack)}</Text>
      </Box>
      {bossLine($, els, save)}
      <Box key={sceneKey}>{sceneView(Box, Svg, scene, T.battleAlt(enemy.name), scale)}</Box>
      <Box flexDirection="row" justifyContent="center" gap={3}>
        {slotColumn(['weapon', 'head', 'body'])}
        <Box flexDirection="column" alignItems="center" gap={1}>
          <Box flexDirection="row" alignItems="flex-end" gap={1}>
            <Svg source={chestSvg(save.lamps)} alt={T.lampAlt(save.lamps)} width={64} height={64} isInteractive />
            {save.lastDrop !== null && (
              <Box key={`drop-${save.lastDrop.item.id}`}>
                <Svg source={dropSvg(save.lastDrop.item)} alt={itemName(save.lastDrop.item)} width={72} height={84} isInteractive />
              </Box>
            )}
          </Box>
          {lampControls($, els, save)}
          {lastDropLine(els, save)}
        </Box>
        {slotColumn(['arms', 'legs', 'charm'])}
      </Box>
    </Box>
  )
}

type SvgElement = Extract<Els, { Svg: unknown }>['Svg']

function slotCell(els: Els, Svg: SvgElement, save: SaveData, slot: SlotId) {
  const { Box, Text } = els
  const item = save.equipment[slot]

  return (
    <Box flexDirection="row" alignItems="center" gap={1}>
      <Svg source={slotSvg(slot, item)} alt={T.slot[slot]} width={40} height={40} isInteractive={item !== null && item.rarity >= 3 ? true : undefined} />
      <Box flexDirection="column">
        <Text dimColor>{T.slot[slot]}</Text>
        {item === null ? <Text dimColor>{T.emptySlot}</Text> : <Text color={plusColor(item)}>{T.comma(Math.round(effectiveItemPower(item)))}</Text>}
      </Box>
    </Box>
  )
}

function slotText(els: Els, save: SaveData, slot: SlotId) {
  const { Text } = els
  const item = save.equipment[slot]

  return item === null ? (
    <Text dimColor>
      [{T.slotGlyph[slot]}] {T.slot[slot]}: {T.emptySlot}
    </Text>
  ) : (
    <Text color={plusColor(item)}>
      [{T.slotGlyph[slot]}] {T.slot[slot]}: {rarityName(item.rarity)} {itemName(item)} {T.power(Math.round(effectiveItemPower(item)))}
    </Text>
  )
}

function gearTab($: $, e: RenderInput<'Pane'>, save: SaveData) {
  const els = $.ui.resolve(e)
  const { Box, Text } = els
  const total = SLOTS.reduce((sum, slot) => sum + (save.equipment[slot] === null ? 0 : effectiveItemPower(save.equipment[slot]!)), 0)

  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="column">
        {SLOTS.map(slot => slotText(els, save, slot))}
      </Box>
      <Text>
        {T.gearTotal(total)}　{T.gold(save.gold)}
      </Text>
      {lastDropLine(els, save)}
      {lampControls($, els, save)}
    </Box>
  )
}

/** オフライン報酬のお知らせ（OK で消える） */
function awayBox($: $, els: Els, save: SaveData) {
  const { Box, Button, Text } = els
  const away = save.away
  if (away === null) {
    return null
  }

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="#ffd60a" paddingX={1}>
      <Text bold color="#ffd60a">
        {T.awayTitle(Math.round(away.ms / 60_000))}
      </Text>
      <Text>{T.awayLine(away.levels, away.stages, Math.floor(away.exp), away.gold)}</Text>
      {(away.bossWins.length > 0 || away.bossLosses.length > 0) && <Text>{T.awayBoss(away.bossWins.length, away.bossLosses.length)}</Text>}
      <Button key="away-ok" label={T.awayOk} variant="primary" onPress={() => dismissAway($)} />
    </Box>
  )
}

/** ボス戦の残り時間、負けたあとの稼ぎ、全クリア */
function bossLine($: $, els: Els, save: SaveData) {
  const { Box, Button, Text } = els
  const bossName = T.enemy[enemyFigure(save.stage.chapter, BOSS_STAGE).id] ?? ''
  if (save.isCleared) {
    return <Text color="#ffd60a">{T.cleared}</Text>
  }
  if (isBossStage(save)) {
    return <Text color="#ff4d6d">{T.bossFight(bossName, Math.max(0, Math.ceil(BALANCE.bossSeconds - save.stage.bossTime)))}</Text>
  }
  if (isFarming(save)) {
    return (
      <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
        <Text color="#ff9592">{T.bossLost(bossName)}</Text>
        <Text dimColor>{T.bossRetryIn(Math.ceil(retryIn(save) / 60))}</Text>
        <Button key="challenge" label={T.bossChallenge} hotkey="b" onPress={() => challenge($)} />
      </Box>
    )
  }

  return null
}

async function jobTab($: $, els: Els, save: SaveData, choice: JobId | null, now: number, day: string): Promise<RenderElement> {
  const { Box, Button, Text } = els
  const title = heroTitle(save.job, save.evolution)
  const next = nextEvolutionLevel(save)
  const nextName = T.evolutionName[save.evolution + 1] ?? ''
  const evolution = (
    <Box flexDirection="column">
      <Text bold>{T.evoTitle}</Text>
      <Text>{save.evolution === 0 ? T.evoNone : T.evoNow(T.evolutionName[save.evolution] ?? '')}</Text>
      {next === undefined ? (
        <Text color="#ffd60a">{T.evoMax}</Text>
      ) : (
        <Box flexDirection="column">
          <Text>{T.evoNext(nextName, next, save.level)}</Text>
          <Text dimColor>{T.evoEffect(EVOLUTION.powerRate[save.evolution + 1] ?? 1)}</Text>
          {canEvolve(save) && <Button key="evolve" label={T.evoReady(nextName)} variant="primary" onPress={() => evolveHero($)} />}
          {save.job === 'novice' && save.level >= next && <Text color="#ff9592">{T.evoNeedJob}</Text>}
        </Box>
      )}
    </Box>
  )
  const jobUnlocked = isJobUnlocked(save)
  const cooldown = jobCooldownLeft(save, now)
  const psychicOpen = READY.has('psychic') && isUnlocked(save, 'psychic')
  const section = await read($, jobSection)
  const sections = (
    <Box flexDirection="row" gap={1}>
      <Button key="job-section-job" label={T.jobViews.job} variant={section === 'job' ? 'primary' : 'secondary'} onPress={() => update($, jobSection, () => 'job')} />
      {psychicOpen ? <Button key="job-section-psychic" label={T.jobViews.psychic} variant={section === 'psychic' ? 'primary' : 'secondary'} onPress={() => update($, jobSection, () => 'psychic')} /> : <Box />}
    </Box>
  )
  if (section === 'psychic' && psychicOpen) {
    return (
      <Box flexDirection="column" gap={1}>
        {sections}
        {await psychicTab($, els, save, day, now)}
      </Box>
    )
  }

  const jobs = (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="column">
        <Text bold>{T.jobNow(title)}</Text>
        <Text dimColor>{T.jobDescription[save.job]}</Text>
      </Box>
      {evolution}
      <Box flexDirection="column">
        <Text dimColor>{T.jobNote}</Text>
        {!jobUnlocked && <Text>{T.jobUntil(JOB_CHANGE.level, save.level)}</Text>}
        {jobUnlocked && cooldown > 0 && <Text dimColor>{T.jobCooldown(Math.ceil(cooldown / 60_000))}</Text>}
      </Box>
      {ADVANCED_JOBS.map(job => (
        <Box flexDirection="column">
          <Text bold>{T.heroTitle(T.evolutionName[save.evolution] ?? '', T.jobName[job])}</Text>
          <Text dimColor>{T.jobDescription[job]}</Text>
          {job === save.job ? (
            <Text color="#4cc38a">{T.jobSame}</Text>
          ) : (
            jobUnlocked &&
            cooldown === 0 &&
            (choice === job ? (
              <Box flexDirection="row" gap={1}>
                <Button
                  key={`job-ok-${job}`}
                  label={T.jobConfirm(T.jobName[job])}
                  variant="primary"
                  onPress={async () => {
                    if (await chooseJob($, job)) {
                      $.ui.toast(T.jobDone(T.jobName[job]))
                    }
                    await update($, jobChoice, () => null)
                  }}
                />
                <Button key={`job-cancel-${job}`} label={T.jobCancel} onPress={() => update($, jobChoice, () => null)} />
              </Box>
            ) : (
              <Button key={`job-${job}`} label={save.job === 'novice' ? T.jobPick : T.jobSwitch} onPress={() => update($, jobChoice, () => job)} />
            ))
          )}
        </Box>
      ))}
    </Box>
  )

  return (
    <Box flexDirection="column" gap={1}>
      {sections}
      {jobs}
    </Box>
  )
}

/** 転職・エピック以上のドロップ・ボス撃破のあと: X でポストするリンク（閉じるまで出しておく） */
function shareBox($: $, els: Els, save: SaveData) {
  const { Box, Button, Link, Text } = els
  const moment = save.share
  if (moment === null) {
    return null
  }

  return (
    <Box flexDirection="row" flexWrap="wrap" columnGap={1} borderStyle="round" borderColor="#4f8ef7" paddingX={1}>
      <Text bold color="#4f8ef7">
        {T.shareBanner[moment.kind]}
      </Text>
      <Text>{momentText(save, moment)}</Text>
      <Link href={intentUrl(momentText(save, moment))} label={T.shareLink} />
      <Button key="share-close" label={T.shareClose} plain dimColor onPress={() => dismissShare($)} />
    </Box>
  )
}

const TOGGLES: Record<'lamp' | 'notify' | 'sound' | 'screen', readonly Toggle[]> = {
  lamp: ['autoLamp', 'autoJudge', 'manualRareUp', 'keepForSmith'],
  notify: ['notifyEpic', 'notifyBoss', 'notifyUnlock'],
  sound: ['isMuted', 'windowsSound'],
  screen: ['isBandFolded', 'debugLog'],
}

const VOLUMES: readonly Volume[] = ['bgmVolume', 'seVolume']

function settingsTab($: $, els: Els, save: SaveData) {
  const { Box, Button, Text } = els
  const toggle = (key: Toggle) => <Button key={`set-${key}`} label={T.setting[key](save.settings[key])} onPress={() => toggleSetting($, key)} />
  const group = (id: keyof typeof TOGGLES, extra?: RenderElement) => (
    <Box flexDirection="column">
      <Text bold>{T.settingGroups[id]}</Text>
      {TOGGLES[id].map(toggle)}
      {extra}
    </Box>
  )
  const volumes = VOLUMES.map(key => (
    <Box flexDirection="row" gap={1} alignItems="center">
      <Text>{T.volume(T.volumeLabel[key], save.settings[key])}</Text>
      <Button key={`${key}-down`} label="−" onPress={() => changeVolume($, key, -1)} />
      <Button key={`${key}-up`} label="+" onPress={() => changeVolume($, key, 1)} />
    </Box>
  ))

  return (
    <Box flexDirection="column" gap={1}>
      {group('lamp')}
      {group('notify')}
      {group(
        'sound',
        <Box flexDirection="column">
          {volumes}
          <Text dimColor>{T.soundNote}</Text>
        </Box>,
      )}
      {group(
        'screen',
        <Button
          key="set-language"
          label={T.setting_language(T.languageName[save.settings.language], T.languageName[currentLanguage()])}
          onPress={() => cycleLanguage($)}
        />,
      )}
    </Box>
  )
}

/** 戦闘画面を描く。2 枚に分かれたときは、背景の上に戦闘の Svg を重ねる（位置 0, 0 の絶対配置） */
function sceneView(Box: Els['Box'], Svg: SvgElement, scene: ReturnType<typeof battleScene>, alt: string, scale: number) {
  const size = { width: SCENE.w * scale, height: SCENE.h * scale }
  if ('single' in scene) {
    return <Svg source={scene.single} alt={alt} {...size} isInteractive />
  }

  return (
    <Box position="relative">
      <Svg source={scene.back} alt={alt} {...size} />
      <Box position="absolute" top={0} left={0}>
        <Svg source={scene.front} alt={alt} {...size} isInteractive />
      </Box>
    </Box>
  )
}

