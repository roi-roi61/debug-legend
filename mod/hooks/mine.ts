import type { MineBossFight, MineCell, MineFloorRecord, MineHaul, MineState, SaveData } from '../types'
import { bossHp, enemyHp, expPerKill, heroStats } from './battle'
import { READY, addItem, grant, isUnlocked, priceUnit } from './calendar'
import { applyGoldenHand, random, judge, rollItem, setCount } from './gear'
import { addExp } from './level'
import { petBattleEffects } from './pets'
import { hasPsychicNode, psychicGoldReward, psychicStarReward } from './psychic'

// 鉱山（3 日目、docs/DAILY.md の 4 章）。$ を使わない純粋な関数。
// 階の作り・マスの中身・当たりは、セーブの種（createdAt）と階の番号・マスの番号から決まる（同じセーブなら、どのセッションでも同じ）。
// ゲームの流れ: ツール成功 5 回でつるはし 1 回 → マスを叩く → 開いたマスの中身をもらう → 階段を見つけて降りる → 10 階ごとにボス。

export const COLS = 7
export const ROWS = 5
export const CELLS = COLS * ROWS

/** ツール成功の何回でつるはし 1 回か、1 日にためられる上限 */
export const TOOLS_PER_PICK = 5
export const DAILY_PICK_CAP = 60
/** ボスに挑むのに使うつるはしと、勝負の長さ（秒） */
export const BOSS_PICKS = 5
export const BOSS_SECONDS = 15
/** 自動採掘: 何ミリ秒ごとに何回まで叩くか、何回分まで追いつくか（8 時間）、解放される階 */
export const AUTO_EVERY_MS = 10 * 60 * 1000
export const AUTO_MAX_HITS = 10
export const AUTO_MAX_STEPS = 48
export const AUTO_FLOOR = 21
/** 化石の種類・日記の話の数 */
export const FOSSIL_COUNT = 10
export const DIARY_COUNT = 12
/** 階の強さ: 階 n は、本編のステージの通し番号 (n - 1) × この数 くらいの強さ */
export const MINE_SCALE = 1.1
/** 泉でもらえるつるはし */
export const SPRING_PICKS = 5
/** ボスに勝ったごほうびの星のかけら */
export const BOSS_STARS = 20
/** 木材が出る階（浅い階） */
export const WOOD_FLOORS = 20

export const MINE_KINDS = ['dirt', 'rock', 'hard', 'ore', 'gem', 'chest', 'monster', 'fossil', 'spring', 'stairs', 'diary'] as const
const BASE_HP: Record<string, number> = { dirt: 1, rock: 2, hard: 3, ore: 2, gem: 3, chest: 1, monster: 1, fossil: 2, spring: 1, stairs: 1, diary: 1 }
export const EVENTS = ['vein', 'collapse', 'treasure', 'gas', 'diary'] as const

/** 地層ごとの鉱石・宝石（1〜10 階が 0、11〜20 階が 1 … 51 階から 5） */
export const ORES = ['ore-copper', 'ore-iron', 'ore-crystal', 'ore-mithril', 'ore-adamant', 'ore-stariron'] as const
export const GEMS = ['gem-amber', 'gem-amethyst', 'gem-sapphire', 'gem-emerald', 'gem-ruby', 'gem-starquartz'] as const
export const BOSS_TYPES = 5

/** つるはし 1 本の効き目。double = 1 回で 2 叩きになる確率、gem = 鉱石のマスで宝石も出る確率、ore = 鉱石 +、area = 左右も叩く確率、daily = 毎日のつるはし */
export type Pickaxe = { double: number; gem: number; ore: number; area: number; daily: number; needs: string; amount: number; times: number; stars: number }

const none = { needs: '', amount: 0, times: 0, stars: 0 }
export const PICKAXES: readonly Pickaxe[] = [
  { double: 0, gem: 0, ore: 0, area: 0, daily: 0, ...none },
  { double: 0.05, gem: 0, ore: 0, area: 0, daily: 0, needs: 'ore-copper', amount: 30, times: 2, stars: 0 },
  { double: 0.1, gem: 0, ore: 0, area: 0, daily: 0, needs: 'ore-iron', amount: 40, times: 5, stars: 0 },
  { double: 0.1, gem: 0.2, ore: 0, area: 0, daily: 0, needs: 'ore-crystal', amount: 50, times: 12, stars: 0 },
  { double: 0.15, gem: 0.2, ore: 1, area: 0, daily: 0, needs: 'ore-mithril', amount: 60, times: 30, stars: 0 },
  { double: 0.15, gem: 0.2, ore: 1, area: 0.2, daily: 0, needs: 'ore-adamant', amount: 80, times: 80, stars: 0 },
  { double: 0.15, gem: 0.2, ore: 2, area: 0.2, daily: 10, needs: 'ore-stariron', amount: 100, times: 0, stars: 200 },
]
export const MAX_PICKAXE = PICKAXES.length - 1

export const emptyMine = (): MineState => ({
  floor: 1,
  deepest: 1,
  grid: [],
  event: '',
  picksToday: 0,
  toolsFraction: 0,
  day: '',
  pickaxe: 0,
  bomb: false,
  auto: false,
  autoAt: 0,
  swings: 0,
  bossesBeaten: [],
  fossils: [],
  diaries: [],
  last: null,
  autoLast: null,
  round: 0,
  roundBosses: [],
  floors: {},
})

/** 文字列から決まった数（FNV-1a） */
function hash(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    h = Math.imul(h ^ text.charCodeAt(i), 0x01000193)
  }

  return h >>> 0
}

/** 文字列から決まった 0 以上 1 未満の数 */
const roll = (text: string): number => hash(text) / 4294967296

