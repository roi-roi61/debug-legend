import type { GoldMineState, SaveData } from '../types'
import { READY, addItem, isUnlocked, priceUnit } from './calendar'
import { dayStartAt, nextDayStart } from './farm'
import type { OffsetAt } from './farm'
import { LEASE_MS } from './lease'
import { petBattleEffects } from './pets'
import { hasPsychicNode, psychicStarReward } from './psychic'

// 金山・銀山（11 日目、docs/DAILY.md の 12 章）。$ を使わない純粋な関数。
// 生産は実時間で、「最後に回収した時刻」から計算する（毎秒は書かない）。
// ゴールドラッシュ（Claude が作業中は 3 倍）のため、作業中だった時間の合計を goldMine.workMs に持つ
// （作業中の印 save.busy は古いものから消えるので、時間を進める役が 10 秒ごとに足していく）。
// イベント（大当たり鉱脈・脱線・金の塊）は、日付とセーブの種から決まる。

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** 1 時間あたりの生産（線路 1 本、強化なし） */
export const BASE_GOLD_RATE = 6
export const BASE_SILVER_RATE = 15
/** 速さ +15%/段、容量 +2 時間/段（それぞれ 10 段） */
export const MAX_UPGRADE = 10
export const SPEED_STEP = 0.15
export const BASE_CAPACITY_HOURS = 4
export const CAPACITY_STEP_HOURS = 2
/** 作業中の倍率 */
export const RUSH = 3
/** 作業中の追加分: 3 倍 = 通常の 1 + 2 */
const RUSH_EXTRA = RUSH - 1
/** 大当たり鉱脈: 10 分間 5 倍 */
export const JACKPOT_MS = 10 * MINUTE
export const JACKPOT_RATE = 5
/** 脱線は 1 時間で自然に直る */
export const DERAIL_MS = HOUR
/** 金の塊で手に入る星のかけら */
export const NUGGET_STARS = 5
/** 線路の最大数（金・銀それぞれ）と、増やす星のかけら（2・3・4 本目） */
export const MAX_LINES = 4
export const LINE_STARS: readonly number[] = [30, 60, 100]
/** 金のトロッコ（持ち物）を使うと生産が 2 倍になる長さ */
export const CART_BOOST_MS = DAY
/** トロッコの見た目（木・鉄・金）。少しだけ速くなる */
export const CART_SPEED: readonly number[] = [1, 1.05, 1.1]
/** 銀鉱 → 金鉱の変換（超能力の錬金） */
export const ALCHEMY_RATE = 0.05
/** 作業中の記録（workSpans）に持つ区間の最大数。あふれたら古い方を捨てる（捨てる前に、そこまでの生産を確定する） */
export const WORK_SPAN_LIMIT = 120
/** 金鉱 10 個で延べ棒 1 本 */
export const INGOT_ORE = 10
/** 金の装飾 1 つに必要な金鉱 */
export const TRIM_ORE = 30

export type Kind = 'gold' | 'silver'

export const emptyGoldMine = (): GoldMineState => ({
  goldLines: 1,
  silverLines: 1,
  speed: 0,
  capacity: 0,
  cart: 0,
  collectedAt: 0,
  workMs: 0,
  workAt: 0,
  collectWork: 0,
  workSpans: [],
  spansFrom: 0,
  settledAt: 0,
  settledGold: [],
  settledSilver: [],
  fixed: {},
  nuggets: [],
  boostUntil: 0,
  last: null,
})

/** 金山銀山が遊べるか */
export const isGoldMineOpen = (save: SaveData): boolean => READY.has('goldmine') && isUnlocked(save, 'goldmine')

function hash(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    h = Math.imul(h ^ text.charCodeAt(i), 0x01000193)
  }

  return h >>> 0
}

export const linesOf = (save: SaveData, kind: Kind): number => (kind === 'gold' ? save.goldMine.goldLines : save.goldMine.silverLines)
export const capacityHours = (save: SaveData): number => BASE_CAPACITY_HOURS + CAPACITY_STEP_HOURS * save.goldMine.capacity

/** 線路 1 本の 1 時間の生産（作業中・イベントを除く）。速さの強化・トロッコ・ゴーレムの手伝い */
export function rateOf(save: SaveData, kind: Kind): number {
  const base = kind === 'gold' ? BASE_GOLD_RATE : BASE_SILVER_RATE
  const golem = petBattleEffects(save).goldMineRate

  return base * (1 + SPEED_STEP * save.goldMine.speed) * (CART_SPEED[save.goldMine.cart] ?? 1) * (1 + golem)
}

