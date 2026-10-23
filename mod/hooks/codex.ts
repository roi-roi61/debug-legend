import type { CodexState, SaveData } from '../types'
import type { Reward } from './calendar'
import { grant, isUnlocked, READY } from './calendar'
import { CROPS, RECIPES } from './farm'
import { BOSS_GEAR_IDS, CODEX_TIERS, NAME_VARIANTS, RARITY_COUNT, SET_IDS, SLOTS, codexGearKey } from './gear'
import { DIARY_COUNT, FOSSIL_COUNT, GEMS, ORES } from './mine'
import { smithAffinity } from './smith'
import { CHAPTERS, CHAPTER_COUNT } from './world'

// 図鑑（14 日目、docs/DAILY.md の 14 章）。$ を使わない純粋な関数。
// 集めたものはなるべく既存のセーブから「いま持っているもの・やったこと」を読み取り（作物・化石・ペット・読み物）、
// セーブに残らないもの（雑魚の討伐数・ボスの勝ち・売ってしまった装備・金色の作物・料理・鉱石）だけ codex に印を持つ。

export const emptyCodex = (): CodexState => ({ kills: {}, bossWins: {}, bossBest: {}, seen: [], claimed: [] })

/** 図鑑が遊べるか */
export const isCodexOpen = (save: SaveData): boolean => READY.has('codex') && isUnlocked(save, 'codex')

/** 雑魚 300 種（章の順。1 章 30 種） */
export const MOB_IDS: readonly string[] = CHAPTERS.flatMap(chapter => chapter.enemies)
export const BOSS_IDS: readonly string[] = CHAPTERS.map(chapter => chapter.boss)

/** 討伐数の★（1・10・100。1 種あたりの倒す数がおよそ 1/10 になったので、もとの 1・100・1,000 の 1/10） */
export const MOB_STAR_STEPS: readonly number[] = [1, 10, 100]
export const mobStars = (kills: number): number => MOB_STAR_STEPS.filter(step => kills >= step).length

export type CategoryId = 'mobs' | 'bosses' | 'gear' | 'crops' | 'dishes' | 'ores' | 'fossils' | 'pets' | 'reads'
export const CATEGORIES: readonly CategoryId[] = ['mobs', 'bosses', 'gear', 'crops', 'dishes', 'ores', 'fossils', 'pets', 'reads']

/** 料理（まだ作れない 'later' のフルコースは数えない。100% にできなくなるため） */
export const DISH_IDS: readonly string[] = RECIPES.filter(recipe => recipe.requires !== 'later').map(recipe => recipe.id)
export const ORE_IDS: readonly string[] = [...ORES, ...GEMS]

/** 読み物の数: 鉱山の日記 12・親方の昔話 6・ノクスの正体 5・学者の手記 10・真のラスボスの伝承 7 */
export const READ_COUNTS = { mine: DIARY_COUNT, master: 6, nox: 5, scholar: 10, sealed: 7 } as const

/** 図鑑の 1 項目。id は画面で名前を引くときにも使う */
export type Entry = { id: string; got: boolean; count?: number }

const isSeen = (save: SaveData, key: string): boolean => save.codex.seen.includes(key)

/** 学者の手記を読める数（遠征を終えた回数。冒険者セージが帰ってくるたびに 1 話） */
const scholarCount = (save: SaveData): number => Math.min(READ_COUNTS.scholar, Math.floor(save.missions.counts.expeditions ?? 0))

/** 親方の昔話を読める数（鍛冶屋が開いていれば 1 話、好感度が上がるたびに 1 話） */
const masterCount = (save: SaveData): number => (isUnlocked(save, 'smith') ? Math.min(READ_COUNTS.master, 1 + smithAffinity(save)) : 0)