/** 鉱山が開いていて、遊べるか */
export const isMineOpen = (save: SaveData): boolean => READY.has('mine') && isUnlocked(save, 'mine')

// ---- 階 ----

export const layerOf = (floor: number): number => Math.min(ORES.length - 1, Math.floor((Math.max(1, floor) - 1) / 10))
export const isBossFloor = (floor: number): boolean => floor >= 10 && floor % 10 === 0
/** ボスの種類（0〜4。51 階からくり返し） */
export const bossType = (floor: number): number => (Math.floor(floor / 10) - 1) % BOSS_TYPES
/** 階の強さ（本編のステージの通し番号にあたる数） */
export const mineIndex = (floor: number): number => Math.max(0, (floor - 1) * MINE_SCALE)
/** 51 階からは 10 階ごとに岩が 1 つずつ硬くなる */
export const hardness = (floor: number): number => (floor >= 51 ? Math.floor((floor - 51) / 10) : 0)
export const hpOf = (kind: string, floor: number): number => (BASE_HP[kind] ?? 1) + (kind === 'rock' || kind === 'hard' ? hardness(floor) : 0)

/** ボスが待っているか（この周回でまだ倒していないボスの階） */
export const isBossPending = (m: MineState): boolean => isBossFloor(m.floor) && !m.roundBosses.includes(m.floor)

/** 乱数の種に足す周回の印（0 周目は何も足さない = 今までと同じ数） */
const roundSalt = (round: number): string => (round > 0 ? `:r${round}` : '')

/** 階の作りと、入ったときのできごと（階の番号とセーブの種から決まる） */
export function generateFloor(createdAt: number, floor: number, round = 0): { grid: MineCell[]; event: string } {
  let state = hash(`mine:${createdAt}:${floor}${roundSalt(round)}`)
  const draw = (): number => {
    const r = random(state)
    state = r.state
    return r.value
  }
  const layer = layerOf(floor)
  const weights: [string, number][] =
    floor >= 11
      ? [['dirt', 26], ['rock', 22], ['hard', 16], ['ore', 12], ['gem', 3 + layer * 0.6], ['chest', 4], ['monster', 5], ['fossil', 2], ['spring', 3]]
      : [['dirt', 40], ['rock', 28], ['ore', 12], ['gem', 3 + layer * 0.6], ['chest', 4], ['monster', 5], ['fossil', 2], ['spring', 3]]
  const total = weights.reduce((sum, [, w]) => sum + w, 0)
  const cell = (kind: string): MineCell => ({ kind, hp: hpOf(kind, floor), open: false })
  const grid: MineCell[] = Array.from({ length: CELLS }, () => {
    let value = draw() * total
    for (const [kind, weight] of weights) {
      value -= weight
      if (value < 0) {
        return cell(kind)
      }
    }

    return cell('dirt')
  })
  // 階段は必ず 1 つ（ボスの階は階段のかわりにボスの部屋）
  if (!isBossFloor(floor)) {
    grid[Math.floor(draw() * CELLS)] = cell('stairs')
  }
  // 入ったときのできごと
  const r = draw()
  const event = r < 0.08 ? 'vein' : r < 0.13 ? 'collapse' : r < 0.15 ? 'treasure' : r < 0.18 ? (floor >= AUTO_FLOOR ? 'gas' : '') : r < 0.19 ? 'diary' : ''
  const set = (index: number, kind: string): void => {
    if (grid[index]?.kind !== 'stairs') {
      grid[index] = cell(kind)
    }
  }
  if (event === 'vein') {
    const row = Math.floor(draw() * ROWS)
    for (let x = 0; x < COLS; x += 1) {
      set(row * COLS + x, 'ore')
    }
  } else if (event === 'collapse') {
    for (let k = 0; k < 5; k += 1) {
      const index = Math.floor(draw() * CELLS)
      if (grid[index]?.kind === 'dirt') {
        grid[index] = cell('rock')
      }
    }
  } else if (event === 'treasure') {
    const x0 = Math.floor(draw() * (COLS - 2))
    const y0 = Math.floor(draw() * (ROWS - 2))
    for (let y = 0; y < 3; y += 1) {
      for (let x = 0; x < 3; x += 1) {
        set((y0 + y) * COLS + x0 + x, 'chest')
      }
    }
  } else if (event === 'diary') {
    set(Math.floor(draw() * CELLS), 'diary')
  }

  return { grid, event }
}

// ---- 階の記録（離れた階の掘った跡） ----

/** 新しいマスに、記録（掘った跡）を重ねる */
function overlay(base: MineCell[], record: MineFloorRecord | undefined): MineCell[] {
  if (record === undefined) {
    return base
  }
  const grid = base.map(c => ({ ...c }))
  const at = (key: number | string): MineCell | undefined => grid[Number(key)]
  for (const [key, hp] of Object.entries(record.hurt)) {
    const cell = at(key)
    if (cell !== undefined) {
      cell.hp = Math.min(cell.hp, Math.max(1, hp))
    }
  }
  for (const index of record.open) {
    const cell = at(index)
    if (cell !== undefined) {
      Object.assign(cell, { hp: 0, open: true })
    }
  }
  for (const index of record.alive) {
    const cell = at(index)
    if (cell !== undefined && cell.kind === 'monster') {
      Object.assign(cell, { hp: 0, open: true, alive: true })
    }
  }
  for (const [key, prize] of Object.entries(record.prizes)) {
    const cell = at(key)
    if (cell !== undefined) {
      Object.assign(cell, { hp: 0, open: true, prize })
    }
  }

  return grid
}

