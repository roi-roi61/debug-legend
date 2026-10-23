import { atom, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { BattleReport, SaveData } from '../types'
import { syncCodex } from './codex'
import { announceReport, autoLamp, openPane, withBossShare } from './actions'
import { stopBgm, syncBgm } from './audio'
import { detectWindows } from './winsound'
import { runCheat, runDebugLog, runExport, runImport, runSound, runSummary } from './commands'
import { DEV_CHEATS, SOUND, TIME, TRAVEL } from './config'
import { secondsToNextEvent, travelLeft } from './battle'
import { BUILD } from './build.generated'
import { buildLabel, cheatsAllowed } from './build'
import { clock, flushLog, note, setLogSession } from './debuglog'
import { advanceShared, canLead, isBusyAt, leaseFor, markBusy, pruneBusy } from './lease'
import { isPaneShown } from './audio'
import { BOSS_STAGE, stageGroup } from './world'
import { applyToolSuccess, applyTurn, dayKey } from './fuel'
import type { PlayDay } from './calendar'
import { count as countUp, countReport } from './missions'
import { accruePicks, autoMine } from './mine'
import { READY, featureDay, recordPlay } from './calendar'
import type { $ } from './persist'
import { background, load, mutate, restoreLost, serial, setWriter, show, store, track } from './persist'
import { T, setDetectedLanguage, useLanguage } from './texts'
import { tickFarm, waterAll } from './farm'
import { tickGoldMine } from './goldmine'
import { answerEgg } from './pets'
import { awardBossStars } from './premium'
import { drawBand, drawPane } from './screens'

// デバッグ伝説: 燃料フック（回答・ツール・トークン・時間）、帯・サイド画面・ステータスライン、スラッシュコマンド。

const workingState = atom({ plugin: 'debug-legend', key: 'isWorking' } as const, false)

/** 作業中（このセッションのメインの turn が実行中）か。セーブに作業中の印を付け、ステージ進行が加速する（どのセッションの作業でも） */
let isWorking = false
/** このセッション（時間を進める役の持ち主の名前） */
let me = 'local'
/** このセッションでサイド画面が開いているか（3 秒ごとに確かめる） */
let isWatching = false
/** 時間を進める役か。記録には、変わったときだけ書く */
let role = ''
/** このセッションが最後に書いた lastTickAt（ほかのところで書かれたかを見分ける） */
let lastWrite: number | undefined
/** 画面に出している「作業中（3 倍速）」 */
let shownBusy = false
let tick: { cancel: () => void } | undefined
/** 次の「できごと」（先頭の敵が倒れる・ボス戦の勝ち負け）の時刻に、戦闘を進めるための予約 */
let nextEvent: { cancel: () => void } | undefined
let soundCheck: { cancel: () => void } | undefined
/** 開発用チートを使えるか。環境変数 DEBUG_LEGEND_DEV=1 は開発版（channel が dev）のときだけ効く。公開版（stamp_build.py --public）は無視する */
let isCheating = false
/** まだセーブに入れていないツール成功の回数（次のタイマーでまとめて入れる） */
let pendingTools = 0

/**
 * 次の「できごと」の時刻（HP バーが 0 になる時刻と同じ）に戦闘を進めて、画面を描き直す予約をする。
 * 10 秒ごとのタイマーだけだと、HP バーが 0 になってから敵が消えるまで最大 10 秒かかっていた（ベータの不具合）。
 * 予約は 1 つだけ（新しく計算するたびに入れ替える）。10 秒より先（ボス戦の決着など）でも入れる
 * （1.0.1 では入れていなかったので、ボス戦の決着が次の 10 秒のタイマーまで遅れていた）。
 * save は「いま」の様子（時間を進める役でなければ、セーブを進めて見せている様子）。
 */
function scheduleNextEvent($: $, save: SaveData): void {
  nextEvent?.cancel()
  nextEvent = undefined
  travelEnd?.cancel()
  travelEnd = undefined
  const speed = TIME.battleSpeed * (isBusyAt(save, save.lastTickAt) ? TIME.workingMultiplier : 1)
  noteTravel($, save, speed)
  const ms = (secondsToNextEvent(save) / speed) * 1000
  if (Number.isFinite(ms)) {
    // 少しだけ遅らせて、計算の端数で「まだ倒れていない」にならないように
    const wait = Math.max(100, Math.ceil(ms) + 60)
    const plannedAt = save.lastTickAt + wait
    note(save.lastTickAt, 'schedule', `${where(save)} あと ${wait}ms（×${speed}）`)
    nextEvent = $.clock.after(wait, () =>
      background(
        $.clock.now().then(now => {
          note(now, 'fire', `予約 ${now - plannedAt >= 0 ? '+' : ''}${now - plannedAt}ms`)
          return advanceTime($)
        }),
      ),
    )
  }
}

/** 移動の終わりを記録するための予約（戦闘は止まったまま、記録だけ） */
let travelEnd: { cancel: () => void } | undefined
/** 始まりを記録した移動（同じ移動を 2 回書かない） */
let travelNoted = ''

/** 移動の始まり（すでに始まっていれば、その時刻）と終わり（実際に予約が発火した時刻）を記録する */
function noteTravel($: $, save: SaveData, speed: number): void {
  const travel = travelLeft(save)
  if (travel <= 0) {
    return
  }
  const startedAt = save.lastTickAt - Math.round(((TRAVEL.seconds - travel) / speed) * 1000)
  const key = `${save.stage.chapter}-${save.stage.stage}@${Math.round((save.battleSeconds - (TRAVEL.seconds - travel)) * 10)}`
  if (key !== travelNoted) {
    travelNoted = key
    note(startedAt, 'travel', `移動の始まり → ${save.stage.chapter}-${save.stage.stage}（${TRAVEL.seconds}s・×${speed}、着くのは ${Math.round((TRAVEL.seconds / speed) * 1000)}ms 後）`)
  }
  const wait = Math.max(0, Math.round((travel / speed) * 1000))
  travelEnd = $.clock.after(wait, () =>
    background($.clock.now().then(now => note(now, 'travel', `移動の終わり（着いた。ここから戦う）${save.stage.chapter}-${save.stage.stage}`))),
  )
}

/** 記録に書く「どこにいるか」（例: 2-9 撃破 0.42/3、移動中なら「移動 0.8s」も） */
const where = (save: SaveData): string =>
  (save.stage.stage >= BOSS_STAGE && !save.isCleared
    ? `${save.stage.chapter}-${save.stage.stage} ボス ${save.stage.bossTime.toFixed(1)}s`
    : `${save.stage.chapter}-${save.stage.stage} 撃破 ${save.stage.kills.toFixed(2)}/${stageGroup(save.stage.chapter, save.stage.stage).length}`) +
  (travelLeft(save) > 0 ? ` 移動 ${travelLeft(save).toFixed(1)}s` : '')

/** 前に画面に出した様子（時間を進める役でないときの「撃破」の記録に使う） */
let lastShown: SaveData | undefined

/**
 * 時間の進行を計算する（タイマーと、作業の始まり・終わりと、できごとの予約で呼ぶ）。
 * 時間を進めて書くのは、役を持っているセッションだけ（hooks/lease.ts）。ほかのセッションは、セーブを同じ計算で
 * いままで進めた様子を画面に出す（書くのは、ためておいたツールのゴールドと、自分の作業中の印が変わったときだけ）。
 */
async function advanceTime($: $) {
  let result: { report: BattleReport; before: SaveData; isLeader: boolean } | undefined
  const save = await serial(async () => {
    const current = await load($)
    if (current === undefined) {
      return undefined
    }
    const now = await $.clock.now()
    const day = dayKey(now, new Date(now).getTimezoneOffset())
    const isLeader = canLead(current, me, now, isWatching)
    noteRole(now, current, isLeader)
    // ほかのプロセスの書き込みで消えた、このセッションの変更を入れ直す（hooks/persist.ts）
    let changed = restoreLost(current, now, day)
    // ためておいたツール成功のゴールドもここでまとめて入れる（ツールのたびにセーブを書かないように）
    const tools = pendingTools
    pendingTools = 0
    if (tools > 0) {
      changed = track(
        changed,
        (save, _now, today) => {
          let next = save
          for (let i = 0; i < tools; i += 1) {
            next = applyToolSuccess(next, today).save
          }
          // ツール成功 5 回でつるはし 1 回（鉱山が開いてから。1 日 60 回まで）
          return accruePicks(next, today, tools)
        },
        now,
        day,
      )
    }
    changed = markBusy(changed, me, now, isWorking)
    if (isLeader) {
      const advanced = advanceShared(changed, now)
      // 倒した数・ボス戦の回数を数える（日課・週課・実績。セーブの進みといっしょに書くので、ずれない）
      const rewarded = awardBossStars(advanced.save, advanced.gain.report.bossWins)
      const counted = countReport(rewarded, advanced.gain.report, day)
      // 自動採掘（10 分ごとに最大 10 回。閉じていた分も 8 時間まで追いつく）。叩いた回数・降りた階も数える
      const mined = autoMine(counted, now)
      const minedCounted = mined.hits > 0 || mined.stairs > 0 ? countUp(countUp(mined.save, 'mineHits', mined.hits, day), 'stairs', mined.stairs, day) : mined.save
      // 金山銀山の「作業中だった時間」を足す・スプリンクラーとペットの小屋（大農場）。作業中の印が消える前に数える
      const ticked = tickFarm(tickGoldMine(minedCounted, now), now, day)
      const next = withBossShare(pruneBusy({ ...syncCodex(ticked), clock: leaseFor(me, now, isWatching) }), advanced.gain.report, now)
      await store($, next)
      lastWrite = next.lastTickAt
      result = { report: advanced.gain.report, before: current, isLeader }
      lastShown = next
      return next
    }
    if (changed !== current) {
      await store($, changed)
    }
    const projected = advanceShared(changed, now)
    if (changed === current) {
      await show($, projected.save)
    }
    result = { report: projected.gain.report, before: lastShown ?? current, isLeader }
    lastShown = projected.save
    return projected.save
  })
  const done = result as { report: BattleReport; before: SaveData; isLeader: boolean } | undefined
  if (save !== undefined && done !== undefined) {
    const { before, report } = done
    // 群れが変わった（同じ 9 面をくり返すときは、倒した数が 0 に戻って移動が始まる）
    const isNewGroup =
      Math.floor(before.stage.kills + 1e-9) !== Math.floor(save.stage.kills + 1e-9) ||
      before.stage.stage !== save.stage.stage ||
      before.stage.chapter !== save.stage.chapter ||
      save.stage.kills < before.stage.kills - 1e-9 ||
      (travelLeft(save) > travelLeft(before) + 1e-9)
    const isBossEnd = report.bossWins.length > 0 || report.bossLosses.length > 0
    if (isNewGroup || (done.isLeader && isBossEnd)) {
      const how = done.isLeader
        ? `（+${report.seconds.toFixed(1)}s 撃破 ${report.kills.toFixed(2)}・ステージ +${report.stages}${report.bossWins.length > 0 ? '・ボス勝ち' : ''}${report.bossLosses.length > 0 ? '・ボス負け' : ''}）`
        : '（見るだけ: 時間はほかのセッションが進めている）'
      note(save.lastTickAt, 'advance', `${where(before)} → ${where(save)}${how}`)
    }
  }
  if (save !== undefined) {
    const busy = isBusyAt(save, save.lastTickAt)
    if (busy !== shownBusy) {
      shownBusy = busy
      await update($, workingState, () => busy)
    }
    scheduleNextEvent($, save)
    background(flushLog($))
  }
  if (done !== undefined && save !== undefined) {
    // お知らせと効果音は、時間を進めたセッションだけ（同じ撃破を、見るだけのセッションでくり返さない）
    if (done.isLeader) {
      announceReport($, done.report, done.before, save)
    }
    if (done.before.stage.stage !== save.stage.stage || done.before.isCleared !== save.isCleared) {
      background(syncBgm($))
    }
  }

  return save
}

/** 時間を進める役が変わったときに記録する（ほかのセッションが書いていたら、それも） */
function noteRole(now: number, current: SaveData, isLeader: boolean): void {
  const lease = current.clock
  const owner = isLeader ? 'me' : `${lease?.owner ?? '?'}@${lease?.build ?? '?'}`
  if (owner !== role) {
    role = owner
    note(
      now,
      'role',
      isLeader
        ? `このセッションが時間を進める（${lease === null ? '役は空き' : lease.owner === me ? '続けて' : `${lease.owner.slice(0, 4)} から引き継ぎ`}）`
        : `見るだけ（時間は s:${lease?.owner.slice(0, 4) ?? '?'}・ビルド ${lease?.build ?? '?'} が進めている）`,
    )
  }
  // 役を持っているのに、ほかのところでセーブが書かれていた（役を知らないコードが書いた、など）
  if (isLeader && lease?.owner === me && lastWrite !== undefined && current.lastTickAt !== lastWrite) {
    note(now, 'other', `このセッションが書いていないセーブ（${clock(current.lastTickAt)} まで進んだ ${where(current)}）`)
  }
}

/** サイド画面が開いているか確かめる（変わったら記録する） */
async function watchPane($: $): Promise<void> {
  const shown = await isPaneShown($)
  if (shown !== isWatching) {
    isWatching = shown
    note(await $.clock.now(), 'pane', shown ? 'サイド画面が見えている' : 'サイド画面が見えていない')
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // 言語: Claude Code の言語設定（取れなければ日本語）。セーブの設定で「自動」以外を選んでいればそちら
    const settings = await $.settings.read().catch(() => ({}) as Record<string, unknown>)
    setDetectedLanguage((settings as Record<string, unknown>).language)
    const first = await serial(() => load($))
    useLanguage(first?.settings.language ?? 'auto')

    await $.command.register({ name: 'dl', description: T.command.dl, immediate: true })
    await $.command.register({ name: 'dl-open', description: T.command.open, immediate: true })
    await $.command.register({ name: 'dl-export', description: T.command.exportSave, immediate: true })
    await $.command.register({ name: 'dl-import', description: T.command.importSave, argumentHint: T.command.importHint, immediate: true })
    isCheating = cheatsAllowed(DEV_CHEATS, BUILD.channel, await $.env.get('DEBUG_LEGEND_DEV'))
    await detectWindows($)
    if (isCheating) {
      await $.command.register({ name: 'dl-sound-test', description: T.command.sound, argumentHint: 'once | loop | stop | b64 | win', immediate: true })
      await $.command.register({ name: 'dl-cheat', description: T.command.cheat, argumentHint: T.command.cheatHint, immediate: true })
    }

    // 時間を進める役の名前（セッションごと）。記録の行にも短い印を付ける
    me = await $.session.id().catch(() => 'local')
    setLogSession(me)
    setWriter(me)
    await watchPane($).catch(() => undefined)
    // どのコードが、どこから読み込まれて動いているか（記録と /dl-version）
    note(await $.clock.now(), 'start', `${buildLabel()} 読み込み元 ${$.plugin.root}`)
    await $.command.register({ name: 'dl-version', description: T.command.version, immediate: true })
    await $.command.register({ name: 'dl-debuglog', description: T.command.debuglog, argumentHint: 'on | off | clear', immediate: true })

    // 前回からの時間を受け取る（間があいていればオフライン報酬、最大 8 時間。まとめは帯とサイド画面でお知らせ）
    // （ホットリロードや再起動で、できごとの予約が消えても、ここでまた予約し直す）
    background(advanceTime($))
    tick?.cancel()
    tick = $.clock.every(TIME.tickMs, () =>
      background(
        $.clock.now().then(now => {
          note(now, 'tick', '10 秒のタイマー')
          return advanceTime($).then(save => autoLamp($, save))
        }),
      ),
    )
    // サイド画面を開いた・閉じた・タブを変えたのに合わせて BGM を切り替える
    soundCheck?.cancel()
    soundCheck = $.clock.every(SOUND.checkMs, () => background(watchPane($).then(() => syncBgm($))))

    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      // セーブに作業中の印を付ける（ここから 3 倍速。ここまでは、いままでの速さで進める）。
      // 次のできごとの予約も、3 倍速で計算し直す（HP バーも 3 倍速で減る）
      isWorking = true
      background(advanceTime($))
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined) {
      return result
    }
    const usage = e.usage
    const tokens = usage === undefined ? 0 : usage.input_tokens + usage.output_tokens + usage.cache_creation_input_tokens
    background(
      (async () => {
        // 作業中の印を閉じる（ここまで 3 倍速）。ふだんの速さに戻ったので、次のできごとの予約を計算し直す
        isWorking = false
        await advanceTime($)
        if (e.reason === 'answer') {
          // 今日はじめての回答なら、遊んだ日 +1・ログインスタンプ・施設の解放（docs/DAILY.md）
          let played: PlayDay | undefined
          const save = await mutate($, (current, now, day) => {
            const answered = answerEgg(countUp(applyTurn(current, day, tokens).save, 'answers', 1, day))
            played = recordPlay(answered, day)
            return waterAll(played.save, now)
          })
          const unlocked = played?.unlocked
          // お知らせは、遊べる施設が開いた日に 1 回だけ（設定でオフにできる）
          if (save !== undefined && unlocked !== undefined && READY.has(unlocked) && save.settings.notifyUnlock) {
            $.ui.toast(T.unlockToast(featureDay(unlocked), T.featureName[unlocked] ?? unlocked))
          }
        }
      })(),
    )

    return result
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && ran.isError !== true) {
      pendingTools += 1
    }

    return ran
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'dl' }, async $ => ({ text: await runSummary($) }))
  on('command.run', { command: 'dl-version' }, async $ => ({ text: T.versionLine(buildLabel(), $.plugin.root, $.plugin.name) }))
  on('command.run', { command: 'dl-debuglog' }, async ($, e) => ({ text: await runDebugLog($, e.args) }))
  on('command.run', { command: 'dl-open' }, async $ => ({ text: await openPane($) }))
  on('command.run', { command: 'dl-export' }, async $ => ({ text: await runExport($) }))
  on('command.run', { command: 'dl-import' }, async ($, e) => ({ text: await runImport($, e.args) }))
  on('command.run', { command: 'dl-sound-test' }, async ($, e) => ({ text: isCheating ? await runSound($, e.args) : T.cheatOff }))
  on('command.run', { command: 'dl-cheat' }, async ($, e) => ({ text: isCheating ? await runCheat($, e.args) : T.cheatOff }))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) {
      return next(e)
    }
    const tree = await drawBand($, e)

    return tree ?? next(e)
  })

  on('ui.render', { component: 'Pane', requestId: 'debug-legend' }, async ($, e) => drawPane($, e))

  on('session.end', async ($, e, next) => {
    stopBgm()
    isWorking = false
    await advanceTime($).catch(() => undefined)
    // 時間を進める役を手放す（ほかのセッションがすぐ引き継げるように）
    await mutate($, (save, now) => (save.clock?.owner === me ? { ...save, clock: { ...save.clock, until: now } } : save)).catch(() => undefined)

    return next(e)
  })
}
