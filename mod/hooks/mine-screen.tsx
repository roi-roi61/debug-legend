import { atom, read, update } from 'claude-code'
import type { RenderElement } from 'claude-code'

import type { MineCell, MineHaul, SaveData } from '../types'
import { challengeMineBoss, digCell, moveMineFloor, replayIntro, toggleAutoMine, toggleBomb, upgradeMinePickaxe } from './actions'
import { READY, isNew, isUnlocked } from './calendar'
import { introBox } from './daily-screens'
import { TILE, mineMapSvg } from './mine-art'
import { mineBossFightSvg, tileSvg } from './mine-tiles'
import { heroFigure } from './art'
import {
  cellState,
  COLS,
  canGoToFloor,
  floorProgress,
  isBossFloor,
  isFloorDone,
  jumpFloors,
  DAILY_PICK_CAP,
  BOSS_PICKS,
  DIARY_COUNT,
  FOSSIL_COUNT,
  PICKAXES,
  ROWS,
  bossOutlook,
  bossType,
  canDig,
  floorOf,
  isAutoUnlocked,
  isBossPending,
  isGlimpse,
  layerOf,
  picksOf,
  upgradeCost,
} from './mine'
import type { $ } from './persist'
import { today } from './persist'
import { T } from './texts'
import { farmScreen } from './farm-screen'
import { goldMineScreen } from './goldmine-screen'
import { isBigFarmOpen, ranchReady } from './farm'
import { goldMineNeedsAttention, isGoldMineOpen } from './goldmine'

// 採集タブ（3 日目の鉱山。あとで農場・金山銀山が並ぶ）。文字とボタンだけの作り（絵とアニメはあとで）。

type Els = ReturnType<$['ui']['resolve']>

/** 採集タブで開いている施設 */
const gatherView = atom({ plugin: 'debug-legend', key: 'gatherView' } as const, 'mine')
/** 鉱山のボス戦の画面を出しているか（挑んだあと、戻るまで） */
const mineBossShown = atom({ plugin: 'debug-legend', key: 'mineBossShown' } as const, false)
/** 鉱山で読んでいる日記の番号（-1 = 閉じている） */
const mineDiary = atom({ plugin: 'debug-legend', key: 'mineDiary' } as const, -1)

/** 採集タブを出すか（鉱山が開いていて、遊べる） */
export const hasGather = (save: SaveData): boolean => READY.has('mine') && isUnlocked(save, 'mine')

/** 採集タブの「!」: 金山銀山のトロッコが満杯、または牧場の産物ができあがった */
export const gatherHasNotice = (save: SaveData, now: number): boolean => goldMineNeedsAttention(save, now) || ranchReady(save, now)

export async function gatherTab($: $, els: Els, save: SaveData, isTerminal = false): Promise<RenderElement> {
  const view = await read($, gatherView)
  const farmOpen = READY.has('farm') && isUnlocked(save, 'farm')
  const goldOpen = isGoldMineOpen(save)
  const bigOpen = isBigFarmOpen(save)
  const screen =
    view === 'goldmine' && goldOpen
      ? await goldMineScreen($, els, save)
      : view === 'ranch' && farmOpen && bigOpen
        ? await farmScreen($, els, save, 'ranch')
        : view === 'farm' || view === 'kitchen'
          ? (farmOpen ? await farmScreen($, els, save, view) : await mineView($, els, save, isTerminal))
          : await mineView($, els, save, isTerminal)
  const { Box, Button } = els

  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="row" flexWrap="wrap" gap={1}>
        <Button key="gather-view-mine" label={T.gatherView.mine} variant={view === 'mine' ? 'primary' : 'secondary'} onPress={() => update($, gatherView, () => 'mine')} />
        {farmOpen ? <Button key="gather-view-farm" label={T.gatherView.farm} variant={view === 'farm' ? 'primary' : 'secondary'} onPress={() => update($, gatherView, () => 'farm')} /> : null}
        {goldOpen ? <Button key="gather-view-goldmine" label={T.gatherView.goldmine} variant={view === 'goldmine' ? 'primary' : 'secondary'} onPress={() => update($, gatherView, () => 'goldmine')} /> : null}
        {farmOpen && bigOpen ? <Button key="gather-view-ranch" label={T.gatherView.ranch} variant={view === 'ranch' ? 'primary' : 'secondary'} onPress={() => update($, gatherView, () => 'ranch')} /> : null}
        {farmOpen ? <Button key="gather-view-kitchen" label={T.gatherView.kitchen} variant={view === 'kitchen' ? 'primary' : 'secondary'} onPress={() => update($, gatherView, () => 'kitchen')} /> : null}
      </Box>
      {screen}
    </Box>
  )
}