/** マスの状態を、新しいマスとの違いだけの記録にする（触っていなければ null） */
function recordOf(grid: readonly MineCell[], base: readonly MineCell[]): MineFloorRecord | null {
  const record: MineFloorRecord = { open: [], hurt: {}, alive: [], prizes: {} }
  let touched = false
  grid.forEach((cell, index) => {
    if (cell.open) {
      touched = true
      if (cell.prize !== undefined) {
        record.prizes[index] = cell.prize
      } else if (cell.alive === true) {
        record.alive.push(index)
      } else {
        record.open.push(index)
      }
    } else if (cell.hp !== base[index]?.hp) {
      touched = true
      record.hurt[index] = cell.hp
    }
  })

  return touched ? record : null
}

/** 階 floor のマスとできごと（保存してあれば掘った跡つき。なければ新しいマス） */
function buildFloor(save: SaveData, floor: number): { grid: MineCell[]; event: string } {
  const base = generateFloor(save.createdAt, floor, save.mine.round)

  return { grid: overlay(base.grid, save.mine.floors[floor]), event: base.event }
}

/** いまの階のマスとできごと（まだ作っていなければ、作ったとおりのもの。セーブは変えない） */
export function floorOf(save: SaveData): { grid: MineCell[]; event: string } {
  const m = save.mine

  return m.grid.length === CELLS ? { grid: m.grid, event: m.event } : buildFloor(save, m.floor)
}

const without = (floors: Record<string, MineFloorRecord>, floor: number): Record<string, MineFloorRecord> => {
  const next = { ...floors }
  delete next[floor]

  return next
}

/** いまの階をセーブに作っておく */
export function ensureFloor(save: SaveData): SaveData {
  return save.mine.grid.length === CELLS ? save : { ...save, mine: { ...save.mine, ...buildFloor(save, save.mine.floor), floors: without(save.mine.floors, save.mine.floor) } }
}

const patchMine = (save: SaveData, patch: Partial<MineState>): SaveData => ({ ...save, mine: { ...save.mine, ...patch } })

function setCell(save: SaveData, index: number, cell: MineCell): SaveData {
  return patchMine(save, { grid: save.mine.grid.map((c, i) => (i === index ? cell : c)) })
}

/** 指定した階に移る（いまの階の掘った跡をしまい、行き先の階を出す。行き先が初めてなら新しいマス）。deepest は行き先まで広げる */
function switchFloor(input: SaveData, floor: number): SaveData {
  const next = Math.max(1, Math.floor(floor))
  const save = ensureFloor(input)
  const m = save.mine
  const record = recordOf(m.grid, generateFloor(save.createdAt, m.floor, m.round).grid)
  const kept = record === null ? without(m.floors, m.floor) : { ...m.floors, [m.floor]: record }
  const arrived = buildFloor({ ...save, mine: { ...m, floors: kept } }, next)

  return patchMine(save, { floor: next, deepest: Math.max(m.deepest, next), floors: without(kept, next), ...arrived })
}

/** 指定した階に入る（いまの階の跡はしまう。裏技などで使う） */
export const enterFloor = (save: SaveData, floor: number): SaveData => switchFloor(save, floor)

const neighbors = (index: number): number[] => {
  const x = index % COLS
  const y = Math.floor(index / COLS)

  return [y > 0 ? index - COLS : -1, y < ROWS - 1 ? index + COLS : -1, x > 0 ? index - 1 : -1, x < COLS - 1 ? index + 1 : -1].filter(n => n >= 0)
}

/** 掘れるか: まだ開いていなくて、一番上の段か、開いたマスのとなり */
export function canDig(grid: readonly MineCell[], index: number): boolean {
  const cell = grid[index]
  if (cell === undefined) {
    return false
  }
  // 生きた魔物は、まわりに関係なくいつでも戦える
  if (cell.open) {
    return cell.alive === true
  }

  return index < COLS || neighbors(index).some(n => grid[n]?.open === true)
}

/** 鉱脈の光がうっすら見えるマスか（鉱石・宝石・宝箱の一部。予知の超能力が付いたら、見える量を増やす） */
export function isGlimpse(save: SaveData, index: number): boolean {
  const { grid, event } = floorOf(save)
  const cell = grid[index]
  if (cell === undefined || cell.open) return false
  if (cell.kind === 'stairs') return hasPsychicNode(save, 'future-7') && roll(`stairs:${save.createdAt}:${save.mine.floor}${roundSalt(save.mine.round)}:${index}`) < 0.3
  if (cell.kind !== 'ore' && cell.kind !== 'gem' && cell.kind !== 'chest') return false
  if (hasPsychicNode(save, 'future-3') && (cell.kind === 'ore' || cell.kind === 'gem')) return true
  return (event === 'vein' && cell.kind === 'ore') || roll(`glimpse:${save.createdAt}:${save.mine.floor}${roundSalt(save.mine.round)}:${index}`) < 0.18
}

/** 階段が開いているか。降りられるか（ボスの階は、この周回でボスを倒したあとだけ） */
export const isStairsOpen = (grid: readonly MineCell[]): boolean => grid.some(c => c.kind === 'stairs' && c.open)
export function canDescend(save: SaveData): boolean {
  const { grid } = floorOf(save)
  const m = save.mine

  return isBossFloor(m.floor) ? m.roundBosses.includes(m.floor) : isStairsOpen(grid)
}

// ---- 階の行き来 ----

/**
 * 階 floor へ移れるか。いまの階と同じなら false。行ったことのある階（1〜deepest）はどこへでも。
 * deepest + 1 は、いま deepest の階にいて降りられる（階段を見つけた／この周回でボスを倒した）ときだけ。それより下へは行けない
 */
