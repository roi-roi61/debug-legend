import type { BusyMark, SaveData, TimeLease } from '../types'
import { BUILD } from './build.generated'
import { TIME } from './config'
import { applyTime } from './fuel'
import type { TimeGain } from './fuel'
import { emptyReport } from './battle'

// 時間を進める役（1 つのセッションだけ）と、作業中の印（どのセッションの作業でも 3 倍速）。
// セーブ（$.store）は、同じパソコンで動いているセッションみんなで 1 つ。前は、それぞれのセッションが自分の 10 秒のタイマーで
// 戦闘を進めて書いていたので、違うバージョンのコードが混ざると、倒す速さの違う計算が交互に入って
// 「予約した時刻に倒れていない」になっていた（1.0.1 の実機の記録）。
// いまは、時間を進めて書くのは「役」を持っているセッションだけ。ほかのセッションは、セーブから同じ計算で
// いまの様子を出す（書かない）。役は 30 秒ごとに更新し、更新が止まったら（セッションを閉じたなど）ほかが引き継ぐ。

/** 役の期限（役のセッションは 10 秒ごとのタイマーでも更新する） */
export const LEASE_MS = 30_000
/** 作業中の印を更新する間隔 */
const BUSY_RENEW_MS = 5_000
/** 作業中の印をいくつまで残すか */
const BUSY_LIMIT = 16

/** 作業中の印の終わり（終わっていなければ、最後に見えた時刻から LEASE_MS） */
const busyEnd = (mark: BusyMark): number => mark.to ?? mark.seen + LEASE_MS

/** その時刻に、どれかのセッションが作業中か（3 倍速） */
export function isBusyAt(save: SaveData, t: number): boolean {
  return save.busy.some(mark => mark.from <= t && t < busyEnd(mark))
}

/** このセッションが時間を進める役を持てるか */
export function canLead(save: SaveData, me: string, now: number, isWatching: boolean): boolean {
  const lease = save.clock
  if (lease === null || lease.owner === me || lease.until <= now) {
    return true
  }
  // 新しいコードが引き継ぐ（古いほうは書くのをやめる）
  if (lease.builtAt !== BUILD.builtAt) {
    return lease.builtAt < BUILD.builtAt
  }

  // 同じコードなら、サイド画面を見ているセッションが引き継ぐ（音やお知らせが、見ているところで出るように）
  return isWatching && !lease.isWatching
}

export function leaseFor(me: string, now: number, isWatching: boolean): TimeLease {
  return { owner: me, build: BUILD.code, builtAt: BUILD.builtAt, until: now + LEASE_MS, isWatching }
}

/**
 * 前回からいまのところまで時間を進める（作業中の印で速さを区切る）。役のセッションはこれを書き、
 * ほかのセッションは書かずに画面に出す（同じ計算なので、どのセッションで見ても同じになる）。
 */
export function advanceShared(input: SaveData, now: number): { save: SaveData; gain: TimeGain } {
  const elapsed = now - input.lastTickAt
  if (!(elapsed > 0) || elapsed >= TIME.offlineThresholdMs) {
    // 時間が進んでいない、または間があいた（オフライン報酬、作業中の速さは無し）
    return applyTime(input, now, false)
  }
  const cuts = [...new Set(input.busy.flatMap(mark => [mark.from, busyEnd(mark)]))].filter(t => t > input.lastTickAt && t < now).sort((a, b) => a - b)
  let save = input
  const report = emptyReport()
  let seconds = 0
  for (const end of [...cuts, now]) {
    const at = save.lastTickAt
    const step = applyTime(save, end, isBusyAt(input, (at + end) / 2))
    save = step.save
    seconds += step.gain.seconds
    const r = step.gain.report
    report.kills += r.kills
    report.exp += r.exp
    report.gold += r.gold
    report.levels += r.levels
    report.stages += r.stages
    report.bossWins.push(...r.bossWins)
    report.bossLosses.push(...r.bossLosses)
  }
  report.seconds = seconds

  return { save, gain: { seconds, offlineMs: 0, report } }
}

/** 終わった作業中の印を片づける（時間をそこまで進めたあと） */
export const pruneBusy = (save: SaveData): SaveData => ({ ...save, busy: save.busy.filter(mark => busyEnd(mark) > save.lastTickAt).slice(-BUSY_LIMIT) })

/** このセッションの作業の始まり・続き・終わりを印にする */
export function markBusy(save: SaveData, me: string, now: number, isWorking: boolean): SaveData {
  const open = save.busy.find(mark => mark.owner === me && mark.to === null && busyEnd(mark) > now)
  if (isWorking) {
    if (open !== undefined) {
      // 続いている印は、ときどきだけ更新する（見るだけのセッションが、作業中に毎回セーブを書かないように）
      return now - open.seen < BUSY_RENEW_MS ? save : { ...save, busy: save.busy.map(mark => (mark === open ? { ...mark, seen: now } : mark)) }
    }
    // すでに時間を進めたところより前からは始めない
    const from = Math.max(now, save.lastTickAt)
    return { ...save, busy: [...save.busy, { owner: me, from, to: null, seen: now }].slice(-BUSY_LIMIT) }
  }
  if (open === undefined) {
    return save
  }

  return { ...save, busy: save.busy.map(mark => (mark === open ? { ...mark, to: Math.max(mark.from, now) } : mark)) }
}