/** 文字列から決まった数 */
function pick(day: string, size: number): number {
  let hashValue = 0
  for (const ch of day) {
    hashValue = (hashValue * 31 + ch.charCodeAt(0)) >>> 0
  }

  return hashValue % Math.max(1, size)
}

/** 開いたマスの印 */
const openMark = (kind: string): string => T.mineMark[kind] ?? '・'

/** マスのラベル: まだ = 土 / 岩 / 硬 + 残りの回数、光って見える = ✦ + 残りの回数、開いた = 中身の 1 文字か ・ */
/** 出てきたものの絵（絵文字）。もう一度押すと受け取る */
const PRIZE_PICTURE: Record<string, string> = { ore: '🔶', gem: '💎', chest: '🎁', fossil: '🦴', spring: '💧', diary: '📜', monster: '⚔️' }

/**
 * マスの絵（絵文字のボタン。ボタンの並びがそのまま鉱山の絵になる）:
 * まだ = 🟫 土 / 🪨 岩 / ⬛ 硬い岩（2 回以上叩くマスは残りの回数つき）、光って見える = ✨、
 * 出てきたもの = 🔶 鉱石・💎 宝石・🎁 宝箱・🦴 化石・💧 泉・📜 日記・⚔️ 魔物の落とし物、🔽 階段、受け取ったあと = ・、生きている魔物 = 戦う
 */
function cellLabel(save: SaveData, index: number): string {
  const cell = floorOf(save).grid[index]
  if (cell === undefined) {
    return '・'
  }
  const { state, kind } = cellState(save, index)
  if (state === 'prize') {
    return PRIZE_PICTURE[kind] ?? '🎁'
  }
  if (state === 'stairs') {
    return '🔽'
  }
  if (state === 'monster') {
    return T.mineAct.fight
  }
  if (cell.open) {
    return '・'
  }
  const hits = cell.hp >= 2 ? String(cell.hp) : ''
  if (state === 'glimpse') {
    return `✨${hits}`
  }

  return `${cell.hp >= 3 ? '⬛' : cell.hp === 2 ? '🪨' : '🟫'}${hits}`
}

/** 手に入れたものの文 */
export function haulText(haul: MineHaul): string {
  const parts: string[] = []
  for (const flag of haul.flags) {
    if (flag === 'nothing') parts.push(T.mineNothing)
    else if (flag === 'win') parts.push(T.mineMonsterWin)
    else if (flag === 'lose') parts.push(T.mineMonsterLose)
    else if (flag === 'monster') parts.push(T.mineMonsterAppear)
    else if (flag === 'stairs') parts.push(T.mineFoundStairs)
    else if (flag === 'spring') parts.push(T.mineSpring(5))
    else if (flag === 'gear') parts.push(T.mineGear)
    else if (flag === 'bomb') parts.push(T.mineBombFlag)
    else if (flag === 'boss-win') parts.push(T.mineBossWinFlag)
    else if (flag === 'boss-lose') parts.push(T.mineBossLoseFlag)
    else if (flag === 'mine-reset') parts.push(T.mineResetToast)
    else if (flag.startsWith('fossil-')) parts.push(T.mineFossilFound(T.mineFossilName[Number(flag.slice(7)) - 1] ?? ''))
    else if (flag.startsWith('diary-')) parts.push(T.mineDiaryFound(Number(flag.slice(6)) + 1))
  }
  for (const [id, count] of Object.entries(haul.items)) {
    parts.push(T.reward.item(T.bagItem[id] ?? id, count))
  }
  if (haul.lamps > 0) parts.push(T.reward.chests(haul.lamps))
  if (haul.gold > 0) parts.push(T.reward.gold(haul.gold))
  if (haul.stars > 0) parts.push(T.mineStars(haul.stars))
  if (haul.exp >= 1) parts.push(T.mineExp(Math.floor(haul.exp)))

  return parts.join('・')
}

/** 鉱山の地図の絵（デスクトップ・スマホ。押すのは下のボタン）。地層の背景・タイル・きらめき・掘れるマスの金色の縁・ボス */
function mineMap(els: Els, save: SaveData, grid: readonly MineCell[], isBoss: boolean): RenderElement | null {
  if (!('Svg' in els)) {
    return null
  }
  const { Svg } = els
  const source = mineMapSvg({
    floor: save.mine.floor,
    grid,
    diggable: grid.map((_, index) => canDig(grid, index)),
    glimpse: grid.map((_, index) => isGlimpse(save, index)),
    isBoss,
    bossType: bossType(save.mine.floor),
  })
  const scale = 2

  return <Svg key={`mine-map-${save.mine.floor}`} source={source} alt={T.mineLayer[layerOf(save.mine.floor)] ?? ''} width={(7 * TILE + 16) * scale} height={(5 * TILE + 16) * scale} isInteractive />
}