export function canGoToFloor(save: SaveData, floor: number): boolean {
  const m = save.mine
  if (!isMineOpen(save) || !Number.isInteger(floor) || floor < 1 || floor === m.floor) {
    return false
  }
  if (floor <= m.deepest) {
    return true
  }

  return floor === m.deepest + 1 && m.floor === m.deepest && canDescend(save)
}

/** 階 floor へ移る（移れなければ undefined）。いまの階の掘った跡は残り、戻れば同じ状態 */
export function goToFloor(input: SaveData, floor: number, _now: number = Date.now()): SaveData | undefined {
  const save = ensureFloor(input)

  return canGoToFloor(save, floor) ? switchFloor(save, floor) : undefined
}

/** 下の階へ（いまの階 + 1） */
export function descend(input: SaveData, now: number = Date.now()): SaveData | undefined {
  return goToFloor(input, input.mine.floor + 1, now)
}

/** 飛び先の一覧: 1、10、20、30…（deepest 以下）と deepest 自身。小さい順 */
export function jumpFloors(save: SaveData): number[] {
  const deepest = Math.max(1, save.mine.deepest)
  const list = new Set<number>([1, deepest])
  for (let f = 10; f <= deepest; f += 10) {
    list.add(f)
  }

  return [...list].sort((a, b) => a - b)
}

/** 階 floor が掘り終わりか。ふつうの階は 35 マス全部が開いていて賞品が 0（生きた魔物は開いているとみなす）。ボスの階はこの周回でボスを倒した。行っていない階は未 */
export function isFloorDone(save: SaveData, floor: number): boolean {
  const m = save.mine
  if (!Number.isInteger(floor) || floor < 1 || floor > m.deepest) {
    return false
  }
  if (isBossFloor(floor)) {
    return m.roundBosses.includes(floor)
  }
  if (floor === m.floor) {
    return m.grid.length === CELLS && m.grid.every(c => c.open && c.prize === undefined)
  }
  const record = m.floors[floor]
  if (record === undefined || Object.keys(record.prizes).length > 0) {
    return false
  }

  return new Set([...record.open, ...record.alive]).size === CELLS
}

/** 1〜deepest のうち掘り終わりの階の数（total = deepest） */
export function floorProgress(save: SaveData): { done: number; total: number } {
  const total = Math.max(1, save.mine.deepest)
  let done = 0
  for (let f = 1; f <= total; f += 1) {
    if (isFloorDone(save, f)) {
      done += 1
    }
  }

  return { done, total }
}

/** 全部の階が掘り終わりになったら、全部の階を新しく作り直す（周回 +1、跡と今周のボスの記録を消す）。結果の flags に 'mine-reset' */
function renewIfDone(save: SaveData): SaveData {
  const m = save.mine
  if (!isMineOpen(save) || !isFloorDone(save, m.floor) || floorProgress(save).done < m.deepest) {
    return save
  }
  const round = m.round + 1
  const last = m.last ?? emptyHaul()
  const flags = [...last.flags.filter(f => f !== 'mine-reset').slice(0, 7), 'mine-reset']

  return patchMine(save, { round, roundBosses: [], floors: {}, ...generateFloor(save.createdAt, m.floor, round), last: { ...last, flags } })
}

// ---- つるはし ----

/** 日付が変わっていたら、今日ためたつるはしと端数を戻す（星鉄のつるはしは毎日 +10） */
export function rollMine(save: SaveData, day: string): SaveData {
  if (!isMineOpen(save) || save.mine.day === day) {
    return save
  }
  const bonus = (PICKAXES[save.mine.pickaxe]?.daily ?? 0) + (setCount(save, 'copper-miner') >= 6 ? 15 : 0)
  const next = patchMine(save, { day, picksToday: 0, toolsFraction: 0 })

  return bonus > 0 ? addItem(next, 'pick', bonus) : next
}

/** ツール成功を tools 回数えて、5 回ごとにつるはし 1 回（1 日 60 回まで）。鉱山が開く前はためない */
export function accruePicks(input: SaveData, day: string, tools: number): SaveData {
  if (!isMineOpen(input) || !(tools > 0)) {
    return input
  }
  const save = rollMine(input, day)
  const total = save.mine.toolsFraction + Math.floor(tools)
  const gain = Math.floor(total / TOOLS_PER_PICK)
  const cap = DAILY_PICK_CAP + (setCount(save, 'copper-miner') >= 6 ? 15 : 0)
  const room = Math.max(0, cap - save.mine.picksToday)
  const got = Math.min(gain, room)
  // 上限に着いたら端数は捨てる
  const fraction = got < gain ? 0 : total % TOOLS_PER_PICK

  return addItem(patchMine(save, { picksToday: save.mine.picksToday + got, toolsFraction: fraction }), 'pick', got)
}

export const picksOf = (save: SaveData): number => save.bag.pick ?? 0

/** 次のつるはしの強化に必要なもの（最後まで強化していれば undefined） */
export function upgradeCost(save: SaveData): { tier: number; needs: string; amount: number; gold: number; stars: number } | undefined {
  const tier = save.mine.pickaxe + 1
  const next = PICKAXES[tier]
  if (next === undefined) {
    return undefined
  }

  return { tier, needs: next.needs, amount: next.amount, gold: Math.round(priceUnit(save) * next.times), stars: next.stars }
}

