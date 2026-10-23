import type { BattleReport, FeatureId, Mission, Missions, SaveData } from '../types'
import type { Reward } from './calendar'
import { READY, grant, isUnlocked } from './calendar'
import { random } from './gear'
import { hasBossGear } from './gear'
import { USES, weekKey } from './shop'

// 日課・週課・実績・冒険者ランク（5 日目、docs/DAILY.md の 6 章）。$ を使わない純粋な関数。
// ゲームの中の行動（雑魚を倒す・宝箱を開ける・商店で買う…）だけを数える。作業量（回答の回数）は日課・週課に使わない
// （Claude を無駄に使わせないため。回答の回数は実績だけ）。
// 日課・週課の選び方は「日付とセーブの種」から決める（同じ日なら、どのセッションでも同じ）。

/** 日課・週課に出る行動の種類。needs = その施設が開いていないと出ない */
export const MISSION_KINDS = ['kills', 'bossTries', 'chests', 'shopBuys', 'potions', 'mineHits', 'stairs', 'harvests', 'cooks', 'pests', 'expeditions', 'enhances'] as const
export type MissionKind = (typeof MISSION_KINDS)[number]

/** 目標の数（日課・週課）。仮の値 */
const GOALS: Record<MissionKind, { daily: number; weekly: number; needs?: FeatureId }> = {
  kills: { daily: 150, weekly: 2_000 },
  bossTries: { daily: 1, weekly: 5 },
  chests: { daily: 10, weekly: 80 },
  shopBuys: { daily: 1, weekly: 10, needs: 'shop' },
  potions: { daily: 1, weekly: 5, needs: 'shop' },
  mineHits: { daily: 30, weekly: 200, needs: 'mine' },
  stairs: { daily: 3, weekly: 20, needs: 'mine' },
  harvests: { daily: 6, weekly: 40, needs: 'farm' },
  cooks: { daily: 2, weekly: 12, needs: 'farm' },
  pests: { daily: 3, weekly: 10, needs: 'farm' },
  expeditions: { daily: 1, weekly: 5, needs: 'expedition' },
  enhances: { daily: 3, weekly: 20, needs: 'smith' },
}

export const DAILY_COUNT = 3
export const WEEKLY_COUNT = 5

/** 日課 1 つ・週課 1 つのごほうび */
export const DAILY_REWARD: readonly Reward[] = [{ kind: 'stars', amount: 5 }, { kind: 'chests', amount: 2 }]
export const WEEKLY_REWARD: readonly Reward[] = [{ kind: 'stars', amount: 10 }]
/** 3 つ全部（日課）・5 つ全部（週課）のおまけ。日課の箱 = 薬 1 つ（ランダム） */
export const DAILY_ALL_STARS = 10
export const WEEKLY_ALL_STARS = 60

export const emptyMissions = (): Missions => ({
  day: '',
  daily: [],
  dailySwapped: false,
  dailyAllClaimed: false,
  week: '',
  weekly: [],
  weeklyAllClaimed: false,
  counts: {},
  achievements: [],
})

/** 文字列から決まった数（FNV-1a） */
function hash(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    h = Math.imul(h ^ text.charCodeAt(i), 0x01000193)
  }

  return h >>> 0
}

// ---- 数える ----

/** カウンターの上限（桁あふれしないように） */
export const COUNT_CAP = 999_999_999
/** 倒した数の端数（雑魚は小数で進むので、整数の差がずれないように、端数だけ別に持つ） */
const FRACTION = 'killsFraction'

/** ずっとの合計（実績用）。日課・週課は「はじめの値との差」で進み具合を出す */
export const counted = (save: SaveData, kind: string): number => save.missions.counts[kind] ?? 0

