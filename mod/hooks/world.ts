import type { JobId } from '../types'
import { NEW_MOBS } from './mobs.generated'

// ゲームの世界のデータ（章・敵・職）。名前などの文言は texts.ts、強さの数値は config.ts の BALANCE / JOBS。
// ID は絵（art/export/<id>.json）と共通。DESIGN.md の「章の一覧」「転職後の職」と合わせる。

export type Chapter = {
  /** 雑魚敵 30 種（ステージ 1〜9 で順に出る。もとの 3 種 + art/mobs.txt の 27 種） */
  enemies: readonly string[]
  /** 10 ステージ目のボス */
  boss: string
}

/** もとの雑魚 3 種とボス（2.0.1 までの 1 章の敵） */
const BASE_CHAPTERS: readonly { enemies: readonly [string, string, string]; boss: string }[] = [
  { enemies: ['null-slime', 'typo-bat', 'semicolon-beetle'], boss: 'boss-merge-conflict' },
  { enemies: ['recursion-snail', 'echo-ghost', 'loop-worm'], boss: 'boss-infinite-loop' },
  { enemies: ['leak-frog', 'dangling-spider', 'buffer-jelly'], boss: 'boss-garbage-collector' },
  { enemies: ['version-vine', 'circular-treant', 'package-mimic'], boss: 'boss-dependency-tree' },
  { enemies: ['race-scorpion', 'thread-serpent', 'lock-crab'], boss: 'boss-deadlock' },
  { enemies: ['hotfix-salamander', 'crash-imp', 'timeout-golem'], boss: 'boss-outage' },
  { enemies: ['spaghetti-mummy', 'deprecated-knight', 'commented-ghost'], boss: 'boss-spaghetti-hydra' },
  { enemies: ['missing-wisp', 'broken-chain', 'phantom-cat'], boss: 'boss-not-found' },
  { enemies: ['injection-snake', 'phishing-angler', 'trojan-horse'], boss: 'boss-zero-day' },
  { enemies: ['interest-collector', 'todo-wraith', 'legacy-behemoth'], boss: 'boss-tech-debt' },
]

/** 章ごとの雑魚はもとの 3 種 + 増やした 27 種 = 30 種（出る順） */
export const CHAPTERS: readonly Chapter[] = BASE_CHAPTERS.map((chapter, i) => ({ enemies: [...chapter.enemies, ...(NEW_MOBS[i] ?? [])], boss: chapter.boss }))

/** もとの雑魚 30 種（絵があるもの。絵が無い新しい雑魚は、この中から代役を選ぶ） */
export const BASE_MOB_IDS: readonly string[] = BASE_CHAPTERS.flatMap(chapter => chapter.enemies)

export const CHAPTER_COUNT = CHAPTERS.length
export const STAGES_PER_CHAPTER = 10
export const BOSS_STAGE = STAGES_PER_CHAPTER

export const chapterOf = (chapter: number): Chapter => CHAPTERS[Math.min(CHAPTER_COUNT, Math.max(1, chapter)) - 1] ?? CHAPTERS[0]!

/** 群れの数を決めるための、章とステージから作る決まった数（同じステージならいつも同じ群れ） */
function mix(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35)
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d)
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b)

  return (h ^ (h >>> 16)) >>> 0
}

/** 群れの最大の数 */
export const MAX_GROUP = 30

/** 群れは 3 匹ずつの波で戦う（波 k = 群れの k*3 番目から 3 匹） */
export const WAVE = 3

/** 章の雑魚の種類の数（もとの 3 種 + 27 種） */
export const MOBS_PER_CHAPTER = 30

/** 面 stage（1〜9）で新しく出る種類の、章の並びの中の範囲 [from, to)。1 面目はもとの 3 種 */
export function newMobRange(stage: number): [number, number] {
  const s = Math.min(BOSS_STAGE - 1, Math.max(1, stage))

  return [Math.floor((MOBS_PER_CHAPTER * (s - 1)) / (BOSS_STAGE - 1)), Math.floor((MOBS_PER_CHAPTER * s) / (BOSS_STAGE - 1))]
}

const groupCache = new Map<number, readonly string[]>()

/**
 * そのステージの雑魚の群れ（決まった数、同じ面ならいつも同じ）。全員倒すとステージクリア。
 * 数: 1 面目はちょうど 10、2〜3 面目は 10〜20、4〜9 面目は 10〜30（20〜30 が多め）。ボスの面は空（ボスは別）。
 * 種類: 面ごとに新しく出る種類（newMobRange）が決まっていて、群れの 1 匹目はその新しい種類。
 * 約 2/3 がその面の新しい種類、残りはそれまでの面に出た種類から。その面の新しい種類は、その面で必ず 1 回は出る。
 */