export function upgradePickaxe(save: SaveData): SaveData | undefined {
  const cost = upgradeCost(save)
  if (!isMineOpen(save) || cost === undefined || (save.bag[cost.needs] ?? 0) < cost.amount || save.gold < cost.gold || save.wallet.stars < cost.stars) {
    return undefined
  }
  const paid = addItem({ ...save, gold: save.gold - cost.gold, wallet: { ...save.wallet, stars: save.wallet.stars - cost.stars } }, cost.needs, -cost.amount)

  return patchMine(paid, { pickaxe: cost.tier })
}

// ---- マスを開ける ----

const emptyHaul = (): MineHaul => ({ items: {}, gold: 0, lamps: 0, exp: 0, stars: 0, flags: [] })

type Dig = { haul: MineHaul; opened: number }

const give = (save: SaveData, dig: Dig, id: string, amount: number): SaveData => {
  if (amount <= 0) {
    return save
  }
  dig.haul.items[id] = (dig.haul.items[id] ?? 0) + amount

  return addItem(save, id, amount)
}

/** 魔物に勝てるか: 戦闘力で、その階の雑魚を 3 秒で倒せるか */
export const canBeatMonster = (save: SaveData, floor: number): boolean => heroStats(save).mobDps * 3 >= enemyHp(mineIndex(floor))

/** ボスの HP（本編のボスの半分。15 秒で倒せればよい） */
export const bossHpAt = (floor: number): number => bossHp(mineIndex(floor)) * 0.5

const cellRoll = (save: SaveData, index: number): ((salt: string) => number) => salt => roll(`cell:${save.createdAt}:${save.mine.floor}${roundSalt(save.mine.round)}:${index}:${salt}`)

/** マス index の中身（賞品）を決める。同じセーブ・階・マスなら、いつも同じ。魔物との戦いもここで決まる。flag = 賞品が無いときに「最後に掘った結果」に出す印 */
function rollPrize(save: SaveData, index: number): { prize: MineHaul | null; flag: string } {
  const cell = save.mine.grid[index]!
  const floor = save.mine.floor
  const layer = layerOf(floor)
  const tier = PICKAXES[save.mine.pickaxe] ?? PICKAXES[0]!
  const r = cellRoll(save, index)
  const ore = ORES[layer]!
  const gem = GEMS[layer]!
  const prize = emptyHaul()
  const add = (id: string, amount: number): void => {
    if (amount > 0) {
      prize.items[id] = (prize.items[id] ?? 0) + amount
    }
  }
  const addOre = (amount: number): void => {
    const psychicOre = hasPsychicNode(save, 'fortune-2') && r('psychic-ore') < 0.1 ? 1 : 0
    // 採掘コンビなど: 鉱石 +N%（端数は決まった乱数で 1 つ足す）
    const bonus = (amount + tier.ore + psychicOre) * petBattleEffects(save).oreRate
    const petOre = Math.floor(bonus) + (r('pet-ore') < bonus - Math.floor(bonus) ? 1 : 0)
    add(ore, amount + tier.ore + psychicOre + petOre)
  }
  let flag = ''

  if (cell.kind === 'dirt') {
    if (r('a') < 0.3) {
      add('pebble', 1)
    }
    // 木材: 浅い階（20 階まで）の土から。大農場の拡張に使う
    if (floor <= WOOD_FLOORS && r('wood') < 0.2) {
      add('wood', 1)
    }
  } else if (cell.kind === 'rock') {
    if (r('a') < 0.5) {
      addOre(1 + Math.floor(r('b') * 2))
    }
  } else if (cell.kind === 'hard') {
    addOre(2 + Math.floor(r('a') * 3))
  } else if (cell.kind === 'ore') {
    addOre(2 + Math.floor(r('a') * 4))
    if (r('g') < tier.gem) {
      add(gem, 1)
    }
  } else if (cell.kind === 'gem') {
    add(gem, 1)
  } else if (cell.kind === 'chest') {
    prize.lamps = 1 + Math.floor(r('a') * 3)
    prize.gold = psychicGoldReward(save, Math.round(priceUnit(save) * (0.1 + r('b') * 0.3)))
    // まれに装備（確認待ちの装備があるときは出さない。もらうときにもう一度見る）
    if (r('c') < 0.04 && save.pending === null) {
      prize.flags.push('gear')
    }
  } else if (cell.kind === 'monster') {
    if (canBeatMonster(save, floor)) {
      addOre(2 + Math.floor(r('a') * 2))
      prize.exp = expPerKill(mineIndex(floor)) * 10
      prize.flags.push('win')
    } else {
      flag = 'lose'
    }
  } else if (cell.kind === 'fossil') {
    add('fossil', 1)
    prize.flags.push('fossil')
  } else if (cell.kind === 'spring') {
    add('pick', SPRING_PICKS)
    prize.flags.push('spring')
  } else if (cell.kind === 'stairs') {
    flag = 'stairs'
  } else if (cell.kind === 'diary') {
    prize.flags.push('diary')
  }
  const isEmpty = Object.keys(prize.items).length === 0 && prize.lamps === 0 && prize.gold === 0 && prize.exp === 0 && prize.flags.length === 0

  return { prize: isEmpty ? null : prize, flag }
}

