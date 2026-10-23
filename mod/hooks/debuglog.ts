import type { $ } from './persist'

// 不具合を調べるための実機の記録（撃破・群れの入れ替わり・ステージの移り変わり・戦闘画面の作り直し・タイマーの発火など）。
// 時刻つきで $.store の debugLog に直近 400 件まで残す（/dl-debuglog で見る。設定タブでオフにできる）。
// セーブと同じく、記録もセッションみんなで 1 つ。どのセッションが書いたかを、セッションの短い印（s:xxxx）で残す。
// 作業の内容やプロンプトは記録しない（ゲームの状態だけ）。

export const LOG_KEY = 'debugLog'
export const LOG_LIMIT = 400

// 400 件をまとめても、画面の文字数の上限（131,072）に収まる長さ。
const TEXT_LIMIT = 240
const KIND_LIMIT = 24
// 時差を引いても Date の範囲をはみ出さないよう、端の 1 日は使わない。
const DATE_LIMIT = 8.64e15 - 86_400_000

export type LogEntry = { t: number; kind: string; text: string; who?: string }

let isOn = true
let who = ''
const pending: LogEntry[] = []

/** 保存先から来た記録も、使う欄の型と長さを確かめる。 */
function entryOf(value: unknown): LogEntry | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const raw = value as Record<string, unknown>
  if (typeof raw.t !== 'number' || !Number.isFinite(raw.t) || raw.t < 0 || raw.t > DATE_LIMIT || typeof raw.kind !== 'string' || typeof raw.text !== 'string') return undefined

  return {
    t: Math.floor(raw.t),
    kind: raw.kind.slice(0, KIND_LIMIT),
    text: raw.text.slice(0, TEXT_LIMIT),
    ...(typeof raw.who === 'string' ? { who: raw.who.slice(0, 4) } : {}),
  }
}

function entriesOf(value: unknown): LogEntry[] {
  return Array.isArray(value) ? value.slice(-LOG_LIMIT).map(entryOf).filter((entry): entry is LogEntry => entry !== undefined) : []
}

/** このセッションの短い印（記録の行に付ける） */
export function setLogSession(id: string): void {
  who = id.slice(0, 4)
}

/** 記録を取るか（セーブの設定 settings.debugLog から。persist.ts の show で合わせる） */
export function setLogging(on: boolean): void {
  isOn = on
  if (!on) {
    pending.length = 0
  }
}

export const isLogging = (): boolean => isOn

/** 1 件書きとめる（すぐには保存しない。flushLog でまとめて保存する。描画の途中でも呼べる） */
export function note(t: number, kind: string, text: string): void {
  if (!isOn) {
    return
  }
  const entry = entryOf(who === '' ? { t, kind, text } : { t, kind, text, who })
  if (entry === undefined) return
  pending.push(entry)
  if (pending.length > LOG_LIMIT) {
    pending.splice(0, pending.length - LOG_LIMIT)
  }
}

/** 書きとめた分を $.store に保存する（直近 400 件まで。ほかのセッションの分と時刻の順に並べる） */
export async function flushLog($: $): Promise<void> {
  if (pending.length === 0) {
    return
  }
  const fresh = pending.splice(0, pending.length)
  const old = await $.store.get(LOG_KEY).catch(() => undefined)
  const list = entriesOf(old)
  await $.store.set(LOG_KEY, [...list, ...fresh].sort((a, b) => a.t - b.t).slice(-LOG_LIMIT))
}

export async function readLog($: $): Promise<LogEntry[]> {
  await flushLog($)
  const list = await $.store.get(LOG_KEY).catch(() => undefined)

  return entriesOf(list)
}

export async function clearLog($: $): Promise<void> {
  pending.length = 0
  await $.store.delete(LOG_KEY)
}

/** 時刻を「14:00:02.351」の形に（ローカル時刻） */
export function clock(t: number): string {
  const local = new Date(t - new Date(t).getTimezoneOffset() * 60_000).toISOString()

  return local.slice(11, 23)
}

export const formatLog = (list: readonly LogEntry[]): string =>
  entriesOf(list).map(entry => `${clock(entry.t)} ${entry.who === undefined ? '' : `s:${entry.who} `}${entry.kind.padEnd(8)} ${entry.text}`).join('\n')