/** 欄ごとの項目 */
export function categoryEntries(save: SaveData, category: CategoryId): Entry[] {
  if (category === 'mobs') {
    return MOB_IDS.map(id => ({ id, got: (save.codex.kills[id] ?? 0) >= 1, count: save.codex.kills[id] ?? 0 }))
  }
  if (category === 'bosses') {
    return [
      ...BOSS_IDS.map((id, i) => ({ id, got: (save.codex.bossWins[i + 1] ?? 0) >= 1, count: save.codex.bossWins[i + 1] ?? 0 })),
      { id: 'origin-moth', got: save.seal.trueBoss.beaten >= 1, count: save.seal.trueBoss.beaten },
    ]
  }
  if (category === 'gear') {
    const normal = SLOTS.flatMap(slot =>
      Array.from({ length: NAME_VARIANTS }, (_, name) => Array.from({ length: RARITY_COUNT }, (_, rarity) => `gear:${slot}:${name}:${rarity}`)).flat(),
    )
    const sets = SET_IDS.flatMap(set => SLOTS.map(slot => `set:${set}:${slot}`))
    const bosses = BOSS_GEAR_IDS.map(id => `boss:${id}`)

    return [...normal, ...sets, ...bosses].map(id => ({ id, got: isSeen(save, id) }))
  }
  if (category === 'crops') {
    return CROPS.flatMap(crop => [
      { id: `crop:${crop.id}`, got: save.farm.harvested.includes(crop.id) },
      { id: `gold:${crop.id}`, got: isSeen(save, `gold:${crop.id}`) },
    ])
  }
  if (category === 'dishes') {
    return DISH_IDS.map(id => ({ id: `dish:${id}`, got: isSeen(save, `dish:${id}`) }))
  }
  if (category === 'ores') {
    return ORE_IDS.map(id => ({ id: `ore:${id}`, got: isSeen(save, `ore:${id}`) }))
  }
  if (category === 'fossils') {
    return Array.from({ length: FOSSIL_COUNT }, (_, i) => ({ id: `fossil:${i + 1}`, got: save.mine.fossils.includes(i + 1) }))
  }
  if (category === 'pets') {
    // ペットは 2 匹までで手放せないので、仲間にした枠（1 匹目・2 匹目）ごとに 3 形態。まだ居ない枠は未発見
    return [0, 1].flatMap(slot => [1, 2, 3].map(form => ({ id: `pet:${slot}:${form}`, got: (save.pets.owned[slot]?.form ?? 0) >= form })))
  }
  const master = masterCount(save)
  const scholar = scholarCount(save)

  return [
    ...Array.from({ length: READ_COUNTS.mine }, (_, i) => ({ id: `read:mine:${i}`, got: save.mine.diaries.includes(i) })),
    ...Array.from({ length: READ_COUNTS.master }, (_, i) => ({ id: `read:master:${i}`, got: i < master })),
    ...Array.from({ length: READ_COUNTS.nox }, (_, i) => ({ id: `read:nox:${i}`, got: save.blackMarket.stories.includes(`nox-${i + 1}`) })),
    ...Array.from({ length: READ_COUNTS.scholar }, (_, i) => ({ id: `read:scholar:${i}`, got: i < scholar })),
    ...Array.from({ length: READ_COUNTS.sealed }, (_, i) => ({ id: `read:sealed:${i}`, got: save.blackMarket.stories.includes(`sealed-${i + 1}`) })),
  ]
}

export function categoryCount(save: SaveData, category: CategoryId): { got: number; total: number } {
  const entries = categoryEntries(save, category)

  return { got: entries.filter(entry => entry.got).length, total: entries.length }
}

/**
 * 収集率（全部の欄の合計）。pct は 0〜100 の小数。
 * 雑魚は 1 種を 0.1 として数える（雑魚の欄の重さをもとの 30 種ぶんの 30 に保ち、ほかの欄のごほうびの時期を変えないため）。
 * got / total は重みをかけた数を四捨五入したもの（欄ごとの表示 12/300 などは本当の数）
 */
export function codexRate(save: SaveData): { got: number; total: number; pct: number } {
  // 計算は 10 倍の整数で（0.1 の足し算の誤差を出さない）
  let got = 0
  let total = 0
  for (const category of CATEGORIES) {
    const count = categoryCount(save, category)
    const weight = category === 'mobs' ? 1 : 10
    got += count.got * weight
    total += count.total * weight
  }

  return { got: Math.round(got / 10), total: Math.round(total / 10), pct: total === 0 ? 0 : (got / total) * 100 }
}

// ---- ごほうび ----

/** 収集率の段階ごとのごほうび（戦闘力の上がり幅は gear.ts の CODEX_TIERS） */
export const TIER_REWARDS: Record<number, readonly Reward[]> = {
  10: [{ kind: 'stars', amount: 20 }],
  25: [{ kind: 'psi', amount: 2 }],
  50: [{ kind: 'stars', amount: 50 }, { kind: 'title', id: 'codex-explorer' }],
  75: [{ kind: 'psi', amount: 3 }, { kind: 'stars', amount: 100 }],
  100: [{ kind: 'stars', amount: 200 }, { kind: 'title', id: 'codex-master' }],
}

