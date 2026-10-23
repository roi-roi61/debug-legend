import type { Item, SaveData, SlotId } from '../types'
import { addItem, priceUnit } from './calendar'
import { effectiveItemPower, itemPower, random, sellValue, SET_IDS, BOSS_GEAR_IDS } from './gear'

// 鍛冶屋の計算。画面や $ に依存せず、乱数もセーブの rng から進める。

export const STASH_CAP = 60
/** 金の装飾に使う金鉱の数 */
export const GOLD_TRIM_ORE = 30
export const SMITH_SETS = [
  { id: SET_IDS[0], ore: 'ore-copper', name: 'copper-miner' },
  { id: SET_IDS[1], ore: 'ore-iron', name: 'iron-guardian' },
  { id: SET_IDS[2], ore: 'ore-crystal', name: 'crystal-sage' },
  { id: SET_IDS[3], ore: 'ore-mithril', name: 'mithril-swift' },
  { id: SET_IDS[4], ore: 'ore-adamant', name: 'adamant-lord' },
] as const

export const BOSS_RECIPES: readonly { id: (typeof BOSS_GEAR_IDS)[number]; chapter: number; slot: SlotId; ore: string }[] = [
  { id: BOSS_GEAR_IDS[0], chapter: 1, slot: 'body', ore: 'ore-copper' },
  { id: BOSS_GEAR_IDS[1], chapter: 2, slot: 'charm', ore: 'ore-iron' },
  { id: BOSS_GEAR_IDS[2], chapter: 3, slot: 'arms', ore: 'ore-crystal' },
  { id: BOSS_GEAR_IDS[3], chapter: 4, slot: 'weapon', ore: 'ore-mithril' },
  { id: BOSS_GEAR_IDS[4], chapter: 5, slot: 'charm', ore: 'ore-adamant' },
  { id: BOSS_GEAR_IDS[5], chapter: 6, slot: 'head', ore: 'ore-copper' },
  { id: BOSS_GEAR_IDS[6], chapter: 7, slot: 'body', ore: 'ore-iron' },
  { id: BOSS_GEAR_IDS[7], chapter: 8, slot: 'body', ore: 'ore-crystal' },
  { id: BOSS_GEAR_IDS[8], chapter: 9, slot: 'weapon', ore: 'ore-mithril' },
  { id: BOSS_GEAR_IDS[9], chapter: 10, slot: 'head', ore: 'ore-adamant' },
]

export const ENHANCE_CHANCES: readonly number[] = [1, 1, 1, 1, 1, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.25, 0.2, 0.15, 0.1]

export function oreForPlus(plus: number): string {
  if (plus <= 3) return 'ore-copper'
  if (plus <= 6) return 'ore-iron'
  if (plus <= 9) return 'ore-crystal'
  if (plus <= 12) return 'ore-mithril'
  return 'ore-adamant'
}

export function smithAffinity(save: SaveData): number {
  return Math.min(5, Math.floor(save.smith.points / 20))
}