/** 賞品をもらう（化石・日記の記録、装備もここ）。もらったものを dig.haul に足す */
function applyPrize(input: SaveData, index: number, prize: MineHaul, now: number, dig: Dig): SaveData {
  let save = input
  const r = cellRoll(save, index)
  for (const [id, amount] of Object.entries(prize.items)) {
    save = give(save, dig, id, amount)
  }
  if (prize.lamps > 0) {
    save = grant(save, [{ kind: 'chests', amount: prize.lamps }])
    dig.haul.lamps += prize.lamps
  }
  if (prize.gold > 0) {
    save = { ...save, gold: save.gold + prize.gold }
    dig.haul.gold += prize.gold
  }
  if (prize.exp > 0) {
    save = addExp(save, prize.exp)
    dig.haul.exp += prize.exp
  }
  if (prize.stars > 0) {
    save = grant(save, [{ kind: 'stars', amount: prize.stars }])
    dig.haul.stars += prize.stars
  }
  for (const flag of prize.flags) {
    if (flag === 'gear') {
      if (save.pending === null) {
        const rolled = rollItem(save)
        const golden = applyGoldenHand(rolled.save, rolled.item)
        save = judge(golden.save, golden.item, now).save
        dig.haul.flags.push('gear')
      }
    } else if (flag === 'fossil') {
      const unseen = Array.from({ length: FOSSIL_COUNT }, (_, k) => k + 1).filter(k => !save.mine.fossils.includes(k))
      const found = unseen[Math.floor(r('a') * unseen.length)]
      if (found !== undefined) {
        save = patchMine(save, { fossils: [...save.mine.fossils, found].sort((a, b) => a - b) })
        dig.haul.flags.push(`fossil-${found}`)
        if (save.mine.fossils.length >= FOSSIL_COUNT) {
          save = grant(save, [{ kind: 'title', id: 'fossilist' }])
        }
      }
    } else if (flag === 'diary') {
      const unread = Array.from({ length: DIARY_COUNT }, (_, k) => k).filter(k => !save.mine.diaries.includes(k))
      const page = unread[0]
      if (page !== undefined) {
        save = patchMine(save, { diaries: [...save.mine.diaries, page].sort((a, b) => a - b) })
        dig.haul.flags.push(`diary-${page}`)
      } else {
        save = give(save, dig, 'pebble', 1)
      }
    } else {
      dig.haul.flags.push(flag)
    }
  }

  return save
}

/** マス index を開ける。defer なら、賞品はマスに置いておく（もう一度押してもらう）。そうでなければすぐもらう（マスはもう掘れる状態になっている前提） */
function openCell(input: SaveData, index: number, now: number, dig: Dig, defer = false): SaveData {
  const cell = input.mine.grid[index]
  if (cell === undefined || (cell.open && cell.alive !== true)) {
    return input
  }
  // 画面から掘って閉じた魔物が出てきたら、まだ戦わない（生きた魔物として残す。もう一度押すと戦う）
  if (defer && cell.kind === 'monster' && !cell.open) {
    dig.opened += 1
    dig.haul.flags.push('monster')

    return setCell(input, index, { kind: cell.kind, hp: 0, open: true, alive: true })
  }
  const { prize, flag } = rollPrize(input, index)
  // 魔物に勝てなかったら、生きたまま残る（開いた扱いのまま。強くなってからもう一度戦える）
  if (flag === 'lose') {
    dig.opened += 1
    dig.haul.flags.push(flag)

    return setCell(input, index, { kind: cell.kind, hp: 0, open: true, alive: true })
  }
  if (defer && prize !== null) {
    return setCell(input, index, { kind: cell.kind, hp: 0, open: true, prize })
  }
  const save = setCell(input, index, { kind: cell.kind, hp: 0, open: true })
  dig.opened += 1
  if (flag !== '') {
    dig.haul.flags.push(flag)
  }

  return prize === null ? save : applyPrize(save, index, prize, now, dig)
}

/** 開いたマス index の賞品をもらう。賞品が無ければ undefined。「最後に掘った結果」はこのもらったものになる */
export function collectCell(input: SaveData, index: number, now: number): SaveData | undefined {
  const cell = input.mine.grid[index]
  if (!isMineOpen(input) || cell === undefined || !cell.open || cell.prize === undefined) {
    return undefined
  }
  const dig: Dig = { haul: emptyHaul(), opened: 1 }
  const save = applyPrize(setCell(input, index, { kind: cell.kind, hp: 0, open: true }), index, cell.prize, now, dig)

  return renewIfDone(withLast(save, dig))
}

/** マスの状態（画面の絵を選ぶ用）: closed = まだ閉じていて掘れる、far = 閉じていてまだ掘れない、glimpse = 光って見える、prize = 賞品が待っている、stairs = 開いた階段、empty = 開いて空、monster = 魔物に勝てず生きている（もう一度戦える） */
export type CellState = 'closed' | 'far' | 'glimpse' | 'prize' | 'stairs' | 'empty' | 'monster'
export function cellState(save: SaveData, index: number): { state: CellState; kind: string; diggable: boolean } {
  const { grid } = floorOf(save)
  const cell = grid[index]
  if (cell === undefined) {
    return { state: 'far', kind: 'dirt', diggable: false }
  }
  if (cell.open && cell.alive === true) {
    return { state: 'monster', kind: cell.kind, diggable: true }
  }
  if (!cell.open) {
    const diggable = canDig(grid, index)

    return { state: isGlimpse(save, index) ? 'glimpse' : diggable ? 'closed' : 'far', kind: cell.kind, diggable }
  }
  const state: CellState = cell.prize !== undefined ? 'prize' : cell.kind === 'stairs' ? 'stairs' : 'empty'

  return { state, kind: cell.kind, diggable: false }
}

/** 開けたマスがあれば、その結果を「最後に掘った結果」にする（何も出なかったら「何もなかった」） */
function withLast(save: SaveData, dig: Dig): SaveData {
  if (dig.opened === 0) {
    return save
  }
  const h = dig.haul
  const isEmpty = Object.keys(h.items).length === 0 && h.gold === 0 && h.lamps === 0 && h.exp === 0 && h.stars === 0 && h.flags.length === 0

  return patchMine(save, { last: isEmpty ? { ...h, flags: ['nothing'] } : { ...h, flags: [...new Set(h.flags)].slice(0, 8) } })
}