/** 日課・週課を、今日・今週のものに入れ替える（日付や週が変わっていなければ、そのまま） */
export function rollMissions(save: SaveData, day: string): SaveData {
  const week = weekKey(day)
  const m = save.missions
  if (m.day === day && m.week === week) {
    return save
  }
  const kinds = availableKinds(save)
  const next: Missions = { ...m }
  if (m.day !== day) {
    next.day = day
    next.daily = pickKinds(kinds, `daily:${day}:${save.createdAt}`, DAILY_COUNT).map(kind => newMission(save, kind, 'daily'))
    next.dailySwapped = false
    next.dailyAllClaimed = false
  }
  if (m.week !== week) {
    next.week = week
    // 出せる種類が 5 つを超えたら、週ごとに 5 つを選ぶ（並びは種類の順のまま）
    const picked = kinds.length > WEEKLY_COUNT ? pickKinds(kinds, `weekly:${week}:${save.createdAt}`, WEEKLY_COUNT).sort((a, b) => MISSION_KINDS.indexOf(a) - MISSION_KINDS.indexOf(b)) : kinds
    next.weekly = picked.map(kind => newMission(save, kind, 'weekly'))
    next.weeklyAllClaimed = false
  }

  return { ...save, missions: next }
}

/**
 * カウンターを n 増やす（先に日課・週課を今日のものにするので、今日はじめの値がずれない）。
 * 'kills' だけは小数でも受け取り、端数をためて整数ぶんだけ増やす
 */
export function count(save: SaveData, kind: string, n: number, day: string): SaveData {
  const rolled = rollMissions(save, day)
  if (!(n > 0) || !Number.isFinite(n)) {
    return rolled
  }
  const counts = { ...rolled.missions.counts }
  if (kind === 'kills') {
    const total = (counts[FRACTION] ?? 0) + n
    const whole = Math.floor(total + 1e-9)
    counts.kills = Math.min(COUNT_CAP, (counts.kills ?? 0) + whole)
    counts[FRACTION] = Math.max(0, total - whole)
  } else {
    counts[kind] = Math.min(COUNT_CAP, (counts[kind] ?? 0) + Math.floor(n))
  }

  return { ...rolled, missions: { ...rolled.missions, counts } }
}

/** 時間で進んだ結果（雑魚・ボス戦）を数える */
export function countReport(save: SaveData, report: BattleReport, day: string): SaveData {
  const oldKills = counted(save, 'kills')
  let next = count(save, 'kills', report.kills, day)
  next = count(next, 'bossTries', report.bossWins.length + report.bossLosses.length, day)
  next = count(next, 'bossWins', report.bossWins.length, day)
  const newKills = counted(next, 'kills')
  const bonusChests = hasBossGear(save, 'gc-gloves') ? Math.max(0, Math.floor(newKills / 100) - Math.floor(oldKills / 100)) : 0
  if (bonusChests > 0) {
    next = grant(next, [{ kind: 'chests', amount: bonusChests }])
    next = count(next, 'chests', bonusChests, day)
  }

  return next
}

// ---- 日課・週課 ----

/** いま出せる種類（開いていて、遊べる施設のものだけ） */
export function availableKinds(save: SaveData): MissionKind[] {
  return MISSION_KINDS.filter(kind => {
    const needs = GOALS[kind].needs

    return needs === undefined || (READY.has(needs) && isUnlocked(save, needs))
  })
}

function pickKinds(pool: readonly MissionKind[], seed: string, size: number): MissionKind[] {
  const left = [...pool]
  const picked: MissionKind[] = []
  let state = hash(seed)
  while (picked.length < size && left.length > 0) {
    const r = random(state)
    state = r.state
    picked.push(left.splice(Math.floor(r.value * left.length), 1)[0]!)
  }

  return picked
}

const newMission = (save: SaveData, kind: MissionKind, scope: 'daily' | 'weekly'): Mission => ({ id: kind, goal: GOALS[kind][scope], base: counted(save, kind), claimed: false })

/** 進み具合（0〜目標） */
export const missionProgress = (save: SaveData, mission: Mission): number => Math.max(0, Math.min(mission.goal, counted(save, mission.id) - mission.base))

export const isMissionDone = (save: SaveData, mission: Mission): boolean => missionProgress(save, mission) >= mission.goal

export type Scope = 'daily' | 'weekly'

const listOf = (save: SaveData, scope: Scope): Mission[] => (scope === 'daily' ? save.missions.daily : save.missions.weekly)

/** 日課の箱（薬 1 つ）。日付とセーブの種から決まる */
export function dailyBox(save: SaveData, day: string): Reward {
  const potions = Object.keys(USES)
    .filter(id => id.startsWith('potion-'))
    .sort()

  return { kind: 'item', id: potions[hash(`box:${day}:${save.createdAt}`) % Math.max(1, potions.length)] ?? 'potion-power-s', amount: 1 }
}

