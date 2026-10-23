import type { BuffKind, FeatureId, Item, SaveData, ShopState } from '../types'
import { addBuff } from './buffs'
import { addItem, featureDay, isUnlocked, priceUnit, READY } from './calendar'
import { COLLAR_KINDS, collarId, feedPet, usePremiumEgg } from './pets'
import { useSealedFragment } from './premium'
import { LAMP } from './config'
import { CROPS, QUALITIES, QUALITY_SELL, cropItemId, farmLevel, gainSeed, seedId } from './farm'
import { RARITY_COUNT, applyGoldenHand, itemPower, judge, random, rollItem } from './gear'
import { hasPsychicNode, psychicGoldRate, psychicStarReward } from './psychic'

// 商店（2 日目、docs/DAILY.md の 3 章）。$ を使わない純粋な関数。
// 品は「日付・入れ替えた回数・セーブの種」から決める（同じ日なら、どのセッションでも同じ品）。値段は物価 P の何倍か。

/** 品を使ったときの効き目 */
export type Use =
  | { kind: 'chests' }
  | { kind: 'buff'; buff: BuffKind; rate: number; seconds?: number; charges?: number }
  | { kind: 'box'; rarity: number }
  | { kind: 'seeds' }
  | { kind: 'petFood' }
  | { kind: 'psiBook' }
  | { kind: 'petEgg' }
  | { kind: 'collarBox' }
  | { kind: 'timeSand' }
  | { kind: 'sealedShard' }
  | { kind: 'contract' }

/** 商店の品。price = 物価 P の何倍、limit = 1 日に買える数、gives = 買うと持ち物に入るもの、needs = その施設が開いていると並ぶ、minFarmLv = 農場 Lv がこれ以上で並ぶ（種） */
export type Good = { id: string; price: number; limit: number; gives: { id: string; amount: number }; needs: FeatureId; minFarmLv?: number }

export const GOODS: readonly Good[] = [
  { id: 'chest-ticket', price: 0.6, limit: 10, gives: { id: 'chest-ticket', amount: 1 }, needs: 'shop' },
  { id: 'chest-ticket-10', price: 5.5, limit: 1, gives: { id: 'chest-ticket', amount: 10 }, needs: 'shop' },
  ...(['s', 'm', 'l'] as const).flatMap((size, i) => [
    { id: `potion-power-${size}`, price: [0.5, 1.2, 2.5][i]!, limit: 3, gives: { id: `potion-power-${size}`, amount: 1 }, needs: 'shop' as const },
    { id: `potion-learn-${size}`, price: [0.5, 1.2, 2.5][i]!, limit: 3, gives: { id: `potion-learn-${size}`, amount: 1 }, needs: 'shop' as const },
    { id: `potion-gold-${size}`, price: [0.5, 1.2, 2.5][i]!, limit: 3, gives: { id: `potion-gold-${size}`, amount: 1 }, needs: 'shop' as const },
    { id: `potion-luck-${size}`, price: [0.8, 1.8, 3.5][i]!, limit: 2, gives: { id: `potion-luck-${size}`, amount: 1 }, needs: 'shop' as const },
  ]),
  { id: 'pick-10', price: 0.5, limit: 5, gives: { id: 'pick', amount: 10 }, needs: 'mine' },
  { id: 'bomb', price: 1, limit: 3, gives: { id: 'bomb', amount: 1 }, needs: 'mine' },
  { id: 'fertilizer', price: 0.3, limit: 10, gives: { id: 'fertilizer', amount: 1 }, needs: 'farm' },
  // 種（作物ごと。農場 Lv で開いた作物だけ並ぶ）
  ...CROPS.filter(c => c.locked === undefined).map(c => ({ id: seedId(c.id), price: c.seed, limit: 20, gives: { id: seedId(c.id), amount: 1 }, needs: 'farm' as const, minFarmLv: c.lv })),
  { id: 'treat', price: 0.3, limit: 10, gives: { id: 'treat', amount: 1 }, needs: 'pet' },
  { id: 'lunchbox', price: 0.8, limit: 3, gives: { id: 'lunchbox', amount: 1 }, needs: 'expedition' },
  { id: 'ingot-copper', price: 0.4, limit: 10, gives: { id: 'ingot-copper', amount: 1 }, needs: 'smith' },
  { id: 'ingot-iron', price: 0.8, limit: 10, gives: { id: 'ingot-iron', amount: 1 }, needs: 'smith' },
]