/** 欄ごとのコンプリートのごほうび */
export const CATEGORY_REWARD: readonly Reward[] = [{ kind: 'stars', amount: 30 }, { kind: 'psi', amount: 1 }]

export type Claim = { id: string; rewards: readonly Reward[]; power: number }

/** いまもらえるごほうび（図鑑が開いていて、まだもらっていないもの） */
export function claimable(save: SaveData): Claim[] {
  if (!isCodexOpen(save)) {
    return []
  }
  const { pct } = codexRate(save)
  const claims: Claim[] = []
  for (const tier of CODEX_TIERS) {
    const id = `tier:${tier.pct}`
    if (pct >= tier.pct - 1e-9 && !save.codex.claimed.includes(id)) {
      claims.push({ id, rewards: TIER_REWARDS[tier.pct] ?? [], power: tier.power })
    }
  }
  for (const category of CATEGORIES) {
    const id = `cat:${category}`
    const count = categoryCount(save, category)
    if (count.total > 0 && count.got >= count.total && !save.codex.claimed.includes(id)) {
      claims.push({ id, rewards: CATEGORY_REWARD, power: 0 })
    }
  }

  return claims
}

/** ごほうびを受け取る（もらえないものは undefined） */
export function claimCodex(save: SaveData, id: string): SaveData | undefined {
  const claim = claimable(save).find(candidate => candidate.id === id)
  if (claim === undefined) {
    return undefined
  }

  return grant({ ...save, codex: { ...save.codex, claimed: [...save.codex.claimed, id] } }, claim.rewards)
}

// ---- 記録 ----

/** 料理を作ったこと */
export function recordDish(save: SaveData, id: string): SaveData {
  const key = `dish:${id}`

  return save.codex.seen.includes(key) ? save : { ...save, codex: { ...save.codex, seen: [...save.codex.seen, key] } }
}

/**
 * いまのセーブから、見つけたものの印を足す（装備・鉱石・金色の作物・料理）。足すものが無ければ同じセーブを返す。
 * 売ってしまった装備は gear.ts の judge が出たときに印を付ける。
 */
export function syncCodex(save: SaveData): SaveData {
  const known = new Set(save.codex.seen)
  const found: string[] = []
  const see = (key: string): void => {
    if (!known.has(key)) {
      known.add(key)
      found.push(key)
    }
  }
  const items = [...SLOTS.map(slot => save.equipment[slot]), ...save.stash, save.pending]
  for (const item of items) {
    if (item === null) {
      continue
    }
    see(codexGearKey(item))
    if (item.set !== undefined) see(`set:${item.set}:${item.slot}`)
    if (item.unique !== undefined) see(`boss:${item.unique}`)
  }
  for (const [id, count] of Object.entries(save.bag)) {
    if (count <= 0) {
      continue
    }
    if (ORE_IDS.includes(id)) see(`ore:${id}`)
    const gold = /^crop-([a-z]+)-gold$/.exec(id)
    if (gold !== null) see(`gold:${gold[1]}`)
    if (id === 'dish-onigiri') see('dish:onigiri')
    if (id === 'pet-meal') see('dish:pet-meal')
  }
  for (const buff of save.buffs) {
    if (buff.dish !== undefined) see(`dish:${buff.dish}`)
  }
  if (save.farm.last?.quality === 'gold') see(`gold:${save.farm.last.crop}`)

  return found.length === 0 ? save : { ...save, codex: { ...save.codex, seen: [...save.codex.seen, ...found] } }
}

/** 版 20 に上げたとき: 分かる範囲で図鑑に入れる（倒した章の雑魚とボスは 1 回、いまの装備・持ち物） */
export function backfillCodex(save: SaveData): SaveData {
  const kills: Record<string, number> = { ...save.codex.kills }
  const bossWins: Record<number, number> = { ...save.codex.bossWins }
  const cleared = new Set(save.beatenBosses)
  for (let chapter = 1; chapter <= CHAPTER_COUNT; chapter += 1) {
    if (cleared.has(chapter) || chapter < save.stage.chapter) {
      for (const id of CHAPTERS[chapter - 1]?.enemies ?? []) kills[id] = Math.max(1, kills[id] ?? 0)
    }
    if (cleared.has(chapter)) bossWins[chapter] = Math.max(1, bossWins[chapter] ?? 0)
  }

  return syncCodex({ ...save, codex: { ...save.codex, kills, bossWins } })
}