/** 日課・週課 1 つのごほうびを受け取る。まだ達成していない・受け取り済みなら undefined。最後の 1 つで全部そろうとおまけも */
export function claimMission(input: SaveData, day: string, scope: Scope, index: number): SaveData | undefined {
  const save = rollMissions(input, day)
  const mission = listOf(save, scope)[index]
  if (mission === undefined || mission.claimed || !isMissionDone(save, mission)) {
    return undefined
  }
  const list = listOf(save, scope).map((m, i) => (i === index ? { ...m, claimed: true } : m))
  const flag = scope === 'daily' ? 'dailyAllClaimed' : 'weeklyAllClaimed'
  const isAll = list.every(m => m.claimed) && !save.missions[flag]
  let next: SaveData = { ...save, missions: { ...save.missions, [scope]: list, ...(isAll ? { [flag]: true } : {}) } }
  next = grant(next, scope === 'daily' ? DAILY_REWARD : WEEKLY_REWARD)
  if (isAll) {
    next = grant(next, scope === 'daily' ? [{ kind: 'stars', amount: DAILY_ALL_STARS }, dailyBox(save, day)] : [{ kind: 'stars', amount: WEEKLY_ALL_STARS }, { kind: 'item', id: 'box-legend', amount: 1 }])
  }

  return next
}

/** 今日の日課を 1 つ入れ替える（1 日 1 回、無料）。入れ替えられない（もう使った・受け取り済み・代わりが無い）なら undefined */
export function swapDaily(input: SaveData, day: string, index: number): SaveData | undefined {
  const save = rollMissions(input, day)
  const mission = save.missions.daily[index]
  if (mission === undefined || mission.claimed || save.missions.dailySwapped) {
    return undefined
  }
  const used = new Set(save.missions.daily.map(m => m.id))
  const candidates = availableKinds(save).filter(kind => !used.has(kind))
  const kind = pickKinds(candidates, `swap:${day}:${index}:${save.createdAt}`, 1)[0]
  if (kind === undefined) {
    return undefined
  }
  const daily = save.missions.daily.map((m, i) => (i === index ? newMission(save, kind, 'daily') : m))

  return { ...save, missions: { ...save.missions, daily, dailySwapped: true } }
}

/** 開発用チート: 今日の日課（または今週の週課）を達成済みにする（数えて足りない分を足す） */
export function completeMissions(input: SaveData, day: string, scope: Scope): SaveData {
  let save = rollMissions(input, day)
  for (const mission of listOf(save, scope)) {
    save = count(save, mission.id, mission.goal - missionProgress(save, mission), day)
  }

  return save
}

// ---- 実績 ----

/** 実績の数え方。ほとんどは数えたカウンター。level・evolution・stamps・playedDays はセーブの値そのもの */
export type Metric = MissionKind | 'bossWins' | 'answers' | 'playedDays' | 'level' | 'evolution' | 'stamps'

export type Achievement = { id: string; kind: Metric; goal: number; reward: readonly Reward[] }

const stars = (amount: number): Reward => ({ kind: 'stars', amount })
const psi: Reward = { kind: 'psi', amount: 1 }
const title = (id: string): Reward => ({ kind: 'title', id })
const make = (kind: Metric, goal: number, ...reward: Reward[]): Achievement => ({ id: `${kind}-${goal}`, kind, goal, reward })

/** 実績 30 個（いま数えられるものだけ。あとの施設の実績は、その施設を作るときに足す） */
export const ACHIEVEMENTS: readonly Achievement[] = [
  make('kills', 1_000, stars(10)),
  make('kills', 10_000, stars(20)),
  make('kills', 100_000, psi, title('slayer')),
  make('bossTries', 50, stars(20)),
  make('bossWins', 1, stars(10)),
  make('bossWins', 5, stars(20)),
  make('bossWins', 10, psi, title('bossbane')),
  make('chests', 100, stars(10)),
  make('chests', 1_000, stars(20)),
  make('chests', 5_000, psi, title('treasure')),
  make('shopBuys', 10, stars(10)),
  make('shopBuys', 100, stars(30)),
  make('potions', 10, stars(10)),
  make('potions', 50, stars(30)),
  make('playedDays', 3, stars(10)),
  make('playedDays', 7, stars(20)),
  make('playedDays', 14, psi),
  make('playedDays', 30, stars(50), title('regular')),
  make('playedDays', 60, psi, title('longhaul')),
  make('answers', 100, stars(10)),
  make('answers', 1_000, stars(30)),
  make('answers', 5_000, psi, title('partner')),
  make('level', 20, stars(10)),
  make('level', 50, stars(30)),
  make('level', 100, psi, title('hundred')),
  make('evolution', 1, stars(20)),
  make('evolution', 2, stars(30)),
  make('evolution', 3, psi, title('summit')),
  make('stamps', 14, stars(20)),
  make('stamps', 28, stars(40)),
]