/** 持ち物のうち、掘って手に入るもの */
const dugItems = (save: SaveData): [string, number][] => Object.entries(save.bag).filter(([id, count]) => count > 0 && (/^(ore|gem)-/.test(id) || id === 'fossil' || id === 'pebble' || id === 'bomb'))

/** マスを押せるか（掘れる閉じたマス・出てきたもの・生きている魔物）。階段は押しても何もしない */
function isPressable(save: SaveData, index: number): boolean {
  const { state, diggable } = cellState(save, index)

  return state === 'prize' || state === 'monster' || ((state === 'closed' || state === 'glimpse') && diggable)
}

/**
 * 鉱山の地図（押せる）。デスクトップ・スマホ: 1 マスずつのドット絵を 7 × 5 に並べ、マスの絵のすぐ上に 掘る / 取る / 戦う のボタン
 * （絵そのものも、絵に重ねたボタンも押せないため。押せないマスは薄い「・」）。
 * ターミナル: 絵文字のボタンを並べる
 */
async function mineGrid($: $, els: Els, save: SaveData, grid: readonly MineCell[], isTerminal: boolean): Promise<RenderElement> {
  const { Box, Button, Text } = els
  const m = save.mine
  // ターミナル（絵は出せない）
  if (isTerminal || !('Svg' in els)) {
    return (
      <Box flexDirection="column">
        {Array.from({ length: ROWS }, (_, y) => (
          <Box key={`mine-row-${y}`} flexDirection="row">
            {Array.from({ length: COLS }, (_, x) => {
              const index = y * COLS + x
              const isCalling = isPressable(save, index) && cellState(save, index).state !== 'closed'

              return <Button key={`mine-cell-${index}`} label={cellLabel(save, index)} variant={isCalling ? 'primary' : undefined} dimColor={!isPressable(save, index)} onPress={() => digCell($, index, m.floor, m.round)} />
            })}
          </Box>
        ))}
      </Box>
    )
  }
  const { Svg } = els as Extract<Els, { Svg: unknown }>
  const rows = Array.from({ length: ROWS }, (_, y) => (
    <Box key={`mine-row-${y}`} flexDirection="row" columnGap={1}>
      {Array.from({ length: COLS }, (_, x) => {
        const index = y * COLS + x
        const cell = grid[index]
        if (cell === undefined) {
          return <Box key={`mine-tile-${index}`} />
        }
        const { state, diggable } = cellState(save, index)
        const action = cellAction(save, index)
        const look = `${cell.open ? (cell.alive === true ? 'a' : cell.prize !== undefined ? 'p' : 'o') : cell.hp}-${state}${diggable ? 'd' : ''}`

        // ボタンはマスの絵のすぐ上（絵に重ねたボタンは押せなかったため）。押せないマスは薄い「・」
        return (
          <Box key={`mine-tile-${index}`} flexDirection="column" alignItems="center">
            <Button
              key={`mine-cell-${index}`}
              label={action === '' ? '・' : action}
              variant={action !== '' && state !== 'closed' ? 'primary' : undefined}
              dimColor={action === ''}
              onPress={() => digCell($, index, m.floor, m.round)}
            />
            <Svg key={`mine-pic-${index}-${look}`} source={tileSvg(cell, m.floor, diggable, state === 'glimpse')} alt={cellLabel(save, index)} width={48} height={48} isInteractive />
          </Box>
        )
      })}
    </Box>
  ))

  return (
    <Box flexDirection="column" alignSelf="flex-start" rowGap={1} borderStyle="round" borderColor="#6b5236" backgroundColor="#14110d" paddingX={1}>
      {rows}
    </Box>
  )
}

/** マスでできること（マスの上のボタンの文字）: 掘る / 取る / 戦う。何もできないマス（開いた階段も）は '' */
function cellAction(save: SaveData, index: number): string {
  const { state } = cellState(save, index)
  if (!isPressable(save, index)) return ''
  if (state === 'prize') return T.mineAct.take
  if (state === 'monster') return T.mineAct.fight
  return T.mineAct.dig
}

/** ボスに挑む: 戦って、戦いの画面に切り替える */
async function startMineBoss($: $): Promise<void> {
  await challengeMineBoss($)
  await update($, mineBossShown, () => true)
}