/** 線路 1 本にためられる量 */
export const capOf = (save: SaveData, kind: Kind): number => Math.floor(rateOf(save, kind) * capacityHours(save))

// ---- 作業中の時間（ゴールドラッシュ） ----

const busyEnd = (mark: SaveData['busy'][number]): number => mark.to ?? mark.seen + LEASE_MS

/** from〜to のうち、どれかのセッションが作業中だった区間（重なりはまとめる。古い順） */
export function busySpansBetween(busy: SaveData['busy'], from: number, to: number): [number, number][] {
  if (!(to > from)) {
    return []
  }
  const spans = busy
    .map(mark => [Math.max(from, mark.from), Math.min(to, busyEnd(mark))] as [number, number])
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0])
  const merged: [number, number][] = []
  for (const [a, b] of spans) {
    const last = merged[merged.length - 1]
    if (last !== undefined && a <= last[1]) {
      last[1] = Math.max(last[1], b)
    } else {
      merged.push([a, b])
    }
  }

  return merged
}

/** from〜to のうち、どれかのセッションが作業中だった時間（ミリ秒。重なりは 1 回だけ数える） */
export function busyMsBetween(busy: SaveData['busy'], from: number, to: number): number {
  return busySpansBetween(busy, from, to).reduce((total, [a, b]) => total + (b - a), 0)
}

const overlapMs = (a: number, b: number, c: number, d: number): number => Math.max(0, Math.min(b, d) - Math.max(a, c))

/**
 * a〜b のうち、作業中だった時間。最後の回収からのどの区間でも聞ける:
 * workAt より後は作業中の印（busy）、spansFrom〜workAt は記録（workSpans）、
 * 回収〜spansFrom は記録できていない分（workMs - collectWork - 記録の合計）を平らにならして使う
 */
function workMeter(save: SaveData): (a: number, b: number) => number {
  const g = save.goldMine
  const recorded = g.workSpans.reduce((total, [x, y]) => total + (y - x), 0)
  const pre = Math.max(0, g.workMs - g.collectWork - recorded)
  const preSpan = g.spansFrom - g.collectedAt

  return (a, b) => {
    if (!(b > a)) {
      return 0
    }
    let total = busyMsBetween(save.busy, Math.max(a, g.workAt), b)
    for (const [x, y] of g.workSpans) {
      total += overlapMs(a, b, x, y)
    }
    if (preSpan > 0 && pre > 0) {
      total += (pre * overlapMs(a, b, g.collectedAt, g.spansFrom)) / preSpan
    }

    return total
  }
}

/** 数え終わった作業中の時間 + まだ足していない分（ほかのセッションの画面でも同じ値になる） */
export const workTotal = (save: SaveData, now: number): number => save.goldMine.workMs + busyMsBetween(save.busy, save.goldMine.workAt, now)

/**
 * 時間を進める役が 10 秒ごとに呼ぶ。作業中だった時間を足す。まだ始めていなければ、ここから生産を始める。
 * 変わらないときは同じ save を返す
 */
export function tickGoldMine(save: SaveData, now: number): SaveData {
  if (!isGoldMineOpen(save)) {
    return save
  }
  const g = save.goldMine
  if (g.collectedAt === 0) {
    return { ...save, goldMine: { ...g, collectedAt: now, workAt: now, collectWork: g.workMs, workSpans: [], spansFrom: now, settledAt: now, settledGold: [], settledSilver: [] } }
  }
  if (now <= g.workAt) {
    return save
  }
  const added = busySpansBetween(save.busy, g.workAt, now)
  const add = added.reduce((total, [a, b]) => total + (b - a), 0)
  if (add === 0 && now - g.workAt < MINUTE) {
    return save
  }
  // 作業中の区間も記録する（脱線などの区間ごとに、作業中だった時間を正しく出すため）。つながっている区間はひとつにする
  const spans = g.workSpans.map(span => [...span] as [number, number])
  for (const [a, b] of added) {
    const last = spans[spans.length - 1]
    if (last !== undefined && a <= last[1]) {
      last[1] = Math.max(last[1], b)
    } else {
      spans.push([a, b])
    }
  }
  const next: GoldMineState = { ...g, workMs: g.workMs + add, workAt: now, workSpans: spans }
  if (spans.length <= WORK_SPAN_LIMIT) {
    return { ...save, goldMine: next }
  }
  // あふれた古い区間は記録から捨てる。捨てる前に、そこまでの生産を確定しておく（確定した時刻より前の記録は、もう要らない）
  const spansFrom = Math.max(g.spansFrom, spans[spans.length - WORK_SPAN_LIMIT - 1]![1])
  const settled = settleMine({ ...save, goldMine: next }, spansFrom).goldMine

  return { ...save, goldMine: { ...settled, workSpans: spans.slice(spans.length - WORK_SPAN_LIMIT), spansFrom } }
}

