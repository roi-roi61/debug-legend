import type { Calendar, FeatureId, SaveData } from '../types'
import { GEAR, LAMP } from './config'
import { psychicGoldReward, psychicStarReward } from './psychic'

// 毎日の冒険（docs/DAILY.md）: 遊んだ日数・施設の解放・ログインスタンプ・物価。$ を使わない純粋な関数。
// 「遊んだ日」= その日に Claude が 1 回以上答え終わった日（朝 4 時で日付が変わる。fuel.ts の dayKey）。
// 休んだ日は数えないので、何日休んでも取り残されない。1 日に開く施設は 1 つだけ。

/** 施設と、開く日（遊んだ日数）。並びは暦の順 */
export const FEATURES: readonly { id: FeatureId; day: number }[] = [
  { id: 'calendar', day: 1 },
  { id: 'shop', day: 2 },
  { id: 'mine', day: 3 },
  { id: 'farm', day: 4 },
  { id: 'missions', day: 5 },
  { id: 'pet', day: 6 },
  { id: 'expedition', day: 7 },
  { id: 'smith', day: 8 },
  { id: 'premium', day: 9 },
  { id: 'psychic', day: 10 },
  { id: 'goldmine', day: 11 },
  { id: 'bigfarm', day: 12 },
  { id: 'pet2', day: 13 },
  { id: 'codex', day: 14 },
]

export const ROADMAP_DAYS = FEATURES.length

/** もう遊べる施設（作り終わったもの）。ここに無い施設は、開いても暦に「準備中」と出る */
export const READY: ReadonlySet<FeatureId> = new Set<FeatureId>(['calendar', 'shop', 'mine', 'farm', 'missions', 'pet', 'expedition', 'smith', 'premium', 'psychic', 'goldmine', 'bigfarm', 'pet2', 'codex'])

export const featureDay = (id: FeatureId): number => FEATURES.find(f => f.id === id)?.day ?? 1

export const emptyCalendar = (): Calendar => ({ playedDays: 0, lastPlayedDay: '', firstDay: '', seen: [], stamps: 0, isVeteran: false, gifted: [] })

/** その施設が開いているか（暦は 1 日目から。まだ 1 日も遊んでいなくても見られる） */
export const isUnlocked = (save: SaveData, id: FeatureId): boolean => id === 'calendar' || save.calendar.playedDays >= featureDay(id)

/** 開いていて、まだ説明を見ていない施設（タブに NEW の印） */
export const isNew = (save: SaveData, id: FeatureId): boolean => isUnlocked(save, id) && !save.calendar.seen.includes(id)

/** 次に開く施設（全部開いていれば undefined） */
export const nextFeature = (save: SaveData): { id: FeatureId; day: number } | undefined => FEATURES.find(f => f.day > save.calendar.playedDays)

/** 説明のあとの最初の贈り物（施設ごとに 1 回だけ） */
export const FIRST_GIFTS: Partial<Record<FeatureId, readonly Reward[]>> = {
  shop: [{ kind: 'item', id: 'chest-ticket', amount: 1 }],
  mine: [{ kind: 'item', id: 'pick', amount: 10 }],
  farm: [
    { kind: 'item', id: 'seed-carrot', amount: 1 },
    { kind: 'item', id: 'seed-potato', amount: 1 },
    { kind: 'item', id: 'seed-tomato', amount: 1 },
  ],
  missions: [{ kind: 'stars', amount: 10 }],
  pet: [{ kind: 'item', id: 'treat', amount: 5 }],
  expedition: [{ kind: 'item', id: 'lunchbox', amount: 1 }],
  smith: [{ kind: 'item', id: 'guard-stone', amount: 1 }],
  premium: [{ kind: 'stars', amount: 30 }],
  psychic: [{ kind: 'psi', amount: 3 }],
  goldmine: [{ kind: 'item', id: 'gold-cart', amount: 1 }],
  bigfarm: [{ kind: 'item', id: 'wood', amount: 30 }, { kind: 'item', id: 'ore-iron', amount: 20 }],
  pet2: [{ kind: 'item', id: 'treat', amount: 5 }],
  codex: [{ kind: 'stars', amount: 50 }],
}