export function stageGroup(chapter: number, stage: number): readonly string[] {
  if (stage >= BOSS_STAGE) {
    return []
  }
  const key = Math.min(CHAPTER_COUNT, Math.max(1, chapter)) * 100 + stage
  const cached = groupCache.get(key)
  if (cached !== undefined) {
    return cached
  }
  const data = chapterOf(chapter)
  const h = mix(chapter, stage)
  // 今までの [1, 2, 2, 3, 3] × 10 に ±2 のゆらぎ。[10, 30] に収める（1 面目はちょうど 10、2〜3 面目は 20 まで）
  const jitter = (mix(h, 77) % 5) - 2
  const base = stage === 1 ? 10 : stage <= 3 ? (1 + (h % 2)) * 10 + jitter : [1, 2, 2, 3, 3][h % 5]! * 10 + jitter
  const count = stage === 1 ? 10 : Math.min(stage <= 3 ? 20 : MAX_GROUP, Math.max(10, base))
  const [from, to] = newMobRange(stage)
  const fresh = data.enemies.slice(from, to)
  const earlier = data.enemies.slice(0, from)
  const pick = (i: number): string => {
    const r = mix(h, 1000 + i)
    // 約 2/3 はその面の新しい種類、残りはそれまでに出た種類（1 面目は前が無いので全部新しい種類）
    return earlier.length > 0 && r % 3 === 0 ? earlier[(r >>> 4) % earlier.length]! : fresh[(r >>> 4) % fresh.length]!
  }
  const members = Array.from({ length: count }, (_, i) => pick(i))
  // 1 匹目と、新しい種類のそれぞれ 1 匹は決まった位置に置く（その面で必ず 1 回は出る）
  const step = Math.max(1, Math.floor((count - 1) / fresh.length))
  fresh.forEach((id, k) => {
    members[k === 0 ? 0 : 1 + (k - 1) * step] = id
  })
  groupCache.set(key, members)

  return members
}

/** 群れ（length 匹）の index 番目がいる波の中の位置 slot（0〜2）と、その波の数 size（最後の波は 1〜3） */
export function waveSlot(length: number, index: number): { slot: number; size: number } {
  const first = Math.floor(index / WAVE) * WAVE

  return { slot: index - first, size: Math.max(0, Math.min(length, first + WAVE) - first) }
}

/** 群れの defeated 匹を倒したあとの、画面に出す「いまの波」の残り（まだ倒していない敵と、波の中の位置）と、波の数 */
export function waveView(group: readonly string[], defeated: number): { size: number; members: { id: string; slot: number }[] } {
  const { slot, size } = waveSlot(group.length, defeated)
  const first = defeated - slot

  return { size, members: group.slice(defeated, first + size).map((id, i) => ({ id, slot: slot + i })) }
}

/**
 * ボスに負けたあと（と全部クリアしたあと）に稼ぐ面: その章の 1〜9 面から、直前の面（previous）以外を選ぶ。
 * seed は戦闘の秒数などから作る決まった数（同じセーブなら、どのセッションでも同じ面になる）
 */
export function farmStage(chapter: number, previous: number, seed: number): number {
  const choices = Array.from({ length: BOSS_STAGE - 1 }, (_, i) => i + 1).filter(stage => stage !== previous)

  return choices[mix(chapter * 31 + previous, seed >>> 0) % choices.length]!
}

/** ステージで出る敵の ID（ボスステージならボス、雑魚なら群れの 1 匹目） */
export function enemyId(chapter: number, stage: number): string {
  const data = chapterOf(chapter)

  return stage >= BOSS_STAGE ? data.boss : (stageGroup(chapter, stage)[0] ?? data.enemies[0] ?? '')
}

/** 職。novice（見習いコーダー）から Lv20 で 3 系統のどれかに転職する */
export const JOB_IDS: readonly JobId[] = ['novice', 'backend-knight', 'frontend-mage', 'infra-sniper']
export const ADVANCED_JOBS: readonly JobId[] = ['backend-knight', 'frontend-mage', 'infra-sniper']

/** 職の絵の ID（見習いは主人公の絵） */
export const JOB_ART: Record<JobId, string> = {
  novice: 'hero-novice',
  'backend-knight': 'class-backend-knight',
  'frontend-mage': 'class-frontend-mage',
  'infra-sniper': 'class-infra-sniper',
}