export const ACHIEVEMENT_IDS: ReadonlySet<string> = new Set(ACHIEVEMENTS.map(a => a.id))

/** いまの値（実績の進み具合） */
export function metricOf(save: SaveData, kind: Metric): number {
  if (kind === 'level') return save.level
  if (kind === 'evolution') return save.evolution
  if (kind === 'stamps') return save.calendar.stamps
  if (kind === 'playedDays') return save.calendar.playedDays

  return counted(save, kind)
}

export const achievementProgress = (save: SaveData, a: Achievement): number => Math.min(a.goal, metricOf(save, a.kind))

export const isAchievementDone = (save: SaveData, a: Achievement): boolean => metricOf(save, a.kind) >= a.goal

export const isAchievementClaimed = (save: SaveData, a: Achievement): boolean => save.missions.achievements.includes(a.id)

/** 実績のごほうびを受け取る。達成していない・受け取り済みなら undefined */
export function claimAchievement(save: SaveData, id: string): SaveData | undefined {
  const a = ACHIEVEMENTS.find(other => other.id === id)
  if (a === undefined || isAchievementClaimed(save, a) || !isAchievementDone(save, a)) {
    return undefined
  }

  return grant({ ...save, missions: { ...save.missions, achievements: [...save.missions.achievements, id] } }, a.reward)
}

/** 実績の画面用: 受け取れるもの・進行中で近いもの（近い順に最大 limit 個）・受け取り済みの数 */
export function achievementView(save: SaveData, limit = 5): { ready: Achievement[]; near: Achievement[]; claimed: number } {
  const open = ACHIEVEMENTS.filter(a => !isAchievementClaimed(save, a))
  const ready = open.filter(a => isAchievementDone(save, a))
  const near = open
    .filter(a => !isAchievementDone(save, a))
    .map(a => ({ a, ratio: metricOf(save, a.kind) / a.goal }))
    .sort((x, y) => y.ratio - x.ratio)
    .slice(0, limit)
    .map(x => x.a)

  return { ready, near, claimed: ACHIEVEMENTS.length - open.length }
}

// ---- 冒険者ランク ----

/** ランクの名前の順（E → SS）。SS は実績が全部 */
export const ADVENTURER_RANKS: readonly string[] = ['E', 'D', 'C', 'B', 'A', 'S', 'SS']
/** 受け取った実績の数。D・C・B・A・S に上がる数（SS は全部） */
const RANK_AT: readonly number[] = [3, 8, 15, 22, 28]

/** 冒険者ランク（0 = E 〜 6 = SS）と、次のランクまであと何個か（最高なら undefined） */
export function adventurerRank(save: SaveData): { rank: number; claimed: number; left?: number } {
  const claimed = save.missions.achievements.filter(id => ACHIEVEMENT_IDS.has(id)).length
  const needs = [...RANK_AT, ACHIEVEMENTS.length]
  const rank = needs.filter(n => claimed >= n).length
  const next = needs[rank]

  return next === undefined ? { rank, claimed } : { rank, claimed, left: next - claimed }
}

// ---- 画面の印 ----

/** 受け取れるものの数（日課・週課・実績）。日課・週課は今日のものにして数える */
export function claimableCount(save: SaveData, day: string): number {
  if (!READY.has('missions') || !isUnlocked(save, 'missions')) {
    return 0
  }
  const view = rollMissions(save, day)
  const missions = [...view.missions.daily, ...view.missions.weekly].filter(m => !m.claimed && isMissionDone(view, m)).length

  return missions + achievementView(view).ready.length
}