// ---- イベント ----

export type GoldEvent = { key: string; kind: 'jackpot' | 'derail' | 'nugget'; at: number; line?: { kind: Kind; index: number } }

/** その日（朝 4 時から）に起きるイベント。2〜4 回。セーブの種と日付で決まる */
export function eventsOfDay(save: SaveData, dayStart: number): GoldEvent[] {
  const n = 2 + (hash(`gm:n:${save.createdAt}:${dayStart}`) % 3)
  const events: GoldEvent[] = []
  for (let i = 0; i < n; i += 1) {
    const h = hash(`gm:e:${save.createdAt}:${dayStart}:${i}`)
    const at = dayStart + (h % (DAY - 2 * HOUR))
    const pick = (h >>> 8) % 100
    const key = `${dayStart}:${i}`
    if (pick < 40) {
      events.push({ key, kind: 'jackpot', at })
    } else if (pick < 75) {
      const lineHash = hash(`gm:l:${save.createdAt}:${dayStart}:${i}`)
      events.push({ key, kind: 'derail', at, line: { kind: lineHash % 2 === 0 ? 'gold' : 'silver', index: (lineHash >>> 4) % MAX_LINES } })
    } else {
      events.push({ key, kind: 'nugget', at })
    }
  }

  return events
}

/** from〜to に起きるイベント（古い順。最大 15 日ぶん） */
export function eventsBetween(save: SaveData, from: number, to: number, offsetAt?: OffsetAt): GoldEvent[] {
  const events: GoldEvent[] = []
  // 日の区切りは朝 4 時（ローカル）。24 時間ずつ足さず、日付を進めて求める（夏時間の日は 23・25 時間になる）
  let start = dayStartAt(from, offsetAt)
  for (let guard = 0; start < to && guard < 16; guard += 1) {
    for (const event of eventsOfDay(save, start)) {
      if (event.at >= from && event.at <= to) {
        events.push(event)
      }
    }
    start = nextDayStart(start, offsetAt)
  }

  return events.sort((a, b) => a.at - b.at)
}

/** 脱線が止まっている間（直していればそこまで）。ミリ秒 */
function derailSpan(save: SaveData, event: GoldEvent, now: number): { from: number; to: number } {
  const fixedAt = save.goldMine.fixed[event.key]

  return { from: event.at, to: Math.min(now, event.at + DERAIL_MS, fixedAt === undefined ? Infinity : Math.max(event.at, fixedAt)) }
}

// ---- たまった量 ----

/**
 * from〜to の生産を「時間」で数える（線路 1 本ぶん。レートを掛ける前）。
 * トロッコ・大当たり鉱脈・脱線の境目で区切り、区間ごとに足す。
 * 区間の中は、通常 = 1、作業中 = 3 倍（作業中だった時間だけ上乗せ）、トロッコ中は全体が 2 倍、大当たり鉱脈は 4 倍の上乗せ、脱線中は 0
 */
export function productionHours(
  from: number,
  to: number,
  work: (a: number, b: number) => number,
  cart: readonly [number, number],
  jackpots: readonly (readonly [number, number])[],
  stops: readonly { from: number; to: number }[],
): number {
  if (!(to > from)) {
    return 0
  }
  const cuts = new Set<number>([from, to])
  const mark = (t: number): void => {
    if (t > from && t < to) {
      cuts.add(t)
    }
  }
  mark(cart[0])
  mark(cart[1])
  for (const [a, b] of jackpots) {
    mark(a)
    mark(b)
  }
  for (const stop of stops) {
    mark(stop.from)
    mark(stop.to)
  }
  const points = [...cuts].sort((x, y) => x - y)
  let total = 0
  for (let i = 0; i + 1 < points.length; i += 1) {
    const a = points[i]!
    const b = points[i + 1]!
    const mid = (a + b) / 2
    if (stops.some(stop => stop.from <= mid && mid < stop.to)) {
      continue
    }
    const boost = mid >= cart[0] && mid < cart[1] ? 2 : 1
    const rush = boost * ((b - a) + RUSH_EXTRA * work(a, b))
    const jackpot = jackpots.filter(([x, y]) => x <= mid && mid < y).length
    total += rush + (JACKPOT_RATE - 1) * jackpot * (b - a)
  }

  return total / HOUR
}

