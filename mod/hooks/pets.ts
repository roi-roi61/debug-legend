import type { JobId, Pet, PetForm, PetSpecies, SaveData } from '../types'
import { addItem, isUnlocked, READY } from './calendar'
import { expToNext } from './level'
import { buffRate } from './buffs'
import { random, setCount, SLOTS } from './gear'

// ペットの育成と手伝い。$ を使わない純粋な計算。

export const PET_SPECIES: readonly PetSpecies[] = ['duck', 'drake', 'fox', 'owl', 'golem', 'whale']
export const STARTER_SPECIES: readonly PetSpecies[] = ['duck', 'drake', 'fox']
/** 13 日目の新しい卵（無料で 1 つ選べる） */
export const PAIR_SPECIES: readonly PetSpecies[] = ['owl', 'golem', 'whale']
export const PET_NAMES: Record<PetSpecies, readonly string[]> = {
  duck: ['Byte', 'Patch', 'Rubber', 'Quack', 'Merge'],
  drake: ['Flame', 'Build', 'Ember', 'Compile', 'Meteor'],
  fox: ['Cache', 'Memory', 'Foxy', 'Stack', 'Nine'],
  owl: ['Trace', 'Log', 'Wisdom', 'Watch', 'Debug'],
  golem: ['Mini', 'Stone', 'Deploy', 'Bolt', 'Buildy'],
  whale: ['Cloud', 'Nimbus', 'Sky', 'Bloop', 'Astra'],
}

export const COLLAR_KINDS = ['speed', 'greed', 'luck', 'guard', 'exp', 'crit'] as const
export type CollarKind = (typeof COLLAR_KINDS)[number]
export const collarId = (kind: CollarKind, rarity: number): string => `collar-${kind}-r${Math.max(1, Math.min(5, Math.floor(rarity)))}`

const COMPATIBLE_JOB: Partial<Record<PetSpecies, JobId>> = {
  duck: 'backend-knight',
  drake: 'frontend-mage',
  fox: 'infra-sniper',
}

export const emptyPets = (): SaveData['pets'] => ({ owned: [], active: [], egg: null, pats: { day: '', count: 0 }, freeEgg: false })

const petIsAway = (save: SaveData, id: string): boolean => save.expedition.adventurers.some(adventurer => adventurer.trip?.pet === id)

export const isPetAway = petIsAway

export function activePets(save: SaveData): Pet[] {
  return save.pets.active
    .map(id => save.pets.owned.find(pet => pet.id === id))
    .filter((pet): pet is Pet => pet !== undefined && !petIsAway(save, pet.id))
    .slice(0, 2)
}

export function chooseEgg(save: SaveData, species: PetSpecies): SaveData | undefined {
  if (!READY.has('pet') || !isUnlocked(save, 'pet') || !STARTER_SPECIES.includes(species) || save.pets.owned.length > 0 || save.pets.egg !== null) {
    return undefined
  }

  return { ...save, pets: { ...save.pets, egg: { species, answers: 0 } } }
}

/** 13 日目の無料の卵: 1 匹目がいて、2 匹目の枠が空いていて、まだ選んでいないとき、新しい 3 種から 1 つ選ぶ（1 回だけ） */
export function choosePairEgg(save: SaveData, species: PetSpecies): SaveData | undefined {
  if (!READY.has('pet2') || !isUnlocked(save, 'pet2') || !PAIR_SPECIES.includes(species) || save.pets.owned.some(pet => pet.species === species) || save.pets.freeEgg || save.pets.owned.length !== 1 || save.pets.egg !== null) {
    return undefined
  }

  return { ...save, pets: { ...save.pets, freeEgg: true, egg: { species, answers: 0 } } }
}