/** 鉱山のボス戦の画面（挑んだあと。勝ち負けが出るまでの戦いの絵と、戻る・もう一度挑むボタン） */
async function mineBossView($: $, els: Els, save: SaveData, bossName: string): Promise<RenderElement | null> {
  const fight = save.mine.lastBoss
  if (!(await read($, mineBossShown)) || fight === undefined || fight === null || fight.floor !== save.mine.floor) {
    return null
  }
  const { Box, Button, Text } = els
  const name = T.mineBossName[Math.max(0, Math.floor(fight.floor / 10) - 1) % 5] ?? bossName
  const picture =
    'Svg' in els
      ? (() => {
          const { Svg } = els as Extract<Els, { Svg: unknown }>
          const hero = heroFigure(save.job, save.evolution)
          return <Svg key={`mine-boss-fight-${fight.at}`} source={mineBossFightSvg(fight, hero.sprite, { title: name, win: T.mineBossWin, lose: T.mineBossLose })} alt={name} width={680} height={320} isInteractive />
        })()
      : null
  const canRetry = !fight.won && isBossPending(save.mine) && picksOf(save) >= BOSS_PICKS

  return (
    <Box flexDirection="column" gap={1}>
      {picture ?? <Box />}
      <Text bold color={fight.won ? '#8ff0a4' : '#ff8a8a'}>{fight.won ? T.mineBossWin : T.mineBossLose}</Text>
      <Box flexDirection="row" gap={1}>
        {canRetry ? <Button key="mine-boss-again" label={T.mineBossAgain(BOSS_PICKS)} variant="primary" onPress={() => startMineBoss($)} /> : <Box />}
        <Button key="mine-boss-back" label={T.mineBossBack} onPress={() => update($, mineBossShown, () => false)} />
      </Box>
    </Box>
  )
}