/** 持ち物を使ったときの効き目（薬は戦闘の秒数で 30 分、幸運の薬は宝箱 30 回） */
export const USES: Record<string, Use> = {
  'chest-ticket': { kind: 'chests' },
  'box-legend': { kind: 'box', rarity: 4 },
  'box-myth': { kind: 'box', rarity: 5 },
  egg: { kind: 'petEgg' },
  'psi-book': { kind: 'psiBook' },
  'collar-box': { kind: 'collarBox' },
  'time-sand': { kind: 'timeSand' },
  'sealed-shard': { kind: 'sealedShard' },
  contract: { kind: 'contract' },
  'seed-pack': { kind: 'seeds' },
  treat: { kind: 'petFood' },
  'pet-meal': { kind: 'petFood' },
  ...Object.fromEntries(
    (['s', 'm', 'l'] as const).flatMap((size, i) => [
      [`potion-power-${size}`, { kind: 'buff', buff: 'power', rate: [0.15, 0.25, 0.4][i]!, seconds: 1800 }],
      [`potion-learn-${size}`, { kind: 'buff', buff: 'exp', rate: [0.2, 0.35, 0.5][i]!, seconds: 1800 }],
      [`potion-gold-${size}`, { kind: 'buff', buff: 'gold', rate: [0.2, 0.35, 0.5][i]!, seconds: 1800 }],
      [`potion-luck-${size}`, { kind: 'buff', buff: 'luck', rate: [0.05, 0.1, 0.15][i]!, charges: 30 }],
    ]),
  ),
}

/** 売れる持ち物の値段（物価 P の何倍）。鉱石・作物などは施設を作るときに足す */
export const SELL_PRICES: Record<string, number> = {
  'ore-copper': 0.01,
  'ore-iron': 0.02,
  'ore-crystal': 0.04,
  'ore-mithril': 0.08,
  'ore-adamant': 0.15,
  'ore-stariron': 0.3,
  'ore-silver': 0.12,
  'ore-gold': 0.35,
  'ingot-gold': 4.5,
  wood: 0.01,
  'animal-egg': 0.15,
  'animal-milk': 0.3,
  'animal-wool': 0.6,
  'animal-honey': 0.5,
  'smith-dust': 0.03,
  'guard-stone': 0.2,
  'gem-amber': 0.05,
  'gem-amethyst': 0.1,
  'gem-sapphire': 0.2,
  'gem-emerald': 0.4,
  'gem-ruby': 0.8,
  'gem-starquartz': 1.5,
  fossil: 0.1,
  pebble: 0.003,
  'egg-shard': 0.02,
  ...Object.fromEntries(Array.from({ length: 10 }, (_, index) => [`boss-shard-${index + 1}`, 0.2])),
  lunchbox: 0.08,
  // 作物は品質ごとに（★1〜★3・金色 10 倍）
  ...Object.fromEntries(CROPS.flatMap(c => QUALITIES.map(q => [cropItemId(c.id, q), c.sell * (QUALITY_SELL[q] ?? 1)]))),
  ...Object.fromEntries(GOODS.filter(g => g.id.startsWith('potion-')).map(g => [g.id, g.price * 0.3])),
}

/** 1 日の品の数（好感度 4 で 7 枠目、10 で 8 枠目） */
export const BASE_SLOTS = 6

/** 好感度のレベル（1〜10）に必要な点 */
export const AFFINITY_POINTS: readonly number[] = [0, 5, 15, 30, 50, 80, 120, 170, 230, 300]
/** 常連ランク（ブロンズ〜プラチナ）に必要な、使った額の合計（物価 P の何倍か） */
export const RANK_SPENT: readonly number[] = [50, 200, 800, 3000]
/** ランクごとの 1 日の上限の倍率（ランクなし・ブロンズ〜プラチナ） */
export const RANK_LIMIT: readonly number[] = [1, 1.5, 2, 2.5, 3]
/** 先輩のおまけ: 商店が開いてから 3 日間、20% 引き */
export const VETERAN = { days: 3, discount: 0.2 }
/** 手動の入れ替え: 1 回目は P × 0.2、そのあと 2 倍ずつ */
export const REFRESH_PRICE = 0.2
/** 日替わり特価の割引 */
export const DEAL_OFF = 0.5

