import type { FeatureId, SaveData } from '../types'
import { addItem, isUnlocked, priceUnit, READY } from './calendar'
import { itemPower, judge, random, rollItem } from './gear'

// 上級商店と闇市。セーブと日付から品を決める純粋な計算。

type PremiumGood = { id: string; price: number; limit: number; needs: FeatureId; oneTime?: boolean }
export type PremiumSlot = { good: PremiumGood; price: number; left: number; isSale: boolean }

const ALWAYS: readonly PremiumGood[] = [
  { id: 'box-legend', price: 80, limit: 5, needs: 'premium' },
  { id: 'guard-stone', price: 40, limit: 5, needs: 'premium' },
  { id: 'psi-book', price: 60, limit: 3, needs: 'premium' },
  { id: 'gold-seed', price: 50, limit: 3, needs: 'premium' },
]

/** 週替わり候補。まだ作っていない施設の品は候補に表示しない。 */
const ROTATING: readonly PremiumGood[] = [
  { id: 'box-myth', price: 400, limit: 1, needs: 'premium' },
  { id: 'egg', price: 250, limit: 1, needs: 'pet' },
  { id: 'drone', price: 300, limit: 1, needs: 'mine', oneTime: true },
  { id: 'sprinkler', price: 150, limit: 3, needs: 'bigfarm' },
  { id: 'collar-box', price: 100, limit: 2, needs: 'pet' },
  { id: 'contract', price: 200, limit: 1, needs: 'expedition', oneTime: true },
  { id: 'soul-lamp', price: 500, limit: 1, needs: 'codex', oneTime: true },
  // 限定の飾り（decoration）は、置く場所を作るまで売らない。もう買った人の持ち物（bag.decoration）はそのまま残す
]

const MARKET_ITEMS = ['mystery-box', 'time-sand', 'sealed-shard', 'curse-gear', 'stolen-pick'] as const
export type BlackMarketItemId = (typeof MARKET_ITEMS)[number]
export type BlackMarketSlot = { id: BlackMarketItemId; currency: 'gold' | 'stars'; price: number; left?: number }

/** 銀鉱 100 個 = 星のかけら 10（1 週間に 5 回まで） */
export const SILVER_EXCHANGE = { ore: 100, stars: 10, weekly: 5 }

export const emptyPremium = (): SaveData['premium'] => ({ week: '', bought: {}, saleWeek: '' })
export const emptyBlackMarket = (): SaveData['blackMarket'] => ({ night: '', bought: {}, points: 0, stories: [] })

function hash(text: string): number {
  let value = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) value = Math.imul(value ^ text.charCodeAt(i), 0x01000193)
  return value >>> 0
}

