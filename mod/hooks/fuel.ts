import type { AwayReport, BattleReport, SaveData } from '../types'
import { emptyReport, fight } from './battle'
import { DAY_START_HOUR, GOLD, LAMP, TIME, TOKEN_BONUS } from './config'

export { addExp, expToNext } from './level'

// 燃料の計算。ここの関数は $ を使わない（同じ入力なら同じ結果）ので、テストしやすい。
// どれも元のセーブは変えず、新しいセーブを返す。

const HOUR = 60 * 60 * 1000

/**
 * その時刻が「どの日」か（YYYY-MM-DD）。DAY_START_HOUR 時に日付が変わる。
 * @param tzOffsetMinutes new Date().getTimezoneOffset() の値（日本は -540）
 */
export function dayKey(now: number, tzOffsetMinutes: number): string {
  const local = new Date(now - tzOffsetMinutes * 60 * 1000 - DAY_START_HOUR * HOUR)

  return local.toISOString().slice(0, 10)
}

/** 日付が変わっていたら 1 日の上限カウンターを戻す */
export function rollDay(save: SaveData, day: string): SaveData {
  if (save.daily.day === day) {
    return save
  }

  return { ...save, daily: { day, turnLamps: 0, toolGold: 0, tokenBonus: 0 } }
}

/** 1 回の回答のトークン数から、おまけ（ランプ何回分か）を出す。上限前の値 */
export function tokenBonus(tokens: number): number {
  if (!(tokens > TOKEN_BONUS.floorTokens)) {
    return 0
  }
  const bonus = TOKEN_BONUS.perDecade * Math.log10(tokens / TOKEN_BONUS.floorTokens)

  return Math.min(TOKEN_BONUS.perTurnCap, bonus)
}

/** ランプのストックを足す（ストック上限まで）。実際に増えた数も返す */
function addLamps(save: SaveData, count: number): { save: SaveData; added: number } {
  const lamps = Math.min(LAMP.stockCap, save.lamps + count)

  return { save: { ...save, lamps }, added: Math.max(0, lamps - save.lamps) }
}

export type TurnGain = { lamps: number; bonus: number }

/** 回答が 1 回終わったとき: ランプ +1（1 日上限・ストック上限）と、トークンのおまけ */
export function applyTurn(input: SaveData, day: string, tokens: number): { save: SaveData; gain: TurnGain } {
  let save = rollDay(input, day)
  const turnRoom = Math.max(0, LAMP.dailyTurnCap - save.daily.turnLamps)
  const fromTurn = Math.min(LAMP.perTurn, turnRoom)

  const bonusRoom = Math.max(0, TOKEN_BONUS.dailyCap - save.daily.tokenBonus)
  const bonus = Math.min(tokenBonus(tokens), bonusRoom)
  const fraction = save.bonusFraction + bonus
  // 小数の足し算の誤差で 0.9999… になっても 1 回分として数える
  const fromBonus = Math.floor(fraction + 1e-9)

  save = {
    ...save,
    bonusFraction: Math.max(0, fraction - fromBonus),
    daily: { ...save.daily, turnLamps: save.daily.turnLamps + fromTurn, tokenBonus: save.daily.tokenBonus + bonus },
    totals: { ...save.totals, turns: save.totals.turns + 1, tokens: save.totals.tokens + Math.max(0, Math.floor(tokens)) },
  }
  const added = addLamps(save, fromTurn + fromBonus)

  return { save: added.save, gain: { lamps: added.added, bonus } }
}

/** ツール呼び出しが成功したとき: 少しのゴールド（1 日上限） */
export function applyToolSuccess(input: SaveData, day: string): { save: SaveData; gold: number } {
  const save = rollDay(input, day)
  const gold = Math.min(GOLD.perToolCall, Math.max(0, GOLD.dailyToolCap - save.daily.toolGold))

  return {
    save: {
      ...save,
      gold: save.gold + gold,
      daily: { ...save.daily, toolGold: save.daily.toolGold + gold },
      totals: { ...save.totals, toolCalls: save.totals.toolCalls + 1 },
    },
    gold,
  }
}

export type TimeGain = { seconds: number; offlineMs: number; report: BattleReport }

/** これより長く閉じていたら、次に開いたときにまとめをお知らせする */
const AWAY_NOTICE_MS = 5 * 60 * 1000

/** オフラインのまとめを足し合わせる（お知らせを閉じる前にまた閉じた場合） */
function addAway(old: AwayReport | null, report: BattleReport, ms: number, now: number): AwayReport {
  if (old === null) {
    return { ...report, ms, at: now }
  }

  return {
    seconds: old.seconds + report.seconds,
    kills: old.kills + report.kills,
    exp: old.exp + report.exp,
    gold: old.gold + report.gold,
    levels: old.levels + report.levels,
    stages: old.stages + report.stages,
    bossWins: [...old.bossWins, ...report.bossWins],
    bossLosses: [...old.bossLosses, ...report.bossLosses],
    ms: old.ms + ms,
    at: now,
  }
}

/**
 * 前回の計算から今までの時間ぶん戦う（battle.ts の fight）。
 * 間があきすぎていたら「オフライン」として最大 8 時間分（作業中の加速なし）。長く閉じていたらまとめを away に残す。
 */
export function applyTime(input: SaveData, now: number, isWorking: boolean): { save: SaveData; gain: TimeGain } {
  const elapsed = now - input.lastTickAt
  if (!(elapsed > 0)) {
    return { save: { ...input, lastTickAt: Math.max(input.lastTickAt, now) }, gain: { seconds: 0, offlineMs: 0, report: emptyReport() } }
  }
  const isOffline = elapsed >= TIME.offlineThresholdMs
  const counted = isOffline ? Math.min(elapsed, TIME.offlineCapMs) : elapsed
  const rate = TIME.battleSpeed * (isWorking && !isOffline ? TIME.workingMultiplier : 1)
  const seconds = (counted / 1000) * rate
  const offlineMs = isOffline ? counted : 0
  const fought = fight({ ...input, lastTickAt: now, totals: { ...input.totals, offlineMs: input.totals.offlineMs + offlineMs } }, seconds, now)
  const save = offlineMs >= AWAY_NOTICE_MS ? { ...fought.save, away: addAway(fought.save.away, fought.report, offlineMs, now) } : fought.save

  return { save, gain: { seconds, offlineMs, report: fought.report } }
}