export const emptyShop = (): ShopState => ({ day: '', refreshes: 0, bought: {}, points: 0, spent: 0, greetDay: '', amuletWeek: '', bagWeek: '' })

/** 文字列から決まった数（FNV-1a） */
function hash(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    h = Math.imul(h ^ text.charCodeAt(i), 0x01000193)
  }

  return h >>> 0
}

/** 日付が変わっていたら、入れ替えた回数と今日買った数を戻す */
export function rollShopDay(save: SaveData, day: string): SaveData {
  return save.shop.day === day ? save : { ...save, shop: { ...save.shop, day, refreshes: 0, bought: {} } }
}

/** 好感度のレベル（1〜10） */
export const affinityLevel = (save: SaveData): number => AFFINITY_POINTS.filter(points => save.shop.points >= points).length

/** 常連ランク（0 = なし、1 ブロンズ 〜 4 プラチナ） */
export const rankOf = (save: SaveData): number => RANK_SPENT.filter(spent => save.shop.spent >= spent).length

/** 全品の割引（好感度 3・6・9 で 2・4・6%、先輩のおまけ 20%）。値段にかける倍率 */
export function discountRate(save: SaveData): number {
  const level = affinityLevel(save)
  const affinity = level >= 9 ? 0.06 : level >= 6 ? 0.04 : level >= 3 ? 0.02 : 0
  const opened = featureDay('shop')
  const isVeteranTime = save.calendar.isVeteran && save.calendar.playedDays < opened + VETERAN.days

  return (1 - affinity) * (isVeteranTime ? 1 - VETERAN.discount : 1) * (hasPsychicNode(save, 'fortune-6') ? 0.95 : 1)
}

/** いま並べられる品（開いていて、作り終わった施設の品だけ） */
export const pool = (save: SaveData): Good[] =>
  GOODS.filter(good => READY.has(good.needs) && isUnlocked(save, good.needs) && (good.minFarmLv === undefined || farmLevel(save) >= good.minFarmLv))

export type Slot = { good: Good; price: number; isDeal: boolean; left: number }

/** 今日の品（day は今日。セーブの日付が古くても今日の品を出す） */
export function stock(save: SaveData, day: string): Slot[] {
  const current = rollShopDay(save, day)
  const goods = pool(current)
  const level = affinityLevel(current)
  const count = Math.min(goods.length, BASE_SLOTS + (level >= 4 ? 1 : 0) + (level >= 10 ? 1 : 0))
  let state = hash(`${day}:${current.shop.refreshes}:${current.createdAt}`)
  const draw = (): number => {
    const r = random(state)
    state = r.state
    return r.value
  }
  const left = [...goods]
  const picked: Good[] = []
  while (picked.length < count && left.length > 0) {
    picked.push(left.splice(Math.floor(draw() * left.length), 1)[0]!)
  }
  // 日替わり特価: 1 枠（好感度 8 で 2 枠）。入れ替えても特価の枠は日付で決まる
  const dealCount = level >= 8 ? 2 : 1
  const dealStart = hash(`deal:${day}:${current.createdAt}`) % Math.max(1, picked.length)
  const deals = new Set(Array.from({ length: dealCount }, (_, i) => (dealStart + i) % Math.max(1, picked.length)))
  const limitRate = RANK_LIMIT[rankOf(current)] ?? 1
  const unit = priceUnit(current) * discountRate(current)

  return picked.map((good, i) => {
    const isDeal = deals.has(i)
    const limit = Math.floor(good.limit * limitRate)

    return { good, isDeal, price: Math.max(1, Math.round(good.price * unit * (isDeal ? 1 - DEAL_OFF : 1))), left: Math.max(0, limit - (current.shop.bought[good.id] ?? 0)) }
  })
}