export type LineView = { kind: Kind; index: number; amount: number; cap: number; isFull: boolean; isDerailed: boolean }
export type MineView = {
  lines: LineView[]
  gold: number
  silver: number
  /** 金鉱・銀鉱のどれかの線路が満杯（採集タブの「!」） */
  isFull: boolean
  /** 作業中のゴールドラッシュで加速している */
  isRush: boolean
  isBoosted: boolean
  /** 1 時間あたり（作業中なし）の合計 */
  goldPerHour: number
  silverPerHour: number
}

/** 線路ごとのたまった量（now 時点）。始めていなければ 0 */
/** 確定のはじまり（確定した時刻。回収より前の古い印は使わない）と、集計の終わり */
const settleStart = (g: GoldMineState): number => Math.max(g.settledAt, g.collectedAt)
const settleEnd = (g: GoldMineState, now: number): number => Math.min(now, g.collectedAt + 14 * DAY)

/** その線路の、確定した生産（時間）。回収より前の古い確定は使わない */
const settledOf = (g: GoldMineState, kind: Kind, index: number): number => (g.settledAt >= g.collectedAt ? ((kind === 'gold' ? g.settledGold : g.settledSilver)[index] ?? 0) : 0)

/** 線路ごとの生産（時間）を、from〜to について出す関数を用意する。イベント・作業中・トロッコは、いまの記録から */
function lineHoursMeter(save: SaveData, from: number, to: number): (kind: Kind, index: number) => { hours: number; isDerailed: boolean } {
  const g = save.goldMine
  const work = workMeter(save)
  // 金のトロッコ: 使ってから 1 日、生産が 2 倍
  const boostFrom = g.boostUntil - CART_BOOST_MS
  // 回収より前に始まって、まだ続いているイベント（脱線・大当たり鉱脈）も、集計期間と重なる分は入れる
  const events = eventsBetween(save, from - Math.max(DERAIL_MS, JACKPOT_MS), to)
  const jackpots = events.filter(event => event.kind === 'jackpot').map(event => [event.at, event.at + JACKPOT_MS] as [number, number])

  return (kind, index) => {
    // 止まっていた間（直していればそこまで）は生産しない
    const mine = events.filter(event => event.kind === 'derail' && event.line?.kind === kind && event.line.index === index)
    const stops = mine.map(event => derailSpan(save, event, to))
    const isDerailed = mine.some(event => to < event.at + DERAIL_MS && g.fixed[event.key] === undefined)

    return { hours: productionHours(from, to, work, [boostFrom, g.boostUntil], jackpots, stops), isDerailed }
  }
}

/**
 * upTo までの生産を確定する（線路ごとに「確定した時間」へ足して、settledAt を進める）。
 * 作業の記録を捨てる前・トロッコで boostUntil を書き換える前に呼ぶ。描画の中では呼ばない。まだ始めていなければ何もしない
 */
export function settleMine(save: SaveData, upTo: number): SaveData {
  const g = save.goldMine
  const from = settleStart(g)
  const to = settleEnd(g, upTo)
  if (g.collectedAt === 0 || !(to > from)) {
    return save
  }
  const meter = lineHoursMeter(save, from, to)
  const settle = (kind: Kind): number[] =>
    Array.from({ length: linesOf(save, kind) }, (_, index) => settledOf(g, kind, index) + meter(kind, index).hours)

  return patch(save, { settledAt: to, settledGold: settle('gold'), settledSilver: settle('silver') })
}