async function mineView($: $, els: Els, save: SaveData, isTerminal: boolean): Promise<RenderElement> {
  const { Box, Button, Text } = els
  const day = await today($)
  const intro = isNew(save, 'mine') ? await introBox($, els, 'mine') : null
  const m = save.mine
  const { grid, event } = floorOf(save)
  const picks = picksOf(save)
  const bombs = save.bag.bomb ?? 0
  const diary = await read($, mineDiary)
  const isBoss = isBossPending(m)
  const cost = upgradeCost(save)
  const next = PICKAXES[m.pickaxe + 1]

  const map = isBossFloor(m.floor) ? null : await mineGrid($, els, save, grid, isTerminal)
  const progress = floorProgress(save)
  const jumps = jumpFloors(save)

  const bossName = T.mineBossName[bossType(m.floor)] ?? ''
  const bossView = await mineBossView($, els, save, bossName)
  const outlook = bossOutlook(save)
  const haveUpgrade = cost !== undefined && (save.bag[cost.needs] ?? 0) >= cost.amount && save.gold >= cost.gold && save.wallet.stars >= cost.stars
  const found = dugItems(save)

  return (
    <Box flexDirection="column" gap={1}>
      {intro}
      <Box flexDirection="column">
        <Text bold>{T.mineHead(m.floor, T.mineLayer[layerOf(m.floor)] ?? '', picks, T.pickaxeName[m.pickaxe] ?? '')}</Text>
        <Text italic>{T.drillSays(T.drillTalk[pick(day, T.drillTalk.length)] ?? '')}</Text>
        <Text dimColor>{T.minePicksToday(m.picksToday, DAILY_PICK_CAP)}</Text>
        {event === '' ? null : <Text color="#ffd60a">{T.mineEvent[event] ?? ''}</Text>}
      </Box>
      {bossView !== null ? bossView : isBossFloor(m.floor) ? (mineMap(els, save, grid, true) ?? <Box />) : <Box />}
      {isBossFloor(m.floor) && !isBoss ? <Text color="#8ff0a4">{T.mineBossBeatenNote}</Text> : null}
      {map === null ? null : <Text dimColor>{T.mineTapHint}</Text>}
      {map}
      <Text>{m.last === null ? T.mineLastNone : T.mineLast(haulText(m.last))}</Text>
      <Box flexDirection="column">
        <Text dimColor>
          {T.mineFloorProgress(progress.done, progress.total)}
          {isFloorDone(save, m.floor) ? `　${T.mineFloorDoneNote}` : ''}
        </Text>
        <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
          {canGoToFloor(save, m.floor - 1) ? <Button key="mine-up" label={T.mineUp(m.floor - 1)} onPress={() => moveMineFloor($, m.floor - 1)} /> : null}
          {canGoToFloor(save, m.floor + 1) ? (
            m.floor + 1 > m.deepest ? (
              <Button key="mine-descend" label={T.mineDescend(m.floor + 1)} variant="primary" onPress={() => moveMineFloor($, m.floor + 1)} />
            ) : (
              <Button key="mine-down" label={T.mineDown(m.floor + 1)} onPress={() => moveMineFloor($, m.floor + 1)} />
            )
          ) : isBoss ? null : (
            <Text dimColor>{T.mineStairsHint}</Text>
          )}
          {bombs > 0 ? <Button key="mine-bomb" label={m.bomb ? T.mineBombOn(bombs) : T.mineBombOff(bombs)} variant={m.bomb ? 'primary' : undefined} onPress={() => toggleBomb($)} /> : null}
        </Box>
        {jumps.length > 1 ? (
          <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
            <Text dimColor>{T.mineJump}</Text>
            {jumps.map(f => (
              <Button key={`mine-jump-${f}`} label={T.mineFloorShort(f)} variant={f === m.floor ? 'primary' : 'secondary'} onPress={() => (f === m.floor ? undefined : moveMineFloor($, f))} />
            ))}
          </Box>
        ) : null}
      </Box>
      {isBoss ? (
        <Box flexDirection="column">
          <Text color="#ff4d6d">{T.mineBossLine(bossName, outlook.hp, outlook.damage, outlook.isLikely)}</Text>
          {picks >= BOSS_PICKS ? (
            <Button key="mine-boss" label={T.mineBossButton(BOSS_PICKS)} variant="primary" onPress={() => startMineBoss($)} />
          ) : (
            <Text dimColor>{T.mineBossNeed(BOSS_PICKS)}</Text>
          )}
        </Box>
      ) : null}
      <Box flexDirection="column">
        <Text bold>{T.mineUpgradeTitle}</Text>
        {cost === undefined || next === undefined ? (
          <Text dimColor>{T.minePickaxeMax}</Text>
        ) : (
          <Box flexDirection="column">
            <Text>
              {T.mineUpgradeLine(T.pickaxeName[cost.tier] ?? '', T.pickaxeNote[cost.tier] ?? '', T.reward.item(T.bagItem[cost.needs] ?? cost.needs, cost.amount), cost.stars, cost.gold)}
            </Text>
            {haveUpgrade ? (
              <Button key="mine-upgrade" label={T.mineUpgradeButton(T.pickaxeName[cost.tier] ?? '')} variant="primary" onPress={() => upgradeMinePickaxe($)} />
            ) : (
              <Text dimColor>{T.mineUpgradeShort}</Text>
            )}
          </Box>
        )}
      </Box>
      <Box flexDirection="column">
        {isAutoUnlocked(save) ? (
          <Button key="mine-auto" label={m.auto ? T.mineAutoOn : T.mineAutoOff} variant={m.auto ? 'primary' : undefined} onPress={() => toggleAutoMine($)} />
        ) : (
          <Text dimColor>{T.mineAutoLocked}</Text>
        )}
        {m.autoLast === null ? null : (
          <Text dimColor>
            {T.mineAutoLast(
              Object.entries(m.autoLast.items)
                .map(([id, count]) => T.reward.item(T.bagItem[id] ?? id, count))
                .join('・') || T.mineAutoNone,
              m.autoLast.hits,
            )}
          </Text>
        )}
      </Box>
      <Box flexDirection="column">
        <Text bold>{T.mineBagTitle}</Text>
        <Text>{found.length === 0 ? T.bagEmpty : found.map(([id, count]) => T.reward.item(T.bagItem[id] ?? id, count)).join('　')}</Text>
        <Text>{T.mineCollect(m.fossils.length, FOSSIL_COUNT, m.diaries.length, DIARY_COUNT)}</Text>
        {m.diaries.length === 0 ? null : (
          <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
            {m.diaries.map(page => (
              <Button key={`mine-diary-${page}`} label={T.mineDiaryButton(page + 1)} onPress={() => update($, mineDiary, () => page)} />
            ))}
          </Box>
        )}
        {diary >= 0 && m.diaries.includes(diary) ? (
          <Box flexDirection="column" borderStyle="round" borderColor="#c8a165" paddingX={1}>
            <Text bold>{T.mineDiaryTitle(diary + 1)}</Text>
            <Text>{T.mineDiary[diary] ?? ''}</Text>
            <Button key="mine-diary-close" label={T.mineDiaryClose} onPress={() => update($, mineDiary, () => -1)} />
          </Box>
        ) : null}
      </Box>
      <Text dimColor>{T.mineRule(DAILY_PICK_CAP)}</Text>
      {intro === null ? <Button key="intro-again-mine" label={T.mineIntroAgain} onPress={() => replayIntro($, 'mine')} /> : null}
    </Box>
  )
}
