import type { Adventurer, AdventurerId, Drop, ExpeditionLunch, ExpeditionTrip, SaveData } from '../types'
import { addItem, isUnlocked, priceUnit, READY } from './calendar'
import { growable, isFarmOpen, cropItemId } from './farm'
import { combatPower, judge, random } from './gear'
import { gainPetExp, petExpeditionBonus, isPetAway } from './pets'
import { bossHp, stageIndex } from './battle'
import { rollAtRarity } from './shop'
import { BOSS_STAGE, CHAPTER_COUNT } from './world'
import { hasPsychicNode, psychicGoldReward, psychicStarReward } from './psychic'

// 遠征ギルド（7 日目）。帰還時刻は実時間から計算し、毎秒セーブを書かない。

export const ADVENTURER_IDS: readonly AdventurerId[] = ['gald', 'rico', 'sage', 'luna']
export const EXPEDITION_HOURS = [1, 4, 8] as const
const HOUR_MS = 60 * 60 * 1000

export const emptyExpedition = (): SaveData['expedition'] => ({
  adventurers: ADVENTURER_IDS.slice(0, 3).map(id => ({ id, level: 1, exp: 0 })),
  contract: false,
})

export const clearedChapter = (save: SaveData): number => Math.min(
  CHAPTER_COUNT,
  Math.max(save.isCleared ? CHAPTER_COUNT : Math.max(0, save.stage.chapter - 1), save.boss.last?.won ? save.boss.last.chapter : 0),
)

export const hireCost = (save: SaveData, hours: number): number => Math.round(priceUnit(save) * 0.2 * hours)

export function tripDurationMs(hours: number, lunch: ExpeditionLunch): number {
  const reduction = lunch === 'lunchbox' ? 0.2 : lunch === 'dish-onigiri' ? 0.1 : 0

  return Math.round(hours * HOUR_MS * (1 - reduction))
}

export const tripFinishAt = (trip: ExpeditionTrip): number => trip.startAt + tripDurationMs(trip.hours, trip.lunch)
export const tripRemainingMs = (trip: ExpeditionTrip, now: number): number => Math.max(0, tripFinishAt(trip) - now)
export const tripReady = (trip: ExpeditionTrip, now: number): boolean => tripRemainingMs(trip, now) <= 0

export const readyToClaim = (save: SaveData, now: number): boolean => save.expedition.adventurers.some(adventurer => adventurer.trip !== undefined && tripReady(adventurer.trip, now))

/** 開発用: すべての遠征を帰還済みにする */
export function cheatFinishTrips(save: SaveData, now: number): SaveData {
  const adventurers = save.expedition.adventurers.map(adventurer => adventurer.trip === undefined ? adventurer : {
    ...adventurer,
    trip: { ...adventurer.trip, startAt: now - tripDurationMs(adventurer.trip.hours, adventurer.trip.lunch) },
  })

  return { ...save, expedition: { ...save.expedition, adventurers } }
}

export type ExpeditionSetup = { chapter: number; hours: 1 | 4 | 8; pet?: string | null; lunch: ExpeditionLunch }

export function startTrip(save: SaveData, id: AdventurerId, setup: ExpeditionSetup, now: number): SaveData | undefined {
  const adventurer = save.expedition.adventurers.find(item => item.id === id)
  const chapter = Math.floor(setup.chapter)
  const hours = setup.hours
  const lunch = setup.lunch
  const petId = setup.pet ?? undefined
  if (!READY.has('expedition') || !isUnlocked(save, 'expedition') || adventurer === undefined || adventurer.trip !== undefined) return undefined
  if (!EXPEDITION_HOURS.includes(hours) || chapter < 1 || chapter > clearedChapter(save)) return undefined
  if (petId !== undefined && (!save.pets.owned.some(pet => pet.id === petId) || isPetAway(save, petId))) return undefined
  if (lunch !== 'none' && lunch !== 'lunchbox' && lunch !== 'dish-onigiri') return undefined
  if (lunch !== 'none' && (save.bag[lunch] ?? 0) < 1) return undefined
  const cost = hireCost(save, hours)
  if (save.gold < cost) return undefined

  let next: SaveData = { ...save, gold: save.gold - cost }
  if (lunch !== 'none') next = addItem(next, lunch, -1)
  const trip: ExpeditionTrip = { chapter, hours, startAt: now, lunch, ...(petId === undefined ? {} : { pet: petId }) }
  const adventurers = next.expedition.adventurers.map(item => item.id === id ? { ...item, trip } : item)

  return { ...next, expedition: { ...next.expedition, adventurers } }
}

export type ExpeditionOutcome = 'great' | 'success' | 'failed'
export type ExpeditionClaim = {
  save: SaveData
  adventurer: AdventurerId
  outcome: ExpeditionOutcome
  items: Record<string, number>
  gold: number
  stars: number
  drop?: Drop
}

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n))

function tripRandom(save: SaveData, adventurer: Adventurer, trip: ExpeditionTrip): () => number {
  let state = (save.createdAt ^ trip.startAt ^ (trip.chapter * 2654435761) ^ (trip.hours * 2246822519)) >>> 0
  for (const char of `${adventurer.id}:${trip.lunch}:${trip.pet ?? ''}`) state = Math.imul(state ^ char.charCodeAt(0), 0x01000193) >>> 0
  if (state === 0) state = 1
  return () => {
    const next = random(state)
    state = next.state
    return next.value
  }
}