/** 説明を見終わった印を付ける（はじめてなら最初の贈り物も） */
export function markSeen(save: SaveData, id: FeatureId): SaveData {
  if (save.calendar.seen.includes(id)) {
    return save
  }
  const seen = { ...save, calendar: { ...save.calendar, seen: [...save.calendar.seen, id] } }
  const gift = FIRST_GIFTS[id]
  if (gift === undefined || save.calendar.gifted.includes(id)) {
    return seen
  }

  return grant({ ...seen, calendar: { ...seen.calendar, gifted: [...seen.calendar.gifted, id] } }, gift)
}

// ---- 物価 ----

/**
 * 物価 P = 300 G ×（装備の Lv の伸び 1 + 0.12 ×（Lv − 1））。Lv1 で 300 G、Lv50 で約 2,060 G、Lv100 で約 3,860 G。
 * ゴールドの大半は宝箱の装備を売った分（Lv に比例して増える）なので、1 日に入るゴールドはどの Lv でも P の 15〜20 倍くらい。
 * 商店などの値段は「P × 何倍」で決める（序盤でも終盤でも同じくらいの重さの買い物になる）
 */
export function priceUnit(save: SaveData): number {
  return Math.round(PRICE_BASE * (1 + GEAR.perLevel * (Math.max(1, save.level) - 1)))
}

export const PRICE_BASE = 300

// ---- ログインスタンプ ----

/** スタンプのごほうび。chests = 宝箱（あふれた分は宝箱チケット）、gold = 物価 P の何倍、item = 持ち物、title = 称号 */
export type Reward =
  | { kind: 'chests'; amount: number }
  | { kind: 'gold'; times: number }
  | { kind: 'stars'; amount: number }
  | { kind: 'psi'; amount: number }
  | { kind: 'item'; id: string; amount: number }
  | { kind: 'title'; id: string }

/** 最初の 14 マス（docs/DAILY.md の表） */
export const FIRST_CARD: readonly (readonly Reward[])[] = [
  [{ kind: 'chests', amount: 5 }],
  [{ kind: 'gold', times: 3 }],
  [{ kind: 'item', id: 'pick', amount: 20 }],
  [{ kind: 'item', id: 'seed-pack', amount: 6 }],
  [{ kind: 'stars', amount: 10 }],
  [{ kind: 'item', id: 'treat', amount: 5 }],
  [{ kind: 'chests', amount: 20 }, { kind: 'title', id: 'week' }],
  [{ kind: 'item', id: 'ore-copper', amount: 20 }, { kind: 'item', id: 'ore-iron', amount: 10 }],
  [{ kind: 'stars', amount: 30 }],
  [{ kind: 'psi', amount: 1 }],
  [{ kind: 'item', id: 'gold-cart', amount: 1 }],
  [{ kind: 'item', id: 'gold-seed', amount: 1 }],
  [{ kind: 'item', id: 'egg-shard', amount: 10 }],
  [{ kind: 'item', id: 'box-myth', amount: 1 }, { kind: 'title', id: 'fortnight' }],
]

/** 15 日目からの 28 日カード（毎月くり返し）。7・14・21・28 マス目は大きいごほうび */
export function monthReward(cell: number): readonly Reward[] {
  const big: Record<number, readonly Reward[]> = {
    7: [{ kind: 'item', id: 'box-legend', amount: 1 }],
    14: [{ kind: 'item', id: 'egg', amount: 1 }],
    21: [{ kind: 'item', id: 'box-legend', amount: 2 }, { kind: 'stars', amount: 50 }],
    28: [{ kind: 'item', id: 'box-myth', amount: 1 }, { kind: 'title', id: 'month' }],
  }
  const small: readonly (readonly Reward[])[] = [
    [{ kind: 'chests', amount: 5 }],
    [{ kind: 'item', id: 'pick', amount: 15 }],
    [{ kind: 'item', id: 'seed-pack', amount: 4 }],
    [{ kind: 'stars', amount: 10 }],
    [{ kind: 'gold', times: 2 }],
    [{ kind: 'item', id: 'treat', amount: 3 }],
  ]

  return big[cell] ?? small[(cell - 1) % small.length]!
}