function localDate(now: number): string {
  const date = new Date(now)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** ISO 週（月曜はじまり）。 */
export function premiumWeekKey(day: string): string {
  const date = new Date(`${day}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return ''
  const monday = new Date(date.getTime() - ((date.getUTCDay() + 6) % 7) * 86_400_000)
  return monday.toISOString().slice(0, 10)
}

function available(save: SaveData, good: PremiumGood): boolean {
  const petPairReady = READY.has('pet2') && isUnlocked(save, 'pet2')
  return READY.has(good.needs) && isUnlocked(save, good.needs) && !(good.id === 'egg' && save.pets.owned.length > 0 && !petPairReady)
}

function ordered<T extends { id: string }>(goods: readonly T[], seed: string): T[] {
  return [...goods].sort((a, b) => hash(`${seed}:${a.id}`) - hash(`${seed}:${b.id}`))
}

function premiumBought(save: SaveData, id: string, week: string, oneTime: boolean): number {
  if (oneTime) return save.premium.bought[`ever:${id}`] ?? 0
  return save.premium.week === week ? save.premium.bought[id] ?? 0 : 0
}

function saleId(save: SaveData, week: string, goods: readonly PremiumGood[]): string | undefined {
  if (goods.length === 0) return undefined
  const index = hash(`${save.createdAt}:${week}:sale`) % goods.length
  return goods[index]?.id
}

function weekend(now: number): boolean {
  const day = new Date(now).getDay()
  return day === 0 || day === 6
}

/** 週替わり 8 枠と常設 4 枠。 */
export function premiumStock(save: SaveData, day: string, now: number): PremiumSlot[] {
  const week = premiumWeekKey(day)
  if (!READY.has('premium') || !isUnlocked(save, 'premium')) return []
  const rotating = ordered(ROTATING.filter(good => available(save, good)), `${save.createdAt}:${week}`)
  const goods = [...rotating, ...ALWAYS.filter(good => available(save, good))]
  const sale = weekend(now) ? saleId(save, week, goods) : undefined

  return goods.map(good => {
    const isSale = good.id === sale
    const fullPrice = good.price
    const price = isSale ? Math.max(1, Math.round(fullPrice * 0.7)) : fullPrice
    const bought = premiumBought(save, good.id, week, good.oneTime === true)
    return { good, price, left: Math.max(0, good.limit - bought), isSale }
  })
}

function premiumForWeek(save: SaveData, week: string): SaveData['premium'] {
  if (save.premium.week === week) return save.premium
  const bought = Object.fromEntries(Object.entries(save.premium.bought).filter(([id]) => id.startsWith('ever:')))
  return { week, bought, saleWeek: '' }
}

/** 上級商店で 1 品買う。星のかけら不足・上限・未解放は undefined。 */
export function buyPremium(save: SaveData, day: string, now: number, id: string): SaveData | undefined {
  const slot = premiumStock(save, day, now).find(item => item.good.id === id)
  if (slot === undefined || slot.left < 1 || save.wallet.stars < slot.price) return undefined
  const week = premiumWeekKey(day)
  const premium = premiumForWeek(save, week)
  const key = slot.good.oneTime === true ? `ever:${id}` : id
  const bought = { ...premium.bought, [key]: (premium.bought[key] ?? 0) + 1 }
  const next = addItem({
    ...save,
    wallet: { ...save.wallet, stars: save.wallet.stars - slot.price },
    premium: { ...premium, bought, saleWeek: slot.isSale ? week : premium.saleWeek },
  }, id, 1)

  return next
}

/** 本編ボスの初回撃破は 50、再戦は 10。撃破章も記録する。 */
export function awardBossStars(save: SaveData, wins: readonly number[]): SaveData {
  if (wins.length === 0) return save
  const beaten = new Set(save.beatenBosses)
  let stars = 0
  for (const chapter of wins) {
    if (!Number.isInteger(chapter) || chapter < 1 || chapter > 10) continue
    stars += beaten.has(chapter) ? 10 : 50
    beaten.add(chapter)
  }
  if (stars === 0) return save
  return { ...save, beatenBosses: [...beaten].sort((a, b) => a - b), wallet: { ...save.wallet, stars: save.wallet.stars + stars } }
}

function actualNight(now: number): string {
  const date = new Date(now)
  const hour = date.getHours()
  if (hour >= 22) return localDate(now)
  if (hour < 4) return localDate(now - 4 * 60 * 60 * 1000)
  return ''
}

function cheatNight(save: SaveData, now: number): string {
  const today = localDate(now)
  return save.blackMarket.night === `cheat:${today}` ? today : ''
}

export function blackMarketNightKey(save: SaveData, now: number): string {
  return actualNight(now) || cheatNight(save, now)
}

export function isBlackMarketOpen(save: SaveData, now: number): boolean {
  return blackMarketNightKey(save, now) !== ''
}

function boughtForNight(save: SaveData, night: string): Record<string, number> {
  const current = save.blackMarket.night.replace(/^cheat:/, '')
  return current === night ? save.blackMarket.bought : {}
}

function activeCheat(save: SaveData, night: string): boolean {
  return save.blackMarket.night === `cheat:${night}`
}

/** 夜の日付とセーブの種から、今夜の商品を 3 品決める。 */
export function blackMarketStock(save: SaveData, now: number): BlackMarketSlot[] {
  const night = blackMarketNightKey(save, now)
  if (night === '') return []
  const P = priceUnit(save)
  const prices: Record<BlackMarketItemId, { currency: 'gold' | 'stars'; price: number }> = {
    'mystery-box': { currency: 'gold', price: P * 3 },
    'time-sand': { currency: 'stars', price: 40 },
    'sealed-shard': { currency: 'stars', price: 120 },
    'curse-gear': { currency: 'gold', price: P * 10 },
    'stolen-pick': { currency: 'gold', price: P },
  }
  const selected = ordered(MARKET_ITEMS.map(id => ({ id })), `${save.createdAt}:${night}`).slice(0, 3)
  const bought = boughtForNight(save, night)
  return selected.map(({ id }) => ({ id, ...prices[id], ...(id === 'stolen-pick' ? { left: Math.max(0, 1 - (bought[id] ?? 0)) } : {}) }))
}

/** ノクスへの来店は一晩に 1 回だけ好感度を上げ、5 夜で読み物を 1 話ずつ開く。 */
export function visitBlackMarket(save: SaveData, now: number): SaveData | undefined {
  const night = blackMarketNightKey(save, now)
  if (night === '') return undefined
  const bought = boughtForNight(save, night)
  if ((bought.visit ?? 0) > 0) return undefined
  const points = save.blackMarket.points + 1
  const nextStory = Math.min(5, points)
  const stories = nextStory > 0 && !save.blackMarket.stories.includes(`nox-${nextStory}`)
    ? [...save.blackMarket.stories, `nox-${nextStory}`]
    : save.blackMarket.stories
  return {
    ...save,
    blackMarket: {
      ...save.blackMarket,
      night: activeCheat(save, night) ? `cheat:${night}` : night,
      bought: { ...bought, visit: 1 },
      points,
      stories,
    },
  }
}

export function finishBlackMarketIntro(save: SaveData): SaveData {
  return save.blackMarket.stories.includes('intro')
    ? save
    : { ...save, blackMarket: { ...save.blackMarket, stories: [...save.blackMarket.stories, 'intro'] } }
}

function randomDraw(state: number): { value: number; state: number } {
  return random(state)
}

/** 闇市で商品を 1 つ買う。 */
export function buyBlackMarket(save: SaveData, now: number, id: BlackMarketItemId): SaveData | undefined {
  const slot = blackMarketStock(save, now).find(item => item.id === id)
  const night = blackMarketNightKey(save, now)
  if (night === '' || slot === undefined || (slot.left !== undefined && slot.left < 1)) return undefined
  if ((slot.currency === 'gold' ? save.gold < slot.price : save.wallet.stars < slot.price) || (id === 'curse-gear' && save.pending !== null)) return undefined

  const bought = boughtForNight(save, night)
  let next: SaveData = {
    ...save,
    ...(slot.currency === 'gold' ? { gold: save.gold - slot.price } : { wallet: { ...save.wallet, stars: save.wallet.stars - slot.price } }),
    blackMarket: {
      ...save.blackMarket,
      night: activeCheat(save, night) ? `cheat:${night}` : night,
      bought: { ...bought, [id]: (bought[id] ?? 0) + 1 },
    },
  }

  if (id === 'mystery-box') {
    const draw = randomDraw(next.rng)
    next = { ...next, rng: draw.state }
    if (draw.value >= 0.3 && draw.value < 0.35) next = addItem(next, 'box-myth', 1)
    else if (draw.value >= 0.35 && draw.value < 0.57) next = addItem(next, 'chest-ticket', 1)
    else if (draw.value >= 0.57 && draw.value < 0.79) next = addItem(next, 'potion-power-s', 1)
    else if (draw.value >= 0.79 && draw.value < 0.95) next = addItem(next, 'potion-learn-s', 1)
    else if (draw.value >= 0.95) next = { ...next, wallet: { ...next.wallet, stars: next.wallet.stars + 5 } }
  } else if (id === 'time-sand') {
    next = addItem(next, 'time-sand', 1)
  } else if (id === 'sealed-shard') {
    next = addItem(next, 'sealed-shard', 1)
  } else if (id === 'stolen-pick') {
    next = addItem(next, 'pick', 30)
  } else if (id === 'curse-gear') {
    const rolled = rollItem(next)
    const powerRoll = random(rolled.save.rng)
    const item = {
      ...rolled.item,
      rarity: 4,
      power: itemPower(rolled.item.slot, rolled.item.level, 4, powerRoll.value),
      curse: true,
    }
    next = judge({ ...rolled.save, rng: powerRoll.state }, item, now).save
  }

  return next
}

/** 封印の破片を使い、真のラスボスの伝承を次の 1 話だけ開く。 */
export function useSealedFragment(save: SaveData): SaveData | undefined {
  if ((save.bag['sealed-shard'] ?? 0) < 1) return undefined
  const index = Array.from({ length: 7 }, (_, i) => i + 1).find(i => !save.blackMarket.stories.includes(`sealed-${i}`))
  if (index === undefined) return undefined
  return {
    ...addItem(save, 'sealed-shard', -1),
    blackMarket: { ...save.blackMarket, stories: [...save.blackMarket.stories, `sealed-${index}`] },
  }
}

/** /dl-cheat night 用。現在のローカル日付だけ闇市を開く。 */
export function cheatOpenBlackMarket(save: SaveData, now: number): SaveData {
  const today = localDate(now)
  return { ...save, blackMarket: { ...save.blackMarket, night: `cheat:${today}`, bought: {} } }
}

/** 今週、あと何回銀鉱を星のかけらに換えられるか */
export function silverExchangeLeft(save: SaveData, day: string): number {
  const week = premiumWeekKey(day)

  return Math.max(0, SILVER_EXCHANGE.weekly - premiumBought(save, 'silver-exchange', week, false))
}

/** 銀鉱 100 個を星のかけら 10 に換える（上級商店と同じ週の上限）。金山銀山が開いていないとき・銀鉱が足りないとき・上限は undefined */
export function exchangeSilver(save: SaveData, day: string): SaveData | undefined {
  if (!READY.has('goldmine') || !isUnlocked(save, 'goldmine') || (save.bag['ore-silver'] ?? 0) < SILVER_EXCHANGE.ore || silverExchangeLeft(save, day) < 1) return undefined
  const week = premiumWeekKey(day)
  const premium = premiumForWeek(save, week)
  const next = addItem(save, 'ore-silver', -SILVER_EXCHANGE.ore)

  return {
    ...next,
    wallet: { ...next.wallet, stars: next.wallet.stars + SILVER_EXCHANGE.stars },
    premium: { ...premium, bought: { ...premium.bought, 'silver-exchange': (premium.bought['silver-exchange'] ?? 0) + 1 } },
  }
}