/** 上級商店の卵。まだ持っていない種を選びやすくし、孵化には通常どおり回答 10 回が必要。 */
export function usePremiumEgg(save: SaveData): SaveData | undefined {
  if (!READY.has('pet') || !isUnlocked(save, 'pet') || save.pets.owned.length >= 2 || (save.pets.owned.length > 0 && (!READY.has('pet2') || !isUnlocked(save, 'pet2'))) || save.pets.egg !== null || (save.bag.egg ?? 0) < 1) {
    return undefined
  }
  const unowned = PET_SPECIES.filter(species => !save.pets.owned.some(pet => pet.species === species))
  const candidates = unowned.length > 0 ? unowned : PET_SPECIES
  const draw = random(save.rng)
  const species = candidates[Math.floor(draw.value * candidates.length)] ?? 'duck'
  const spent = addItem(save, 'egg', -1)
  return { ...spent, rng: draw.state, pets: { ...spent.pets, egg: { species, answers: 0 } } }
}

function hatch(save: SaveData, species: PetSpecies): SaveData {
  if (save.pets.owned.length >= 2) {
    return { ...save, pets: { ...save.pets, egg: null } }
  }
  const id = `pet-${species}-${save.pets.owned.length + 1}`
  const pet: Pet = { id, species, name: PET_NAMES[species][0] ?? species, level: 1, exp: 0, form: 1, affinity: 0, collar: null }

  // 孵ったら、枠が空いていれば戦闘に出る（1 匹目は先頭、2 匹目は 2 つ目の枠）
  const active = save.pets.active.length < 2 ? [...save.pets.active, id] : save.pets.active.slice(0, 2)

  return { ...save, pets: { ...save.pets, owned: [...save.pets.owned, pet], active, egg: null } }
}

/** 回答 10 回で卵を孵す */
export function answerEgg(save: SaveData, answers = 1): SaveData {
  const egg = save.pets.egg
  if (egg === null || !(answers > 0)) {
    return save
  }
  const count = Math.min(10, egg.answers + Math.floor(answers))

  return count >= 10 ? hatch(save, egg.species) : { ...save, pets: { ...save.pets, egg: { ...egg, answers: count } } }
}

/** 開発用: 種を指定してすぐ孵す */
export function cheatHatch(save: SaveData, species: PetSpecies): SaveData {
  // 2 匹目は、ペット 2 匹目が開いているときだけ
  if (save.pets.owned.length >= 2 || (save.pets.owned.length === 1 && (!READY.has('pet2') || !isUnlocked(save, 'pet2')))) {
    return save
  }

  return hatch({ ...save, pets: { ...save.pets, egg: null } }, species)
}

/** 開発用: 先頭のペットの Lv と形態を指定する */
export function cheatPetLevel(save: SaveData, level: number): SaveData {
  const pet = save.pets.owned[0]
  if (pet === undefined) return save
  const nextLevel = Math.max(1, Math.min(60, Math.floor(level)))
  const form: PetForm = nextLevel >= 45 ? 3 : nextLevel >= 20 ? 2 : 1

  return { ...save, pets: { ...save.pets, owned: save.pets.owned.map(item => item.id === pet.id ? { ...item, level: nextLevel, exp: 0, form } : item) } }
}

export function renamePet(save: SaveData, id: string, name: string): SaveData | undefined {
  const pet = save.pets.owned.find(item => item.id === id)
  const clean = name.trim().slice(0, 24)
  if (pet === undefined || clean === '' || pet.name === clean) {
    return undefined
  }

  return { ...save, pets: { ...save.pets, owned: save.pets.owned.map(item => item.id === id ? { ...item, name: clean } : item) } }
}

/** 戦闘に出す・休ませる（2 匹とも出ているとき、片方を休ませられる。少なくとも 1 匹は出す） */
export function toggleActivePet(save: SaveData, id: string): SaveData | undefined {
  if (!save.pets.owned.some(pet => pet.id === id) || petIsAway(save, id)) {
    return undefined
  }
  if (save.pets.active.includes(id)) {
    return save.pets.active.length <= 1 ? undefined : { ...save, pets: { ...save.pets, active: save.pets.active.filter(other => other !== id) } }
  }

  return { ...save, pets: { ...save.pets, active: [...save.pets.active, id].slice(-2) } }
}