/** つるはしで 1 回叩く（マスの残りの回数が減る。0 で開いて中身をもらう）。swing と自動採掘で共有 */
function strike(input: SaveData, index: number, now: number, defer = false): { save: SaveData; dig: Dig } | undefined {
  if (!isMineOpen(input)) {
    return undefined
  }
  let save = ensureFloor(input)
  const m = save.mine
  if (picksOf(save) < 1 || !canDig(m.grid, index)) {
    return undefined
  }
  const tier = PICKAXES[m.pickaxe] ?? PICKAXES[0]!
  const luck = (salt: string): number => roll(`swing:${save.createdAt}:${m.floor}:${m.swings}:${salt}`)
  const doubleChance = Math.min(1, tier.double + (setCount(save, 'copper-miner') >= 2 ? 0.1 : 0) + petBattleEffects(save).mineRate)
  const power = 1 + (luck('double') < doubleChance ? 1 : 0)
  const targets = [index]
  if (luck('area') < tier.area) {
    const x = index % COLS
    targets.push(...[x > 0 ? index - 1 : -1, x < COLS - 1 ? index + 1 : -1].filter(n => n >= 0))
  }
  save = patchMine(addItem(save, 'pick', -1), { swings: m.swings + 1 })
  const dig: Dig = { haul: emptyHaul(), opened: 0 }
  for (const target of targets) {
    const cell = save.mine.grid[target]
    // 生きた魔物は、押したマスだけ戦う（左右の巻き込みでは戦わない）
    if (cell === undefined || (cell.open && !(cell.alive === true && target === index))) {
      continue
    }
    save = cell.hp - power > 0 ? setCell(save, target, { ...cell, hp: cell.hp - power }) : openCell(save, target, now, dig, defer)
  }

  return { save, dig }
}

/** マス index をつるはしで叩く。hits = 数える叩いた回数。defer = 開いたマスの賞品をマスに置いておく（画面から叩くとき。爆弾・自動採掘はすぐもらう） */
export function swing(input: SaveData, index: number, now: number, defer = false): { save: SaveData; hits: number } | undefined {
  const done = strike(input, index, now, defer)
  if (done === undefined) {
    return undefined
  }
  const save = withLast(done.save, done.dig)
  // 画面で出てきたばかりの魔物は、最後のマスでも姿を残す（「戦う」を押す前に作り直さない）。
  return { save: defer && done.dig.haul.flags.includes('monster') ? save : renewIfDone(save), hits: 1 }
}

/** 爆弾: マス index を中心に 3×3（ガス溜まりの階では 5×5）をまとめて開ける。つるはしは使わない */
export function useBomb(input: SaveData, index: number, now: number): SaveData | undefined {
  if (!isMineOpen(input)) {
    return undefined
  }
  let save = ensureFloor(input)
  if ((save.bag.bomb ?? 0) < 1 || !canDig(save.mine.grid, index)) {
    return undefined
  }
  const radius = save.mine.event === 'gas' ? 2 : 1
  save = addItem(save, 'bomb', -1)
  const dig: Dig = { haul: emptyHaul(), opened: 0 }
  const cx = index % COLS
  const cy = Math.floor(index / COLS)
  for (let y = Math.max(0, cy - radius); y <= Math.min(ROWS - 1, cy + radius); y += 1) {
    for (let x = Math.max(0, cx - radius); x <= Math.min(COLS - 1, cx + radius); x += 1) {
      save = openCell(save, y * COLS + x, now, dig)
    }
  }
  dig.haul.flags.push('bomb')

  return renewIfDone(patchMine(withLast(save, dig), { bomb: (save.bag.bomb ?? 0) > 0 && save.mine.bomb }))
}

export function toggleBombMode(save: SaveData): SaveData | undefined {
  return isMineOpen(save) ? patchMine(save, { bomb: !save.mine.bomb }) : undefined
}

// ---- ボス ----

/** いまの強さでボスに挑んだら: 15 秒で与えるダメージとボスの HP */
export function bossOutlook(save: SaveData): { damage: number; hp: number; isLikely: boolean } {
  const damage = heroStats(save).bossDps * BOSS_SECONDS
  const hp = bossHpAt(save.mine.floor)

  return { damage, hp, isLikely: damage >= hp }
}

/** ボスの絵の ID（階のボスの種類で決まる） */
const BOSS_FIGURES = ['mine-boss-copper', 'mine-boss-iron', 'mine-boss-crystal', 'mine-boss-mithril', 'mine-boss-adamant']
export const mineBossFigureId = (floor: number): string => BOSS_FIGURES[bossType(floor)] ?? 'mine-boss-copper'

const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0)

/**
 * 戦いの記録（画面で再生する用）。勝ち負けは bossOutlook と同じ数で決まる。
 * 鉱山のボス戦に主人公の HP の計算は無いので、heroHpLeft は「どれだけ余裕があったか」から作る:
 * 勝ち = 早く倒すほど多い（0.1〜1）、負け = 0。bossHpLeft は負けたとき、与えたダメージの割合を引いたもの（0.02〜1）
 */
function bossRecord(save: SaveData, now: number): MineBossFight {
  const { damage, hp, isLikely } = bossOutlook(save)
  const seconds = isLikely ? Math.min(BOSS_SECONDS, (hp / Math.max(1e-9, damage)) * BOSS_SECONDS) : BOSS_SECONDS
  const used = seconds / BOSS_SECONDS

  return {
    floor: save.mine.floor,
    won: isLikely,
    seconds: Math.round(seconds * 100) / 100,
    limit: BOSS_SECONDS,
    heroHpLeft: isLikely ? Math.max(0.1, clamp01(1 - used * 0.75)) : 0,
    bossHpLeft: isLikely ? 0 : Math.max(0.02, clamp01(1 - damage / Math.max(1e-9, hp))),
    at: Math.max(0, Math.floor(now)),
  }
}