/** 品を count 個買う。お金・上限・並んでいない品なら undefined */
export function buy(save: SaveData, day: string, id: string, count: number): SaveData | undefined {
  const current = rollShopDay(save, day)
  const slot = stock(current, day).find(s => s.good.id === id)
  if (slot === undefined || count < 1 || count > slot.left || current.gold < slot.price * count) {
    return undefined
  }
  const cost = slot.price * count
  const unit = priceUnit(current)
  const bought = addItem(current, slot.good.gives.id, slot.good.gives.amount * count)

  return {
    ...bought,
    gold: bought.gold - cost,
    shop: {
      ...bought.shop,
      bought: { ...bought.shop.bought, [id]: (bought.shop.bought[id] ?? 0) + count },
      // 好感度と常連ランクは、使った額（物価 P の何倍か）で上がる
      points: bought.shop.points + cost / unit,
      spent: bought.shop.spent + cost / unit,
    },
  }
}

/** 手動の入れ替えの値段（好感度 5 で 1 日 1 回無料） */
export function refreshPrice(save: SaveData, day: string): number {
  const current = rollShopDay(save, day)
  const free = affinityLevel(current) >= 5 ? 1 : 0
  const paid = current.shop.refreshes - free

  return paid < 0 ? 0 : Math.round(priceUnit(current) * REFRESH_PRICE * Math.pow(2, paid))
}

/** 品を入れ替える */
export function refresh(save: SaveData, day: string): SaveData | undefined {
  const current = rollShopDay(save, day)
  const price = refreshPrice(current, day)
  if (current.gold < price) {
    return undefined
  }

  return { ...current, gold: current.gold - price, shop: { ...current.shop, refreshes: current.shop.refreshes + 1 } }
}

/** その日はじめての来店で好感度 +2（あいさつ） */
export function greet(save: SaveData, day: string): SaveData {
  return save.shop.greetDay === day ? save : { ...save, shop: { ...save.shop, greetDay: day, points: save.shop.points + 2 } }
}

/** 売値（1 個、ゴールド）。売れないものは 0。常連ランクごとに +5% */
export function sellPrice(save: SaveData, id: string): number {
  const times = SELL_PRICES[id]

  const psychicBonus = (hasPsychicNode(save, 'fortune-4') ? 1.1 : 1) * (1 + psychicGoldRate(save))
  return times === undefined ? 0 : Math.max(1, Math.round(times * priceUnit(save) * (1 + 0.05 * rankOf(save)) * psychicBonus))
}

/** 持ち物を売る */
export function sellItem(save: SaveData, id: string, count: number): SaveData | undefined {
  const have = save.bag[id] ?? 0
  const price = sellPrice(save, id)
  if (price <= 0 || count < 1 || count > have) {
    return undefined
  }

  return { ...addItem(save, id, -count), gold: save.gold + price * count }
}

/** 決まったレア度の装備を 1 つ作る（伝説箱・神話箱・ミナのお守り） */
export function rollAtRarity(save: SaveData, rarity: number, slot?: Item['slot'], isChest = false): { save: SaveData; item: Item } {
  const rolled = rollItem(save)
  const r = random(rolled.save.rng)
  const fixed = Math.min(RARITY_COUNT - 1, Math.max(rarity, rolled.item.rarity))
  const at = slot ?? rolled.item.slot

  const result = { save: { ...rolled.save, rng: r.state }, item: { ...rolled.item, slot: at, rarity: fixed, power: itemPower(at, save.level, fixed, r.value) } }
  if (!isChest) return result
  const golden = applyGoldenHand(result.save, result.item)
  return { save: golden.save, item: golden.item }
}

/**
 * 持ち物を 1 つ使う。宝箱チケット = 宝箱 +1（ストックの上限まで）、薬 = バフ、伝説箱・神話箱 = 装備（自動判断か手動確認）。
 * 使えないとき（無い・宝箱がいっぱい・もっと強い薬が効いている・確認待ちの装備がある）は undefined
 */