/** n 個目（1 始まり）のスタンプのごほうびと、どのカードの何マス目か */
export function stampAt(n: number): { card: 'first' | 'month'; cell: number; rewards: readonly Reward[] } {
  if (n <= FIRST_CARD.length) {
    return { card: 'first', cell: n, rewards: FIRST_CARD[n - 1]! }
  }
  const cell = ((n - FIRST_CARD.length - 1) % 28) + 1

  return { card: 'month', cell, rewards: monthReward(cell) }
}

export const BAG_CAP = 9_999

/** 持ち物を足す（種類ごとに 9,999 まで） */
export function addItem(save: SaveData, id: string, amount: number): SaveData {
  if (id === 'egg-shard') {
    const total = Math.min(BAG_CAP, Math.max(0, (save.bag[id] ?? 0) + amount))
    const eggs = Math.floor(total / 10)
    const shards = total % 10
    const bag: Record<string, number> = { ...save.bag, egg: Math.min(BAG_CAP, (save.bag.egg ?? 0) + eggs) }
    if (shards === 0) {
      delete bag[id]
    } else {
      bag[id] = shards
    }

    return { ...save, bag }
  }
  const count = Math.min(BAG_CAP, Math.max(0, (save.bag[id] ?? 0) + amount))

  return { ...save, bag: { ...save.bag, [id]: count } }
}

/** ごほうびを受け取る */
export function grant(save: SaveData, rewards: readonly Reward[]): SaveData {
  let next = save
  for (const reward of rewards) {
    if (reward.kind === 'chests') {
      // 宝箱はストックの上限まで。あふれた分は宝箱チケット（持ち物）にして消さない
      const room = Math.max(0, LAMP.stockCap - next.lamps)
      const now = Math.min(room, reward.amount)
      next = { ...next, lamps: next.lamps + now }
      if (reward.amount > now) {
        next = addItem(next, 'chest-ticket', reward.amount - now)
      }
    } else if (reward.kind === 'gold') {
      next = { ...next, gold: next.gold + psychicGoldReward(next, priceUnit(next) * reward.times) }
    } else if (reward.kind === 'stars') {
      next = { ...next, wallet: { ...next.wallet, stars: next.wallet.stars + psychicStarReward(next, reward.amount) } }
    } else if (reward.kind === 'psi') {
      next = { ...next, wallet: { ...next.wallet, psi: next.wallet.psi + reward.amount } }
    } else if (reward.kind === 'item') {
      next = addItem(next, reward.id, reward.amount)
    } else if (!next.titles.owned.includes(reward.id)) {
      next = { ...next, titles: { ...next.titles, owned: [...next.titles.owned, reward.id] } }
    }
  }

  return next
}

// ---- 遊んだ日を数える ----

export type PlayDay = {
  save: SaveData
  /** 今日はじめての回答だった（遊んだ日が 1 増えた） */
  isNewDay: boolean
  /** 今日開いた施設 */
  unlocked?: FeatureId
  /** 今日押したスタンプ */
  stamp?: ReturnType<typeof stampAt>
}

/**
 * 回答が終わったとき: 今日まだ数えていなければ、遊んだ日 +1・スタンプを 1 つ押してごほうび・その日数の施設が開く。
 * 同じ日の 2 回目からは何もしない
 */
export function recordPlay(input: SaveData, day: string): PlayDay {
  const calendar = input.calendar
  if (calendar.lastPlayedDay === day) {
    return { save: input, isNewDay: false }
  }
  const playedDays = calendar.playedDays + 1
  const stamps = calendar.stamps + 1
  const stamp = stampAt(stamps)
  const save = grant(
    {
      ...input,
      calendar: { ...calendar, playedDays, stamps, lastPlayedDay: day, firstDay: calendar.firstDay || day },
      wallet: { ...input.wallet, psi: input.wallet.psi + 1 },
    },
    stamp.rewards,
  )
  const unlocked = FEATURES.find(f => f.day === playedDays && f.day > 1)?.id

  return { save, isNewDay: true, stamp, ...(unlocked === undefined ? {} : { unlocked }) }
}

/** 開発用チート: 遊んだ日数を決める（スタンプは押さない） */
export function setPlayedDays(save: SaveData, days: number): SaveData {
  return { ...save, calendar: { ...save.calendar, playedDays: Math.max(0, Math.floor(days)) } }
}