function weekOf(day: string): string {
  const date = new Date(`${day}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return ''
  const monday = new Date(date.getTime() - ((date.getUTCDay() + 6) % 7) * 86_400_000)
  return monday.toISOString().slice(0, 10)
}

/** 週に一度、保護石を受け取る。 */
export function weeklyGuardGift(save: SaveData, day: string): SaveData | undefined {
  const week = weekOf(day)
  if (week === '' || save.smith.guardWeek === week) return undefined
  return { ...addItem(save, 'guard-stone', 1), smith: { ...save.smith, guardWeek: week } }
}

export function enhanceChance(save: SaveData, item: Item): number {
  const next = (item.plus ?? 0) + 1
  const base = ENHANCE_CHANCES[next - 1] ?? 0
  return Math.min(1, base + save.smith.zeal / 100 + smithAffinity(save) / 100)
}

function locate(save: SaveData, id: number): { item: Item; place: 'equipment' | 'stash'; slot?: SlotId; index?: number } | undefined {
  for (const slot of ['weapon', 'head', 'body', 'arms', 'legs', 'charm'] as const) {
    const item = save.equipment[slot]
    if (item?.id === id) return { item, place: 'equipment', slot }
  }
  const index = save.stash.findIndex(item => item.id === id)
  const item = save.stash[index]
  return index < 0 || item === undefined ? undefined : { item, place: 'stash', index }
}

function replace(save: SaveData, found: NonNullable<ReturnType<typeof locate>>, item: Item): SaveData {
  if (found.place === 'equipment' && found.slot !== undefined) {
    return { ...save, equipment: { ...save.equipment, [found.slot]: item } }
  }
  if (found.place === 'stash' && found.index !== undefined) {
    return { ...save, stash: save.stash.map((old, index) => index === found.index ? item : old) }
  }
  return save
}

function remove(save: SaveData, found: NonNullable<ReturnType<typeof locate>>): SaveData {
  if (found.place === 'equipment' && found.slot !== undefined) {
    return { ...save, equipment: { ...save.equipment, [found.slot]: null } }
  }
  if (found.place === 'stash' && found.index !== undefined) {
    return { ...save, stash: save.stash.filter((_item, index) => index !== found.index) }
  }
  return save
}

function newItem(save: SaveData, slot: SlotId, rarity: number, extra: Partial<Item> = {}): { save: SaveData; item: Item } {
  const powerRoll = random(save.rng)
  const nameRoll = random(powerRoll.state)
  const item: Item = {
    id: save.nextItemId,
    slot,
    rarity,
    level: save.level,
    power: itemPower(slot, save.level, rarity, powerRoll.value),
    nameIndex: Math.floor(nameRoll.value * 3),
    ...extra,
  }
  return { save: { ...save, rng: nameRoll.state, nextItemId: save.nextItemId + 1 }, item }
}

export type EnhanceResult = { save: SaveData; success: boolean; chance: number; plus: number; protected: boolean }

/** 強化は素材を消費して判定。+11 以降の失敗は保護石を使うか選べる。 */
export function enhance(save: SaveData, id: number, useGuardStone = false): EnhanceResult | undefined {
  const found = locate(save, id)
  if (found === undefined || (found.item.plus ?? 0) >= 15) return undefined
  const nextPlus = (found.item.plus ?? 0) + 1
  const ore = oreForPlus(nextPlus)
  const gold = Math.max(1, Math.round(priceUnit(save) * 0.2 * nextPlus))
  if ((save.bag[ore] ?? 0) < 1 || save.gold < gold) return undefined
  const risky = nextPlus >= 11
  if (useGuardStone && risky && (save.bag['guard-stone'] ?? 0) < 1) return undefined

  const paid = { ...addItem(save, ore, -1), gold: save.gold - gold }
  const roll = random(paid.rng)
  const ready = { ...paid, rng: roll.state }
  const chance = enhanceChance(save, found.item)
  const success = roll.value < chance
  const protectedFailure = !success && risky && useGuardStone
  const nextItem = success
    ? { ...found.item, plus: nextPlus }
    : { ...found.item, plus: protectedFailure ? (found.item.plus ?? 0) : Math.max(0, (found.item.plus ?? 0) - (risky ? 1 : 0)) }
  const smith = {
    ...ready.smith,
    zeal: success ? 0 : Math.min(20, ready.smith.zeal + 2),
    points: Math.min(1e9, ready.smith.points + 1),
  }
  const spent = protectedFailure ? addItem(ready, 'guard-stone', -1) : ready
  const updated = replace({ ...spent, smith }, found, nextItem)
  return { save: updated, success, chance, plus: nextItem.plus ?? 0, protected: protectedFailure }
}

/** 強化値を移す。元の値は消え、移し先は上限 15。 */
export function inheritPlus(save: SaveData, fromId: number, toId: number): SaveData | undefined {
  if (fromId === toId) return undefined
  const from = locate(save, fromId)
  const to = locate(save, toId)
  const amount = from === undefined ? 0 : Math.floor((from.item.plus ?? 0) * 0.7)
  const gold = priceUnit(save) * 5
  if (from === undefined || to === undefined || amount < 1 || save.gold < gold) return undefined
  const next = { ...save, gold: save.gold - gold }
  const consumed = replace(next, from, { ...from.item, plus: 0 })
  return replace(consumed, to, { ...to.item, plus: Math.min(15, (to.item.plus ?? 0) + amount) })
}

/** 同じレア度 3 個を消費して 1 段上の装備を倉庫に作る。 */
export function combine(save: SaveData, ids: readonly number[]): SaveData | undefined {
  if (ids.length !== 3 || new Set(ids).size !== 3) return undefined
  const selected = ids.map(id => locate(save, id)).filter((item): item is NonNullable<ReturnType<typeof locate>> => item !== undefined)
  if (selected.length !== 3) return undefined
  const stashUsed = selected.filter(entry => entry.place === 'stash').length
  if (save.stash.length - stashUsed >= STASH_CAP) return undefined
  const rarity = selected[0]?.item.rarity
  if (rarity === undefined || rarity >= 5 || selected.some(entry => entry.item.rarity !== rarity)) return undefined
  let next = save
  for (const id of ids) {
    const entry = locate(next, id)
    if (entry === undefined) return undefined
    next = remove(next, entry)
  }
  let state = next.rng
  const draw = (): number => { const result = random(state); state = result.state; return result.value }
  const sameSlot = selected.every(entry => entry.item.slot === selected[0]?.item.slot)
  const slot = sameSlot ? selected[0]?.item.slot ?? 'weapon' : (['weapon', 'head', 'body', 'arms', 'legs', 'charm'] as const)[Math.floor(draw() * 6)] ?? 'weapon'
  const rolled = newItem({ ...next, rng: state }, slot, rarity + 1)
  return { ...rolled.save, stash: [...rolled.save.stash, rolled.item] }
}

/** セット装備を倉庫に作る（レア固定、同じ鉱石 20 個）。 */
export function craftSet(save: SaveData, setId: string, slot: SlotId): SaveData | undefined {
  const recipe = SMITH_SETS.find(item => item.id === setId)
  if (recipe === undefined || save.stash.length >= STASH_CAP || (save.bag[recipe.ore] ?? 0) < 20) return undefined
  const paid = addItem(save, recipe.ore, -20)
  const made = newItem(paid, slot, 2, { set: recipe.id })
  return { ...made.save, stash: [...made.save.stash, made.item] }
}

/** 章のボス欠片 1 個と同じ層の鉱石 10 個で専用装備を作る。 */
export function craftBossGear(save: SaveData, uniqueId: string): SaveData | undefined {
  const recipe = BOSS_RECIPES.find(item => item.id === uniqueId)
  if (recipe === undefined || save.stash.length >= STASH_CAP || save.stash.some(item => item.unique === uniqueId) || Object.values(save.equipment).some(item => item?.unique === uniqueId)) return undefined
  const shard = `boss-shard-${recipe.chapter}`
  if ((save.bag[shard] ?? 0) < 1 || (save.bag[recipe.ore] ?? 0) < 10) return undefined
  const paid = addItem(addItem(save, shard, -1), recipe.ore, -10)
  const made = newItem(paid, recipe.slot, 4, { unique: recipe.id })
  const hasAll = BOSS_RECIPES.every(item => item.id === recipe.id || save.stash.some(gear => gear.unique === item.id) || Object.values(save.equipment).some(gear => gear?.unique === item.id))
  const owned = hasAll ? { ...made.save, titles: { ...made.save.titles, owned: [...new Set([...made.save.titles.owned, 'smith-bosskiller'])] } } : made.save
  return { ...owned, stash: [...owned.stash, made.item] }
}

/** 倉庫の装備を付け、外した装備は空いた倉庫枠に戻す。 */
export function equipStashed(save: SaveData, id: number): SaveData | undefined {
  const found = locate(save, id)
  if (found === undefined || found.place !== 'stash') return undefined
  const old = save.equipment[found.item.slot]
  const next = remove(save, found)
  return {
    ...next,
    equipment: { ...next.equipment, [found.item.slot]: found.item },
    stash: old === null ? next.stash : [...next.stash, old],
  }
}

export function sellStashed(save: SaveData, id: number): SaveData | undefined {
  const found = locate(save, id)
  if (found === undefined || found.place !== 'stash') return undefined
  const next = remove(save, found)
  return { ...next, gold: next.gold + sellValue(found.item, save) }
}

/** 装備を鉱石 1〜3 個と鍛冶の粉に分ける。 */
export function disassemble(save: SaveData, id: number): SaveData | undefined {
  const found = locate(save, id)
  if (found === undefined || found.place !== 'stash') return undefined
  const ore = ['ore-copper', 'ore-copper', 'ore-iron', 'ore-crystal', 'ore-mithril', 'ore-adamant'][found.item.rarity] ?? 'ore-copper'
  const oreCount = 1 + Math.floor(found.item.rarity / 2)
  const dust = 1 + found.item.rarity * 2 + Math.floor((found.item.plus ?? 0) / 5)
  return addItem(addItem(remove(save, found), ore, oreCount), 'smith-dust', dust)
}

/** 鍛冶の粉を使って、強さのぶれだけを決まった乱数で振り直す。 */
export function reforge(save: SaveData, id: number): SaveData | undefined {
  const found = locate(save, id)
  const cost = found === undefined ? 0 : 1 + found.item.rarity
  if (found === undefined || (save.bag['smith-dust'] ?? 0) < cost) return undefined
  const paid = addItem(save, 'smith-dust', -cost)
  const roll = random(paid.rng)
  const item = { ...found.item, power: itemPower(found.item.slot, found.item.level, found.item.rarity, roll.value) }
  return replace({ ...paid, rng: roll.state }, found, item)
}

/** 倉庫の表示用。 */
export function itemBasePower(item: Item): number {
  return effectiveItemPower(item)
}

/** 金の装飾を付けられる装備（付けている装備と倉庫の装備のうち、まだ付けていないもの） */
export function goldTrimTargets(save: SaveData): Item[] {
  return [...(['weapon', 'head', 'body', 'arms', 'legs', 'charm'] as const).map(slot => save.equipment[slot]), ...save.stash].filter((item): item is Item => item !== null && item.goldTrim !== true)
}

/** 金鉱 30 個と物価 P × 3 のゴールドで、装備に金の装飾を付ける（強さ +3%、1 つにつき 1 回）。金鉱が足りないとき・もう付いているときは undefined */
export function applyGoldTrim(save: SaveData, id: number): SaveData | undefined {
  const found = locate(save, id)
  const gold = priceUnit(save) * 3
  if (found === undefined || found.item.goldTrim === true || (save.bag['ore-gold'] ?? 0) < GOLD_TRIM_ORE || save.gold < gold) return undefined
  const paid = addItem({ ...save, gold: save.gold - gold }, 'ore-gold', -GOLD_TRIM_ORE)

  return replace(paid, found, { ...found.item, goldTrim: true })
}