export function useItem(save: SaveData, id: string, now: number): SaveData | undefined {
  const use = USES[id]
  if (use === undefined || (save.bag[id] ?? 0) < 1) {
    return undefined
  }
  if (use.kind === 'petEgg') return usePremiumEgg(save)
  if (use.kind === 'sealedShard') return useSealedFragment(save)
  if (use.kind === 'contract') {
    if (!READY.has('expedition') || !isUnlocked(save, 'expedition') || save.expedition.contract) return undefined
    const adventurers = [...save.expedition.adventurers, { id: 'luna' as const, level: 1, exp: 0 }]
    return { ...addItem(save, id, -1), expedition: { adventurers, contract: true } }
  }
  if (use.kind === 'timeSand') {
    const adventurer = save.expedition.adventurers.find(item => {
      const trip = item.trip
      return trip !== undefined && trip.startAt + trip.hours * 3_600_000 * (trip.lunch === 'lunchbox' ? 0.8 : trip.lunch === 'dish-onigiri' ? 0.9 : 1) > now
    })
    if (adventurer?.trip === undefined) return undefined
    const duration = adventurer.trip.hours * 3_600_000 * (adventurer.trip.lunch === 'lunchbox' ? 0.8 : adventurer.trip.lunch === 'dish-onigiri' ? 0.9 : 1)
    const spent = addItem(save, id, -1)
    return { ...spent, expedition: { ...spent.expedition, adventurers: spent.expedition.adventurers.map(item => item.id === adventurer.id && item.trip !== undefined ? { ...item, trip: { ...item.trip, startAt: now - duration } } : item) } }
  }
  const spent = addItem(save, id, -1)
  if (use.kind === 'chests') {
    return save.lamps >= LAMP.stockCap ? undefined : { ...spent, lamps: spent.lamps + 1 }
  }
  if (use.kind === 'seeds') {
    return gainSeed(spent)
  }
  if (use.kind === 'petFood') {
    return feedPet(save, id as 'treat' | 'pet-meal')
  }
  if (use.kind === 'psiBook') {
    return { ...spent, wallet: { ...spent.wallet, psi: spent.wallet.psi + 1 } }
  }
  if (use.kind === 'collarBox') {
    const kindRoll = random(spent.rng)
    const rarityRoll = random(kindRoll.state)
    const kind = COLLAR_KINDS[Math.floor(kindRoll.value * COLLAR_KINDS.length)] ?? 'speed'
    const rarity = 2 + Math.floor(rarityRoll.value * 4)
    return addItem({ ...spent, rng: rarityRoll.state }, collarId(kind, rarity), 1)
  }
  if (use.kind === 'buff') {
    return addBuff(spent, use.buff, use.rate, { seconds: use.seconds, charges: use.charges })
  }
  if (save.pending !== null) {
    return undefined
  }
  const rolled = rollAtRarity(spent, use.rarity, undefined, true)

  return judge(rolled.save, rolled.item, now).save
}

/** ISO の週（月曜はじまり）。day は YYYY-MM-DD */
export function weekKey(day: string): string {
  const date = new Date(`${day}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) {
    return ''
  }
  const monday = new Date(date.getTime() - ((date.getUTCDay() + 6) % 7) * 86_400_000)

  return monday.toISOString().slice(0, 10)
}

/** 好感度 7: 週に 1 回「ミナの手作りお守り」（飾り枠、レジェンド） */
export function takeAmulet(save: SaveData, day: string, now: number): SaveData | undefined {
  const week = weekKey(day)
  if (affinityLevel(save) < 7 || save.shop.amuletWeek === week || save.pending !== null) {
    return undefined
  }
  const rolled = rollAtRarity(save, 4, 'charm')

  return judge({ ...rolled.save, shop: { ...rolled.save.shop, amuletWeek: week } }, rolled.item, now).save
}

/** プラチナ: 週に 1 回「常連の福袋」（宝箱チケット 10〜50・星のかけら 10〜30・ときどき金色の種） */
export function takeLuckyBag(save: SaveData, day: string): SaveData | undefined {
  const week = weekKey(day)
  if (rankOf(save) < RANK_SPENT.length || save.shop.bagWeek === week) {
    return undefined
  }
  let state = save.rng
  const draw = (): number => {
    const r = random(state)
    state = r.state
    return r.value
  }
  const tickets = 10 + Math.floor(draw() * 41)
  const stars = 10 + Math.floor(draw() * 21)
  const seed = draw() < 0.3 ? 1 : 0
  let next: SaveData = { ...save, rng: state, wallet: { ...save.wallet, stars: save.wallet.stars + psychicStarReward(save, stars) }, shop: { ...save.shop, bagWeek: week } }
  next = addItem(next, 'chest-ticket', tickets)

  return seed > 0 ? addItem(next, 'gold-seed', seed) : next
}