export function setActivePet(save: SaveData, id: string): SaveData | undefined {
  if (!save.pets.owned.some(pet => pet.id === id) || petIsAway(save, id) || save.pets.active[0] === id) {
    return undefined
  }
  const active = [id, ...save.pets.active.filter(other => other !== id)].slice(0, 2)

  return { ...save, pets: { ...save.pets, active } }
}

export function petExpToNext(level: number): number {
  return Math.max(1, Math.round(expToNext(Math.max(1, level)) * 0.6))
}

function formForLevel(level: number): PetForm {
  return level >= 20 ? 2 : 1
}

function addExperience(pet: Pet, experience: number): Pet {
  let level = pet.level
  let exp = pet.exp + Math.max(0, experience)
  while (level < 60 && exp >= petExpToNext(level)) {
    exp -= petExpToNext(level)
    level += 1
  }
  if (level >= 60) {
    exp = 0
  }

  return { ...pet, level, exp, form: Math.max(pet.form === 3 && level >= 45 ? 3 : 1, formForLevel(level)) as PetForm }
}

/** 指定したペットに経験値を加える（戦闘・遠征共通） */
export function gainPetExp(save: SaveData, id: string, experience: number): SaveData {
  if (!(experience > 0)) {
    return save
  }

  return { ...save, pets: { ...save.pets, owned: save.pets.owned.map(pet => pet.id === id ? addExperience(pet, experience) : pet) } }
}

/** 戦闘中のペットは主人公の経験値の 30% を受け取る。2 匹目以降は 70% */
export function shareBattleExp(save: SaveData, heroExp: number): SaveData {
  if (save.pets.active.length === 0) {
    return save
  }
  let next = save
  for (const [index, pet] of activePets(save).entries()) {
    next = gainPetExp(next, pet.id, heroExp * 0.3 * (index === 0 ? 1 : 0.7))
  }

  return next
}

/** おやつ・特製ごはん。経験値と好感度を足す */
export function feedPet(save: SaveData, item: 'treat' | 'pet-meal', id?: string): SaveData | undefined {
  const pet = (id === undefined ? activePets(save) : save.pets.owned.filter(item => item.id === id && !petIsAway(save, item.id)))[0]
  const exp = item === 'treat' ? 50 : 200
  const affinity = item === 'treat' ? 5 : 12
  if (pet === undefined || (save.bag[item] ?? 0) < 1) {
    return undefined
  }
  const spent = addItem(save, item, -1)
  const trained = gainPetExp(spent, pet.id, exp)

  return { ...trained, pets: { ...trained.pets, owned: trained.pets.owned.map(p => p.id === pet.id ? { ...p, affinity: Math.min(100, p.affinity + affinity) } : p) } }
}

export function patPet(save: SaveData, id: string, day: string): SaveData | undefined {
  const pet = save.pets.owned.find(item => item.id === id)
  const count = save.pets.pats.day === day ? save.pets.pats.count : 0
  if (pet === undefined || petIsAway(save, id) || count >= 3) {
    return undefined
  }

  return {
    ...save,
    pets: {
      ...save.pets,
      owned: save.pets.owned.map(item => item.id === id ? { ...item, affinity: Math.min(100, item.affinity + 5) } : item),
      pats: { day, count: count + 1 },
    },
  }
}

/** Lv45 とユニコードの花で形態 3 に進化 */
export function evolvePet(save: SaveData, id: string): SaveData | undefined {
  const pet = save.pets.owned.find(item => item.id === id)
  if (pet === undefined || pet.level < 45 || pet.form >= 3) {
    return undefined
  }
  const flower = ['gold', 'q3', 'q2', 'q1'].map(q => `crop-flower-${q}`).find(item => (save.bag[item] ?? 0) > 0)
  if (flower === undefined) {
    return undefined
  }
  const next = addItem(save, flower, -1)

  return { ...next, pets: { ...next.pets, owned: next.pets.owned.map(item => item.id === id ? { ...item, form: 3 } : item) } }
}