export function goldMineView(save: SaveData, now: number): MineView {
  const g = save.goldMine
  const lines: LineView[] = []
  const goldRate = rateOf(save, 'gold')
  const silverRate = rateOf(save, 'silver')
  if (g.collectedAt > 0 && now > g.collectedAt) {
    const from = settleStart(g)
    const to = settleEnd(g, now)
    const meter = lineHoursMeter(save, from, to)
    for (const kind of ['gold', 'silver'] as const) {
      const count = linesOf(save, kind)
      const rate = kind === 'gold' ? goldRate : silverRate
      const cap = capOf(save, kind)
      for (let index = 0; index < count; index += 1) {
        const { hours: fresh, isDerailed } = meter(kind, index)
        // 確定した分 + 確定した時刻からいままで。上限（容量）は合わせた量にかける
        const hours = settledOf(g, kind, index) + fresh
        const amount = Math.min(cap, Math.floor(rate * hours))
        lines.push({ kind, index, amount, cap, isFull: amount >= cap, isDerailed })
      }
    }
  } else {
    for (const kind of ['gold', 'silver'] as const) {
      for (let index = 0; index < linesOf(save, kind); index += 1) {
        lines.push({ kind, index, amount: 0, cap: capOf(save, kind), isFull: false, isDerailed: false })
      }
    }
  }
  const sum = (kind: Kind): number => lines.filter(line => line.kind === kind).reduce((total, line) => total + line.amount, 0)

  return {
    lines,
    gold: sum('gold'),
    silver: sum('silver'),
    isFull: lines.some(line => line.isFull),
    isRush: busyMsBetween(save.busy, now - 1, now) > 0,
    isBoosted: g.boostUntil > now,
    goldPerHour: Math.floor(goldRate * linesOf(save, 'gold')),
    silverPerHour: Math.floor(silverRate * linesOf(save, 'silver')),
  }
}

/** 採集タブの「!」: 満杯の線路がある（遊べるとき） */
export const goldMineNeedsAttention = (save: SaveData, now: number): boolean => isGoldMineOpen(save) && goldMineView(save, now).isFull

/** いま起きているイベント（直せる脱線・拾える金の塊・大当たり中） */
export function activeEvents(save: SaveData, now: number): GoldEvent[] {
  return eventsBetween(save, now - DAY, now).filter(event => {
    if (event.kind === 'jackpot') {
      return now < event.at + JACKPOT_MS
    }
    if (event.kind === 'derail') {
      return now < event.at + DERAIL_MS && save.goldMine.fixed[event.key] === undefined && event.line !== undefined && event.line.index < linesOf(save, event.line.kind)
    }

    return !save.goldMine.nuggets.includes(event.key) && event.at > now - 6 * HOUR
  })
}

// ---- 操作 ----

const patch = (save: SaveData, change: Partial<GoldMineState>): SaveData => ({ ...save, goldMine: { ...save.goldMine, ...change } })

/** 回収する（金鉱・銀鉱がひとつもたまっていなければ undefined）。超能力の錬金 = 銀鉱の 5% が金鉱になる */
export function collect(save: SaveData, now: number): SaveData | undefined {
  if (!isGoldMineOpen(save) || save.goldMine.collectedAt === 0) {
    return undefined
  }
  const view = goldMineView(save, now)
  if (view.gold + view.silver < 1) {
    return undefined
  }
  const converted = hasPsychicNode(save, 'fortune-8') ? Math.floor(view.silver * ALCHEMY_RATE) : 0
  const gold = view.gold + converted
  const silver = view.silver - converted
  let next = addItem(save, 'ore-gold', gold)
  next = addItem(next, 'ore-silver', silver)

  // 次の集計の始まりは、いままでの基準の時刻より前に戻さない（時計を戻してから回収しても、同じ時間を二度数えないように）
  const g = save.goldMine
  const at = Math.max(now, g.collectedAt, g.workAt, g.settledAt)

  return patch(next, { collectedAt: at, collectWork: workTotal(save, now), workMs: workTotal(save, now), workAt: at, workSpans: [], spansFrom: at, settledAt: at, settledGold: [], settledSilver: [], last: { gold, silver, converted, at: now } })
}

/** 脱線を直す（いま止まっている線路があるとき） */
export function fixDerail(save: SaveData, now: number): SaveData | undefined {
  if (!isGoldMineOpen(save)) {
    return undefined
  }
  const events = activeEvents(save, now).filter(event => event.kind === 'derail')
  if (events.length === 0) {
    return undefined
  }
  const fixed = { ...save.goldMine.fixed }
  for (const event of events) {
    fixed[event.key] = now
  }
  // 古い印は消す（直した時刻が 3 日より前のもの）
  const keep = Object.fromEntries(Object.entries(fixed).filter(([, at]) => at > now - 3 * DAY).slice(-16))

  return patch(save, { fixed: keep })
}

/** 金の塊を拾う（✦5） */
export function pickNugget(save: SaveData, now: number): SaveData | undefined {
  if (!isGoldMineOpen(save)) {
    return undefined
  }
  const event = activeEvents(save, now).find(item => item.kind === 'nugget')
  if (event === undefined) {
    return undefined
  }
  const next = patch(save, { nuggets: [...save.goldMine.nuggets, event.key].slice(-16) })

  return { ...next, wallet: { ...next.wallet, stars: next.wallet.stars + psychicStarReward(save, NUGGET_STARS) } }
}