/** ボスに挑む（つるはし 5 回）。勝てば星のかけら・宝石・ボス鉱石・称号（最初の 1 回）をもらう（階はそのまま。降りるのは「下の階へ」）。負けても何度でも挑める。周回ごとにまた挑める */
export function fightBoss(input: SaveData, now: number = Date.now()): { save: SaveData; isWin: boolean } | undefined {
  if (!isMineOpen(input)) {
    return undefined
  }
  let save = ensureFloor(input)
  const m = save.mine
  if (!isBossPending(m) || picksOf(save) < BOSS_PICKS) {
    return undefined
  }
  save = addItem(save, 'pick', -BOSS_PICKS)
  const isWin = bossOutlook(save).isLikely
  save = patchMine(save, { lastBoss: bossRecord(save, now) })
  const dig: Dig = { haul: emptyHaul(), opened: 1 }
  if (!isWin) {
    dig.haul.flags.push('boss-lose')

    return { save: withLast(save, dig), isWin }
  }
  const layer = layerOf(m.floor)
  const type = bossType(m.floor)
  save = give(save, dig, GEMS[layer]!, 2)
  save = give(save, dig, `ore-boss-${type + 1}`, 1)
  save = give(save, dig, 'guard-stone', 1)
  const isFirst = m.bossesBeaten.length === 0
  save = patchMine(save, { bossesBeaten: m.bossesBeaten.includes(m.floor) ? m.bossesBeaten : [...m.bossesBeaten, m.floor].slice(-200), roundBosses: [...m.roundBosses, m.floor].sort((x, y) => x - y) })
  save = grant(save, [{ kind: 'stars', amount: BOSS_STARS }, ...(isFirst ? [{ kind: 'title' as const, id: 'rockbreaker' }] : [])])
  dig.haul.stars += psychicStarReward(save, BOSS_STARS)
  dig.haul.flags.push('boss-win')

  return { save: renewIfDone(withLast(save, dig)), isWin }
}

// ---- 自動採掘 ----

/** 自動採掘が解放されているか（21 階に着いた、または持ち物にドローンがある） */
export const isAutoUnlocked = (save: SaveData): boolean => save.mine.deepest >= AUTO_FLOOR || (save.bag.drone ?? 0) > 0

export function toggleAuto(save: SaveData, now: number): SaveData | undefined {
  if (!isMineOpen(save) || !isAutoUnlocked(save)) {
    return undefined
  }

  return patchMine(save, { auto: !save.mine.auto, autoAt: now })
}

/** 自動で叩くマス: 光が見えるマスが先、なければ上の段から */
function autoTarget(save: SaveData): number | undefined {
  const { grid } = floorOf(save)
  // 生きた魔物は、叩いても負けるだけなので自動では戦わない
  const open = grid.map((_, i) => i).filter(i => canDig(grid, i) && grid[i]?.alive !== true)

  return open.find(i => isGlimpse(save, i)) ?? open[0]
}

/**
 * 自動採掘: 10 分ごとに最大 10 回、自動で叩く（閉じていた分も 8 時間まで追いつく）。いまの階だけを叩く（階は変えない）。叩けるマスがなければ止まる（掘り終わり・ボス待ち・つるはし切れ）。
 * 叩いた回数 hits を返す（日課・週課に数える）。stairs は常に 0
 */
export function autoMine(input: SaveData, now: number): { save: SaveData; hits: number; stairs: number } {
  const m = input.mine
  if (!m.auto || !isMineOpen(input) || !isAutoUnlocked(input)) {
    return { save: input, hits: 0, stairs: 0 }
  }
  if (m.autoAt <= 0 || m.autoAt > now) {
    return { save: patchMine(input, { autoAt: now }), hits: 0, stairs: 0 }
  }
  const steps = Math.min(AUTO_MAX_STEPS, Math.floor((now - m.autoAt) / AUTO_EVERY_MS))
  if (steps < 1) {
    return { save: input, hits: 0, stairs: 0 }
  }
  let save = ensureFloor(input)
  let hits = 0
  const stairs = 0
  const items: Record<string, number> = {}
  const tally = (before: Record<string, number>, after: Record<string, number>): void => {
    for (const [id, count] of Object.entries(after)) {
      if (id !== 'pick' && count > (before[id] ?? 0)) {
        items[id] = (items[id] ?? 0) + count - (before[id] ?? 0)
      }
    }
  }
  let isStopped = false
  for (let step = 0; step < steps && !isStopped; step += 1) {
    for (let n = 0; n < AUTO_MAX_HITS && !isStopped; ) {
      if (isBossPending(save.mine)) {
        isStopped = true
      } else {
        const target = autoTarget(save)
        const before = save.bag
        const done = target === undefined || picksOf(save) < 1 ? undefined : swing(save, target, now)
        if (done === undefined) {
          isStopped = true
        } else {
          save = done.save
          hits += done.hits
          n += 1
          tally(before, save.bag)
        }
      }
    }
  }
  // 8 時間より前の分は捨てる（追いついたことにする）。止まったときも時計は進める
  const autoAt = steps >= AUTO_MAX_STEPS ? now : m.autoAt + steps * AUTO_EVERY_MS

  return { save: patchMine(save, { autoAt, ...(hits > 0 || stairs > 0 ? { autoLast: { items, hits } } : {}) }), hits, stairs }
}