export type PetEffects = {
  attackRate: number
  critRate: number
  protectRate: number
  hpRate: number
  bossSeconds: number
  expRate: number
  goldRate: number
  luckRate: number
  /** 鉱山の 2 叩きになる確率の上乗せ */
  mineRate: number
  goldMineRate: number
  /** ボス戦のダメージ */
  bossRate: number
  /** 鉱山の鉱石の量 */
  oreRate: number
}

const noEffects = (): PetEffects => ({ attackRate: 0, critRate: 0, protectRate: 0, hpRate: 0, bossSeconds: 0, expRate: 0, goldRate: 0, luckRate: 0, mineRate: 0, goldMineRate: 0, bossRate: 0, oreRate: 0 })

/** 2 匹の組み合わせの相性（8 組。順番は関係ない）。効き目は、そのまま 2 匹の手伝いに足される */
export type PetPair = { id: string; a: PetSpecies; b: PetSpecies; effects: Partial<PetEffects> }

export const PET_PAIRS: readonly PetPair[] = [
  { id: 'shield-flame', a: 'duck', b: 'drake', effects: { bossRate: 0.1 } },
  { id: 'star-reading', a: 'owl', b: 'whale', effects: { luckRate: 0.05 } },
  { id: 'mining-duo', a: 'golem', b: 'fox', effects: { oreRate: 0.2 } },
  { id: 'night-watch', a: 'duck', b: 'owl', effects: { protectRate: 0.05, bossSeconds: 3 } },
  { id: 'spark-chain', a: 'drake', b: 'fox', effects: { critRate: 0.04, attackRate: 0.05 } },
  { id: 'forge-fire', a: 'drake', b: 'golem', effects: { goldMineRate: 0.15, attackRate: 0.05 } },
  { id: 'lucky-purse', a: 'fox', b: 'whale', effects: { goldRate: 0.08, luckRate: 0.02 } },
  { id: 'record-keeper', a: 'owl', b: 'golem', effects: { expRate: 0.08, oreRate: 0.1 } },
]

/** 戦闘に出ている 2 匹の相性（2 匹出ていて、組み合わせが決まっているとき） */
export function activePair(save: SaveData): PetPair | undefined {
  const active = activePets(save)
  if (active.length < 2) {
    return undefined
  }
  const [x, y] = [active[0]!.species, active[1]!.species]

  return PET_PAIRS.find(pair => (pair.a === x && pair.b === y) || (pair.a === y && pair.b === x))
}
const atForm = (values: readonly number[], form: PetForm): number => values[form - 1] ?? 0

function collarBonus(id: string | null): Partial<PetEffects> {
  const match = id?.match(/^collar-(speed|greed|luck|guard|exp|crit)-r([1-5])$/)
  if (match === undefined || match === null) {
    return {}
  }
  const rarity = Number(match[2])
  const rate = rarity * 0.02
  switch (match[1]) {
    case 'speed': return { attackRate: rate }
    case 'greed': return { goldRate: rate * 2 }
    case 'luck': return { luckRate: rate }
    case 'guard': return { protectRate: rate }
    case 'exp': return { expRate: rate * 2 }
    case 'crit': return { critRate: rate * 0.5 }
    default: return {}
  }
}