/** 金のトロッコを使う（1 日だけ生産 2 倍。効いている間は使えない） */
export function useGoldCart(save: SaveData, now: number): SaveData | undefined {
  if (!isGoldMineOpen(save) || (save.bag['gold-cart'] ?? 0) < 1 || save.goldMine.boostUntil > now) {
    return undefined
  }
  // 2 倍になるのは、使った時刻（boostUntil - 1 日）から先だけ。いままでのたまり分には、かからない
  // ただし前回の加速の未回収分は、書き換える前に確定しておく（残っていた加速の期間が消えないように）
  return patch(addItem(settleMine(save, now), 'gold-cart', -1), { boostUntil: now + CART_BOOST_MS })
}

// ---- 強化 ----

export type Upgrade = 'speed' | 'capacity' | 'cart' | 'goldLine' | 'silverLine'

export type UpgradeCost = { gold: number; stars: number; ore: string; amount: number }

const SPEED_ORE = 'ore-silver'
const CAPACITY_ORE = 'ore-gold'

/** 次の強化の費用（もう最大なら undefined） */
export function upgradeCost(save: SaveData, kind: Upgrade): UpgradeCost | undefined {
  const g = save.goldMine
  const p = priceUnit(save)
  if (kind === 'speed') {
    return g.speed >= MAX_UPGRADE ? undefined : { gold: Math.round(p * 2 * (g.speed + 1)), stars: 0, ore: SPEED_ORE, amount: 30 + 20 * g.speed }
  }
  if (kind === 'capacity') {
    return g.capacity >= MAX_UPGRADE ? undefined : { gold: Math.round(p * 1.5 * (g.capacity + 1)), stars: 0, ore: CAPACITY_ORE, amount: 10 + 8 * g.capacity }
  }
  if (kind === 'cart') {
    if (g.cart >= 2) {
      return undefined
    }

    return g.cart === 0 ? { gold: p * 10, stars: 0, ore: 'ore-iron', amount: 80 } : { gold: p * 40, stars: 0, ore: CAPACITY_ORE, amount: 200 }
  }
  const lines = kind === 'goldLine' ? g.goldLines : g.silverLines

  return lines >= MAX_LINES ? undefined : { gold: 0, stars: LINE_STARS[lines - 1] ?? 100, ore: '', amount: 0 }
}

/**
 * 強化する。お金や鉱石が足りないとき・最大のときは undefined。
 * 強化の前に、いままでのたまり分を確定してから変えないと、あとから計算が変わってしまうので、
 * いまのたまり分を持ち物に回収してから強化する（回収して入れ直しても損はしない）
 */
export function upgrade(save: SaveData, kind: Upgrade, now: number): SaveData | undefined {
  const cost = upgradeCost(save, kind)
  if (!isGoldMineOpen(save) || cost === undefined || save.gold < cost.gold || save.wallet.stars < cost.stars || (cost.ore !== '' && (save.bag[cost.ore] ?? 0) < cost.amount)) {
    return undefined
  }
  let next: SaveData = { ...save, gold: save.gold - cost.gold, wallet: { ...save.wallet, stars: save.wallet.stars - cost.stars } }
  if (cost.ore !== '') {
    next = addItem(next, cost.ore, -cost.amount)
  }
  const g = next.goldMine
  if (kind === 'speed') {
    return settle(next, now, { speed: g.speed + 1 })
  }
  if (kind === 'capacity') {
    return settle(next, now, { capacity: g.capacity + 1 })
  }
  if (kind === 'cart') {
    return settle(next, now, { cart: g.cart + 1 })
  }

  return settle(next, now, kind === 'goldLine' ? { goldLines: g.goldLines + 1 } : { silverLines: g.silverLines + 1 })
}

/** たまっている分を持ち物に入れてから、設定を変える（変えたあとの速さが、過去のたまり分にかからないように） */
function settle(save: SaveData, now: number, change: Partial<GoldMineState>): SaveData {
  const collected = collect(save, now) ?? save

  return patch(collected, change)
}

// ---- 使い道 ----

/** 金鉱 10 個 → 金の延べ棒 1 本 */
export function smeltGoldIngot(save: SaveData): SaveData | undefined {
  if ((save.bag['ore-gold'] ?? 0) < INGOT_ORE) {
    return undefined
  }

  return addItem(addItem(save, 'ore-gold', -INGOT_ORE), 'ingot-gold', 1)
}