function successRate(save: SaveData, adventurer: Adventurer, trip: ExpeditionTrip): number {
  const power = Math.max(1, combatPower(save))
  const adventurerStrength = power * adventurer.level / 10
  // ボス HP を 50 で割り、主人公の戦闘力と同じ桁にした章ごとの目安。
  const chapterStrength = Math.max(1, bossHp(stageIndex(trip.chapter, BOSS_STAGE)) / 50)
  const role = adventurer.id === 'gald' ? 0.08 : 0
  const pet = trip.pet === undefined ? 0 : petExpeditionBonus(save, trip.pet)

  return clamp01(Math.min(0.98, Math.max(0.05, adventurerStrength / chapterStrength + role + pet)))
}

function addAdventurerExp(adventurer: Adventurer, exp: number): Pick<Adventurer, 'level' | 'exp'> {
  let level = adventurer.level
  let total = adventurer.exp + Math.max(0, exp)
  while (level < 30 && total >= level * 100) {
    total -= level * 100
    level += 1
  }
  if (level >= 30) total = 0

  return { level, exp: total }
}

/** 帰還した遠征を計算して受け取る。失敗でも基本報酬の半分は持ち帰る */
export function claimTrip(save: SaveData, id: AdventurerId, now: number): ExpeditionClaim | undefined {
  const adventurer = save.expedition.adventurers.find(item => item.id === id)
  const trip = adventurer?.trip
  if (adventurer === undefined || trip === undefined || !tripReady(trip, now)) return undefined
  const draw = tripRandom(save, adventurer, trip)
  const chance = successRate(save, adventurer, trip)
  const petLuck = trip.pet === undefined ? 0 : Math.max(0, petExpeditionBonus(save, trip.pet) - 0.15)
  const greatChance = Math.min(0.4, chance * (0.07 + trip.hours * 0.012 + petLuck + (id === 'rico' ? 0.025 : 0)) + (hasPsychicNode(save, 'future-8') ? 0.1 : 0))
  const roll = draw()
  const outcome: ExpeditionOutcome = roll < greatChance ? 'great' : roll < chance ? 'success' : 'failed'
  const scale = outcome === 'great' ? 2 : outcome === 'failed' ? 0.5 : 1
  const quantity = (base: number): number => Math.max(1, Math.floor(base * scale))
  let next: SaveData = save
  let drop: Drop | undefined
  const items: Record<string, number> = {}
  const add = (item: string, amount: number) => {
    if (amount <= 0) return
    next = addItem(next, item, amount)
    items[item] = (items[item] ?? 0) + amount
  }

  add(`boss-shard-${trip.chapter}`, quantity(trip.hours * 2))
  const ore = ['ore-copper', 'ore-iron', 'ore-crystal', 'ore-mithril', 'ore-adamant', 'ore-stariron'][(trip.chapter - 1) % 6]!
  add(ore, quantity(trip.hours))
  // 木材（大農場の拡張に使う）
  add('wood', quantity(trip.hours * 2))
  if (isFarmOpen(save)) {
    const crops = growable(save)
    const crop = crops[Math.floor(draw() * Math.max(1, crops.length))]
    if (crop !== undefined) add(cropItemId(crop.id, 'q1'), quantity(Math.max(1, Math.floor(trip.hours / 2))))
  }

  const roleGold = id === 'rico' ? 1.5 : 1
  const gold = Math.max(1, psychicGoldReward(save, priceUnit(save) * trip.hours * 0.5 * scale * roleGold))
  const baseStars = Math.max(1, Math.ceil(trip.hours / 4))
  const stars = psychicStarReward(save, quantity(id === 'sage' ? Math.ceil(baseStars * 1.5) : baseStars))
  next = { ...next, gold: next.gold + gold, wallet: { ...next.wallet, stars: next.wallet.stars + stars } }

  if (id === 'rico' && draw() < 0.5 * (outcome === 'failed' ? 0.5 : 1)) add('chest-ticket', quantity(1))
  if (draw() < (outcome === 'great' ? 0.45 : 0.025 * trip.hours)) add('egg-shard', quantity(Math.max(1, trip.hours)))
  if (draw() < (outcome === 'great' ? 0.25 : 0.02 * trip.hours)) {
    const kind = ['speed', 'greed', 'luck', 'guard', 'exp', 'crit'][Math.floor(draw() * 6)]!
    const rarity = outcome === 'great' ? 3 + Math.floor(draw() * 3) : 1 + Math.floor(draw() * 2)
    add(`collar-${kind}-r${rarity}`, 1)
  }
  if (next.pending === null && draw() < (outcome === 'great' ? 0.2 : 0.01 * trip.hours)) {
    const rolled = rollAtRarity(next, outcome === 'great' ? 3 : 2)
    const judged = judge(rolled.save, rolled.item, now)
    next = judged.save
    drop = judged.drop
  }

  const earned = addAdventurerExp(adventurer, trip.hours * 100 * (outcome === 'failed' ? 0.5 : outcome === 'great' ? 1.5 : 1))
  const { trip: _trip, ...rest } = adventurer
  const adventurers = next.expedition.adventurers.map(item => item.id === id ? { ...rest, ...earned } : item)
  next = { ...next, expedition: { ...next.expedition, adventurers } }
  if (trip.pet !== undefined) next = gainPetExp(next, trip.pet, trip.hours * (outcome === 'failed' ? 10 : outcome === 'great' ? 40 : 20))

  return { save: next, adventurer: id, outcome, items, gold, stars, ...(drop === undefined ? {} : { drop }) }
}