export function effectsForPet(pet: Pet, job: JobId): PetEffects {
  const fit = COMPATIBLE_JOB[pet.species] === job ? 1.5 : 1
  const affinity = 1 + Math.min(0.3, pet.affinity * 0.003)
  const scale = fit * affinity
  const effect = noEffects()
  if (pet.species === 'duck') {
    effect.protectRate = atForm([0.1, 0.18, 0.25], pet.form) * scale
    effect.hpRate = atForm([0, 0.05, 0.12], pet.form) * scale
  } else if (pet.species === 'drake') {
    effect.attackRate = atForm([0.15, 0.25, 0.4], pet.form) * scale
    // 形態 3 の「メテオビルド」は演出なしの平均 DPS として攻撃の 300% / 60 秒を加える。
    if (pet.form === 3) effect.attackRate += 0.05 * scale
  } else if (pet.species === 'fox') {
    effect.critRate = atForm([0.03, 0.06, 0.1], pet.form) * scale
    effect.attackRate = atForm([0.02, 0.05, 0.1], pet.form) * scale
  } else if (pet.species === 'owl') {
    effect.bossSeconds = atForm([2, 4, 6], pet.form) * scale
    effect.expRate = atForm([0.05, 0.1, 0.15], pet.form) * scale
  } else if (pet.species === 'golem') {
    effect.attackRate = atForm([0.05, 0.1, 0.15], pet.form) * scale
    effect.mineRate = atForm([0.05, 0.1, 0.15], pet.form) * scale
    effect.goldMineRate = atForm([0.05, 0.12, 0.2], pet.form) * scale
  } else {
    effect.luckRate = atForm([0.03, 0.06, 0.1], pet.form) * scale
  }
  const collar = collarBonus(pet.collar)
  for (const key of Object.keys(effect) as (keyof PetEffects)[]) {
    effect[key] += collar[key] ?? 0
  }

  return effect
}

export function petBattleEffects(save: SaveData): PetEffects {
  const total = noEffects()
  for (const [index, pet] of activePets(save).entries()) {
    const rate = index === 0 ? 1 : 0.7
    const effect = effectsForPet(pet, save.job)
    for (const key of Object.keys(total) as (keyof PetEffects)[]) {
      total[key] += effect[key] * rate
    }
  }

  const pair = activePair(save)
  if (pair !== undefined) {
    for (const key of Object.keys(pair.effects) as (keyof PetEffects)[]) {
      total[key] += pair.effects[key] ?? 0
    }
  }

  const curseCount = SLOTS.filter(slot => save.equipment[slot]?.curse === true).length
  if (curseCount > 0) {
    const iron = setCount(save, 'iron-guardian')
    const otherHp = 1 + buffRate(save, 'bossHp') + buffRate(save, 'heal') + (iron >= 2 ? 0.1 : 0) + (iron >= 6 ? 0.2 : 0)
    const currentHp = otherHp + total.hpRate
    total.hpRate = currentHp * (0.8 ** curseCount) / (1.3 ** curseCount) - otherHp
  }

  return total
}

export function petExpeditionBonus(save: SaveData, id: string): number {
  // 遠征を計算するとき、同行中のペット自身は「遠征中」なので除外しない。
  const pet = save.pets.owned.find(item => item.id === id)
  return pet === undefined ? 0 : 0.15 + effectsForPet(pet, save.job).luckRate
}

export function equipCollar(save: SaveData, petId: string, id: string): SaveData | undefined {
  if (!/^collar-(speed|greed|luck|guard|exp|crit)-r[1-5]$/.test(id) || (save.bag[id] ?? 0) < 1) {
    return undefined
  }
  const pet = save.pets.owned.find(item => item.id === petId)
  if (pet === undefined || petIsAway(save, petId) || pet.collar === id) {
    return undefined
  }
  let next = addItem(save, id, -1)
  if (pet.collar !== null) next = addItem(next, pet.collar, 1)

  return { ...next, pets: { ...next.pets, owned: next.pets.owned.map(item => item.id === petId ? { ...item, collar: id } : item) } }
}

export function removeCollar(save: SaveData, petId: string): SaveData | undefined {
  const pet = save.pets.owned.find(item => item.id === petId)
  if (pet === undefined || petIsAway(save, petId) || pet.collar === null) {
    return undefined
  }
  const next = addItem(save, pet.collar, 1)

  return { ...next, pets: { ...next.pets, owned: next.pets.owned.map(item => item.id === petId ? { ...item, collar: null } : item) } }
}
