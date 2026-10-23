import type { Animal, BuffKind, FarmLast, FarmPlot, FarmState, FeatureId, SaveData } from '../types'
import { addFood } from './buffs'
import { READY, addItem, isUnlocked } from './calendar'
import { DAY_START_HOUR } from './config'
import { dayKey } from './fuel'
import { random } from './gear'
import { hasPsychicNode, psychicStarReward } from './psychic'

// 農場と台所（4 日目、docs/DAILY.md の 5 章）。$ を使わない純粋な関数。
// 作物は「実時間」で育つ（オフラインでも）。セーブには、まいた時刻・続きを数え始める時刻（from）・そこまでに育った時間（grown）・縮めた時間だけを持ち、
// 育ち具合・バグ・実り（plotView）は表示のときに計算する（毎秒は書かない）。乱数はセーブの rng か、時刻と種（createdAt）から決めた数だけ。

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

export const FARM_PLOTS = 6
/** 農場 Lv の上限（大農場が開く前は 10） */
export const FARM_MAX_LEVEL = 20
export const FARM_MAX_LEVEL_SMALL = 10
/** 温室の区画の番号は 100 から（畑の区画は 0〜35） */
export const GREENHOUSE_BASE = 100
export const GREENHOUSE_PLOTS = 6
/** 畑の区画の最大数 */
export const FARM_PLOTS_MAX = 36
/** 温室: 成長 +20% */
export const GREENHOUSE_SPEED = 1.2
/** スプリンクラー 1 台がまく区画の数と、まく間隔 */
export const SPRINKLER_PLOTS = 6
export const SPRINKLER_MS = HOUR
/** 回答 1 回の水やり（育つ時間の割合）と、1 回の作物につきの合計の上限 */
export const WATER_STEP = 0.03
export const WATER_CAP = 0.3
/** 肥料: 育つ速さ +30% */
export const FERT_SPEED = 1.3
/** 肥料: 収穫のときに品質が 1 上がる確率 */
export const FERT_QUALITY_CHANCE = 0.4
/** 実りから、この時間がたつと「熟れすぎ」（品質 -1。消えない） */
export const OVERRIPE_MS = DAY
/** 害虫: 1 区画あたり 1 時間にこの確率（嵐は 2 倍） */
export const PEST_CHANCE = 0.04
/** 金色の作物の確率（虹の日は 3 倍） */
export const GOLD_CHANCE = 0.02

export type Crop = { id: string; minutes: number; seed: number; sell: number; lv: number; locked?: FeatureId }

/** 作物 14 種（種の値段・売値は物価 P の何倍か）。ユニコードの花は大農場（12 日目）なのでまだ育てられない */
export const CROPS: readonly Crop[] = [
  { id: 'carrot', minutes: 20, seed: 0.05, sell: 0.1, lv: 1 },
  { id: 'potato', minutes: 60, seed: 0.1, sell: 0.25, lv: 1 },
  { id: 'tomato', minutes: 120, seed: 0.15, sell: 0.4, lv: 1 },
  { id: 'corn', minutes: 180, seed: 0.2, sell: 0.6, lv: 2 },
  { id: 'pumpkin', minutes: 360, seed: 0.35, sell: 1.1, lv: 3 },
  { id: 'berry', minutes: 240, seed: 0.3, sell: 0.9, lv: 3 },
  { id: 'bean', minutes: 480, seed: 0.5, sell: 1.6, lv: 4 },
  { id: 'wheat', minutes: 300, seed: 0.3, sell: 1.0, lv: 4 },
  { id: 'melon', minutes: 720, seed: 0.8, sell: 2.8, lv: 5 },
  { id: 'tea', minutes: 600, seed: 0.7, sell: 2.3, lv: 6 },
  { id: 'pepper', minutes: 420, seed: 0.5, sell: 1.7, lv: 6 },
  { id: 'rice', minutes: 540, seed: 0.6, sell: 2.0, lv: 7 },
  { id: 'herb', minutes: 30, seed: 0.1, sell: 0.2, lv: 2 },
  { id: 'flower', minutes: 1440, seed: 0, sell: 6, lv: 1, locked: 'bigfarm' },
]

export const CROP_IDS: readonly string[] = CROPS.map(c => c.id)
export const cropOf = (id: string): Crop | undefined => CROPS.find(c => c.id === id)

/** 品質（★1〜★3・金色）と、料理の効き目・売値の倍率 */
export const QUALITIES: readonly string[] = ['q1', 'q2', 'q3', 'gold']
export const QUALITY_RATE: Record<string, number> = { q1: 1, q2: 1.3, q3: 1.7, gold: 3 }
/** 売値の倍率（金色は 10 倍） */
export const QUALITY_SELL: Record<string, number> = { q1: 1, q2: 1.3, q3: 1.7, gold: 10 }

export const seedId = (crop: string): string => `seed-${crop}`
export const cropItemId = (crop: string, quality: string): string => `crop-${crop}-${quality}`

export const emptyFarm = (): FarmState => ({
  plots: Array.from({ length: FARM_PLOTS }, () => null),
  xp: 0,
  harvested: [],
  bugsKilled: 0,
  cheat: null,
  last: null,
  greenhouse: [],
  sprinklers: 0,
  sprinkledAt: 0,
  animals: {},
  decor: [],
  signName: 0,
  petHouseDay: '',
})

/** 文字列から決まった数（FNV-1a） */
function hash(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    h = Math.imul(h ^ text.charCodeAt(i), 0x01000193)
  }

  return h >>> 0
}

// ---- 農場 Lv ----

/** Lv L に必要な経験値の合計（Lv2 = 10、Lv3 = 30、Lv4 = 60 …） */
export const xpForLevel = (level: number): number => 5 * (level - 1) * level

/** 大農場が遊べるか */
export const isBigFarmOpen = (save: SaveData): boolean => READY.has('bigfarm') && isUnlocked(save, 'bigfarm')

/** 農場 Lv の上限（大農場が開くと 20 まで） */
export const levelCap = (save: SaveData): number => (isBigFarmOpen(save) ? FARM_MAX_LEVEL : FARM_MAX_LEVEL_SMALL)

export function farmLevel(save: SaveData): number {
  let level = 1
  const cap = levelCap(save)
  while (level < cap && save.farm.xp >= xpForLevel(level + 1)) {
    level += 1
  }

  return level
}

/** 農場が遊べるか */
export const isFarmOpen = (save: SaveData): boolean => READY.has('farm') && isUnlocked(save, 'farm')

/** いま育てられる作物（農場 Lv が足りていて、大農場待ちでないもの） */
export function growable(save: SaveData): Crop[] {
  const lv = farmLevel(save)

  return CROPS.filter(c => c.lv <= lv && (c.locked === undefined || (READY.has(c.locked) && isUnlocked(save, c.locked))))
}

// ---- 天気 ----

export const WEATHERS: readonly string[] = ['sunny', 'cloudy', 'rain', 'storm', 'rainbow', 'meteor']
/** 確率（%）: 晴れ 40・くもり 25・雨 20・嵐 8・虹 5・流れ星 2 */
const WEATHER_PERCENT: readonly number[] = [40, 25, 20, 8, 5, 2]

/** その日の天気（日付とセーブの種から決まる。毎朝 4 時に変わる） */
export function weatherOn(save: SaveData, day: string): string {
  if (save.farm.cheat !== null && save.farm.cheat.day === day) {
    return save.farm.cheat.weather
  }
  let r = hash(`weather:${day}:${save.createdAt}`) % 100
  for (let i = 0; i < WEATHERS.length; i += 1) {
    if (r < WEATHER_PERCENT[i]!) {
      return WEATHERS[i]!
    }
    r -= WEATHER_PERCENT[i]!
  }

  return 'sunny'
}

/** 開発用チート: 今日だけ天気を固定する */
export function cheatWeather(save: SaveData, day: string, weather: string): SaveData | undefined {
  if (!WEATHERS.includes(weather)) {
    return undefined
  }

  return { ...save, farm: { ...save.farm, cheat: { day, weather } } }
}

const dayAt = (ms: number): string => dayKey(ms, new Date(ms).getTimezoneOffset())
export const weatherAt = (save: SaveData, ms: number): string => weatherOn(save, dayAt(ms))

/** 超能力画面用の明日の予報。天気は日付とセーブの種から決まる。 */
export const weatherTomorrow = (save: SaveData, now: number): string => weatherAt(save, nextDayStart(now))

/** 時差（分。new Date(ms).getTimezoneOffset() と同じ向き）。テストで夏時間の地域を真似るために差し替えられる */
export type OffsetAt = (ms: number) => number
const systemOffset: OffsetAt = ms => new Date(ms).getTimezoneOffset()

/**
 * ローカルの「日の番号」から数えて days 日目の朝 4 時（本当の時刻）。
 * 日付を進めてから、その朝 4 時の時点の時差で直す（夏時間の切り替え日でも、ちょうど朝 4 時になる）
 */
function localDayStart(dayIndex: number, offsetAt: OffsetAt, guess: number): number {
  const wall = dayIndex * DAY + DAY_START_HOUR * HOUR
  let t = wall + offsetAt(guess) * MINUTE
  for (let i = 0; i < 2; i += 1) {
    t = wall + offsetAt(t) * MINUTE
  }

  return t
}

/** ms の「ローカルの日の番号」（朝 4 時で変わる） */
const localDayIndex = (ms: number, offsetAt: OffsetAt): number => Math.floor((ms - offsetAt(ms) * MINUTE - DAY_START_HOUR * HOUR) / DAY)

/** ms 以前で、いちばん遅い朝 4 時 */
export function dayStartAt(ms: number, offsetAt: OffsetAt = systemOffset): number {
  return localDayStart(localDayIndex(ms, offsetAt), offsetAt, ms)
}

/** ms より後で、いちばん早い朝 4 時 */
export function nextDayStart(ms: number, offsetAt: OffsetAt = systemOffset): number {
  const index = localDayIndex(ms, offsetAt)
  let next = localDayStart(index + 1, offsetAt, ms + DAY)
  // 時差の変わり目でずれても、ms より後になるまで日付を進める
  for (let guard = 0; next <= ms && guard < 3; guard += 1) {
    next = localDayStart(index + 2 + guard, offsetAt, ms + 2 * DAY)
  }

  return next
}

// ---- 区画 ----

const growMs = (save: SaveData, crop: string): number => ((cropOf(crop)?.minutes ?? 60) * MINUTE) / (hasPsychicNode(save, 'fortune-3') ? 1.08 : 1)
export const isGreenhouseIndex = (index: number): boolean => index >= GREENHOUSE_BASE

/** 区画の中身（畑 0〜35・温室 100〜105） */
export function plotAt(save: SaveData, index: number): FarmPlot | null | undefined {
  return isGreenhouseIndex(index) ? save.farm.greenhouse[index - GREENHOUSE_BASE] : save.farm.plots[index]
}

/** その番号の区画が使えるか（畑は広げた数まで、温室は建てたあと） */
export const isPlotUsable = (save: SaveData, index: number): boolean =>
  Number.isInteger(index) && (isGreenhouseIndex(index) ? index - GREENHOUSE_BASE < save.farm.greenhouse.length : index >= 0 && index < save.farm.plots.length)

const hasDecor = (save: SaveData, id: string): boolean => save.farm.decor.includes(id)

/** 育つのに必要な時間: 肥料 +30%・温室 +20%・噴水 +3% */
const needMs = (save: SaveData, plot: FarmPlot, index = 0): number =>
  growMs(save, plot.crop) / (plot.fert ? FERT_SPEED : 1) / (isGreenhouseIndex(index) ? GREENHOUSE_SPEED : 1) / (hasDecor(save, 'fountain') ? 1.03 : 1)

export type PlotView = {
  /** 実っている */
  isRipe: boolean
  /** 実った時刻（実っていなければ 0） */
  readyAt: number
  /** バグがいる（成長が止まっている） */
  hasBug: boolean
  /** バグが出た時刻 */
  bugAt: number
  /** 育った時間 / 必要な時間 */
  grown: number
  need: number
  /** 0 種・1 芽・2 つぼみ・3 実り */
  stage: 0 | 1 | 2 | 3
  /** 実りまで、このまま育てばあと何ミリ秒 */
  leftMs: number
  /** 実りから 24 時間以上たった */
  isOverripe: boolean
}

/**
 * 区画のいまの様子を計算する。from から now まで、時間を追って: 1 時間ごとのバグの抽選（まいた時刻から数えた時刻・区画の番号・セーブの種で決まる）、
 * 朝 4 時の天気（雨 = 育つ時間 -15%、嵐 = -10% 後戻り）。バグが出たらそこで止まる（駆除すると from が進む）
 */
export function plotView(save: SaveData, index: number, now: number): PlotView | undefined {
  const plot = plotAt(save, index)
  if (plot === undefined || plot === null) {
    return undefined
  }
  const inGreenhouse = isGreenhouseIndex(index)
  const need = needMs(save, plot, index)
  let t = plot.from
  let g = plot.grown
  let i = Math.floor((t - plot.at) / HOUR) + 1
  let b = nextDayStart(t)
  let bugAt = 0
  let readyAt = 0
  for (let guard = 0; guard < 2_000; guard += 1) {
    if (g >= need - 1e-6) {
      g = need
      readyAt = t
      break
    }
    const ripeAt = t + (need - g)
    const pestAt = plot.at + i * HOUR
    const event = Math.min(ripeAt, pestAt, b)
    if (event > now) {
      g += Math.max(0, now - t)
      t = Math.max(t, now)
      break
    }
    g += event - t
    t = event
    if (g >= need - 1e-6) {
      continue
    }
    if (event === pestAt) {
      i += 1
      const stormRate = hasPsychicNode(save, 'future-4') ? 1.5 : 2
      const base = hasDecor(save, 'scarecrow') ? PEST_CHANCE / 2 : PEST_CHANCE
      const chance = !inGreenhouse && weatherAt(save, pestAt) === 'storm' ? base * stormRate : base
      if (hash(`pest:${save.createdAt}:${index}:${plot.at}:${i - 1}`) / 0x100000000 < chance) {
        bugAt = pestAt
        break
      }
    }
    if (event === b) {
      // 温室は天気の影響を受けない
      const weather = inGreenhouse ? 'sunny' : weatherAt(save, b)
      if (weather === 'rain') {
        g = Math.min(need, g + need * 0.15)
      } else if (weather === 'storm') {
        g = Math.max(0, g - need * (hasPsychicNode(save, 'future-4') ? 0.05 : 0.1))
      }
      b = nextDayStart(b)
    }
  }
  const isRipe = readyAt > 0
  const ratio = need > 0 ? g / need : 1
  const stage = isRipe ? 3 : ratio < 1 / 3 ? 0 : ratio < 2 / 3 ? 1 : 2

  return {
    isRipe,
    readyAt,
    hasBug: bugAt > 0,
    bugAt,
    grown: g,
    need,
    stage,
    leftMs: Math.max(0, need - g),
    isOverripe: isRipe && now - readyAt >= OVERRIPE_MS,
  }
}

const setPlot = (save: SaveData, index: number, plot: FarmPlot | null): SaveData =>
  isGreenhouseIndex(index)
    ? { ...save, farm: { ...save.farm, greenhouse: save.farm.greenhouse.map((p, i) => (i + GREENHOUSE_BASE === index ? plot : p)) } }
    : { ...save, farm: { ...save.farm, plots: save.farm.plots.map((p, i) => (i === index ? plot : p)) } }

/** 種をまく（空き区画・育てられる作物・種を持っているとき） */
export function plant(save: SaveData, index: number, crop: string, now: number): SaveData | undefined {
  if (!isFarmOpen(save) || !isPlotUsable(save, index) || plotAt(save, index) !== null) {
    return undefined
  }
  if (!growable(save).some(c => c.id === crop) || (save.bag[seedId(crop)] ?? 0) < 1) {
    return undefined
  }
  // ユニコードの花は温室でだけ育つ
  if (crop === 'flower' && !isGreenhouseIndex(index)) {
    return undefined
  }
  const golden = (save.bag['gold-seed'] ?? 0) > 0
  let next = addItem(save, seedId(crop), -1)
  if (golden) next = addItem(next, 'gold-seed', -1)

  return setPlot(next, index, { crop, at: now, grown: 0, from: now, watered: 0, fert: false, ...(golden ? { golden: true } : {}) })
}

/** 肥料をまく（育っている途中で、バグがいなくて、まだ肥料をまいていない区画） */
export function fertilize(save: SaveData, index: number, now: number): SaveData | undefined {
  const plot = plotAt(save, index)
  const view = plotView(save, index, now)
  if (plot === undefined || plot === null || view === undefined || view.isRipe || view.hasBug || plot.fert || (save.bag.fertilizer ?? 0) < 1) {
    return undefined
  }

  return setPlot(addItem(save, 'fertilizer', -1), index, { ...plot, grown: view.grown, from: now, fert: true })
}

/** バグを駆除する（ボタン 1 回）。いなければ undefined */
export function killPest(save: SaveData, index: number, now: number): SaveData | undefined {
  const plot = plotAt(save, index)
  const view = plotView(save, index, now)
  if (plot === undefined || plot === null || view === undefined || !view.hasBug) {
    return undefined
  }
  const next = setPlot(save, index, { ...plot, grown: view.grown, from: now })

  return { ...next, farm: { ...next.farm, bugsKilled: next.farm.bugsKilled + 1 } }
}

/** 区画 1 つに水をやる: 残り時間の step 分を縮める（作物ごとの合計は育つ時間の 30% まで）。やれないときは undefined */
function waterPlot(save: SaveData, index: number, at: number, step: number): SaveData | undefined {
  const plot = plotAt(save, index)
  const view = plotView(save, index, at)
  if (plot === undefined || plot === null || view === undefined || view.isRipe || view.hasBug || plot.from > at) {
    return undefined
  }
  const add = Math.min(view.leftMs * step, growMs(save, plot.crop) * WATER_CAP - plot.watered)
  if (add <= 0) {
    return undefined
  }

  return setPlot(save, index, { ...plot, grown: Math.min(view.need, view.grown + add), from: at, watered: plot.watered + add })
}

/** 水やりの対象の区画の番号（畑と温室） */
const allIndexes = (save: SaveData): number[] => [
  ...save.farm.plots.map((_, i) => i),
  ...save.farm.greenhouse.map((_, i) => GREENHOUSE_BASE + i),
]

/** 回答 1 回の水やり: 育てている全区画の育つ時間を 3% 縮める（1 回の作物につき合計 30% まで）。実っている・バグがいる区画はそのまま */
export function waterAll(save: SaveData, now: number): SaveData {
  if (!isFarmOpen(save)) {
    return save
  }
  let next = save
  for (const index of allIndexes(save)) {
    next = waterPlot(next, index, now, WATER_STEP) ?? next
  }

  return next
}

// ---- 収穫 ----

/** 収穫の経験値 */
const harvestXp = (crop: string, quality: number): number => 2 + Math.round(((cropOf(crop)?.minutes ?? 60) / 60) * 1.5) + quality

export type Harvest = { save: SaveData; last: FarmLast; isLevelUp: boolean }

/**
 * 収穫する。品質は ★1〜★3（60/30/10%。晴れ・農場 Lv で上がり、肥料で 1 上がることがある）、金色 2%（虹は 3 倍）。
 * 実りから 24 時間たっていたら品質 -1。流れ星の日は星のかけらを 1 つ得る
 */
export function harvest(save: SaveData, index: number, now: number): Harvest | undefined {
  const plot = plotAt(save, index)
  const view = plotView(save, index, now)
  if (plot === undefined || plot === null || view === undefined || !view.isRipe) {
    return undefined
  }
  // 温室は天気の影響を受けない
  const weather = isGreenhouseIndex(index) ? 'cloudy' : weatherAt(save, now)
  const level = farmLevel(save)
  let state = save.rng
  const draw = (): number => {
    const r = random(state)
    state = r.state
    return r.value
  }
  const shift = (weather === 'sunny' ? 0.1 : 0) + 0.01 * (level - 1) + (hasDecor(save, 'flowerbed') ? 0.03 : 0)
  const p3 = 0.1 + shift * 0.3
  const p2 = 0.3 + shift * 0.7
  const u = draw()
  let star = u < p3 ? 3 : u < p3 + p2 ? 2 : 1
  const qualityBoost = (plot.fert ? FERT_QUALITY_CHANCE : 0) + (hasPsychicNode(save, 'fortune-7') ? 0.1 : 0)
  if (draw() < qualityBoost) {
    star = Math.min(3, star + 1)
  }
  let quality = plot.golden || draw() < (GOLD_CHANCE + 0.002 * Math.max(0, level - 10)) * (weather === 'rainbow' ? 3 : 1) ? 'gold' : `q${star}`
  if (view.isOverripe && !plot.golden) {
    quality = quality === 'gold' ? 'q3' : `q${Math.max(1, star - 1)}`
  }
  // 風車: 麦が 1 つ多く取れる
  const amount = 1 + (hasDecor(save, 'windmill') && plot.crop === 'wheat' ? 1 : 0)
  const stars = weather === 'meteor' ? psychicStarReward(save, 1) : 0
  let next: SaveData = { ...setPlot(save, index, null), rng: state }
  next = addItem(next, cropItemId(plot.crop, quality), amount)
  const gained = harvestXp(plot.crop, quality === 'gold' ? 4 : star)
  const last: FarmLast = { crop: plot.crop, quality, amount, isOverripe: view.isOverripe, stars }
  next = {
    ...next,
    wallet: { ...next.wallet, stars: next.wallet.stars + stars },
    farm: {
      ...next.farm,
      xp: next.farm.xp + gained,
      harvested: next.farm.harvested.includes(plot.crop) ? next.farm.harvested : [...next.farm.harvested, plot.crop],
      last,
    },
  }

  return { save: next, last, isLevelUp: farmLevel(next) > level }
}

/** 種セット 1 つ: いま育てられる作物の種がランダムに 1 つ。育てられる作物がなければ undefined */
export function gainSeed(save: SaveData): SaveData | undefined {
  // ユニコードの花は温室で育てるので、種セットには入れない
  const options = growable(save).filter(c => c.id !== 'flower')
  if (options.length === 0) {
    return undefined
  }
  const r = random(save.rng)
  const crop = options[Math.floor(r.value * options.length)]!

  return addItem({ ...save, rng: r.state }, seedId(crop.id), 1)
}

/** 開発用チート: 育てている区画を全部実らせる */
export function growAll(save: SaveData, now: number): SaveData {
  return {
    ...save,
    farm: {
      ...save.farm,
      plots: save.farm.plots.map((p, i) => (p === null ? null : { ...p, grown: needMs(save, p, i), from: now })),
      greenhouse: save.farm.greenhouse.map((p, i) => (p === null ? null : { ...p, grown: needMs(save, p, GREENHOUSE_BASE + i), from: now })),
    },
  }
}

// ---- 台所 ----

export type Recipe = {
  id: string
  /** 材料（作物 ID → 個数。animal-egg などは大農場の産物） */
  needs: Record<string, number>
  /** 効き目。stored があれば、バフではなく持ち物 */
  buff?: { kind: BuffKind; rate: number; seconds?: number; charges?: number }
  stored?: string
  /** 最初から知っているレシピは null。ほかは、この作物をはじめて収穫すると覚える */
  learn: string | null
  /** 作れるようになる施設（それまでは表示だけ。'later' はまだ作れない） */
  requires?: FeatureId | 'later'
}

/** 料理 15 品 */
export const RECIPES: readonly Recipe[] = [
  { id: 'carrot-soup', needs: { carrot: 3 }, buff: { kind: 'exp', rate: 0.1, seconds: 1800 }, learn: null },
  { id: 'potato-fries', needs: { potato: 3 }, buff: { kind: 'power', rate: 0.08, seconds: 1800 }, learn: null },
  { id: 'tomato-pasta', needs: { tomato: 2, wheat: 1 }, buff: { kind: 'power', rate: 0.12, seconds: 2700 }, learn: null },
  { id: 'popcorn', needs: { corn: 3 }, buff: { kind: 'killSpeed', rate: 0.1, seconds: 2700 }, learn: null },
  { id: 'pumpkin-pie', needs: { pumpkin: 1, wheat: 2, 'animal-egg': 1 }, buff: { kind: 'gold', rate: 0.2, seconds: 3600 }, learn: 'pumpkin', requires: 'bigfarm' },
  { id: 'berry-jam', needs: { berry: 4 }, buff: { kind: 'luck', rate: 0.03, charges: 20 }, learn: 'berry' },
  { id: 'coffee', needs: { bean: 2, 'animal-milk': 1 }, buff: { kind: 'exp', rate: 0.25, seconds: 3600 }, learn: 'bean', requires: 'bigfarm' },
  { id: 'bread', needs: { wheat: 3 }, buff: { kind: 'bossHp', rate: 0.15, seconds: 3600 }, learn: 'wheat' },
  { id: 'lambda-tea', needs: { tea: 2, 'animal-honey': 1 }, buff: { kind: 'fortune', rate: 0.1, seconds: 3600 }, learn: 'tea', requires: 'bigfarm' },
  { id: 'curry', needs: { pepper: 2, rice: 2, potato: 1 }, buff: { kind: 'crit', rate: 0.06, seconds: 3600 }, learn: 'pepper' },
  { id: 'onigiri', needs: { rice: 2 }, stored: 'dish-onigiri', learn: 'rice' },
  { id: 'melon-parfait', needs: { melon: 1, 'animal-milk': 1, berry: 2 }, buff: { kind: 'all', rate: 0.08, seconds: 3600 }, learn: 'melon', requires: 'bigfarm' },
  { id: 'herb-porridge', needs: { herb: 3, rice: 1 }, buff: { kind: 'heal', rate: 0.3, charges: 1 }, learn: 'herb' },
  { id: 'full-course', needs: {}, learn: 'rice', requires: 'later' },
  { id: 'pet-meal', needs: { carrot: 2, corn: 1, 'animal-egg': 1 }, stored: 'pet-meal', learn: 'corn', requires: 'pet' },
]

export const recipeOf = (id: string): Recipe | undefined => RECIPES.find(r => r.id === id)

/** 覚えているレシピ（最初の 4 つ + 作物をはじめて収穫して増えた分） */
export const knownRecipes = (save: SaveData): Recipe[] => RECIPES.filter(r => r.learn === null || save.farm.harvested.includes(r.learn))

/** 材料は、作物なら品質の低いものから使う。持っている数（品質ぜんぶの合計）。作物でない材料は持ち物のその ID */
export function haveOf(save: SaveData, item: string): number {
  if (!CROP_IDS.includes(item)) {
    return save.bag[item] ?? 0
  }

  return QUALITIES.reduce((sum, q) => sum + (save.bag[cropItemId(item, q)] ?? 0), 0)
}

export type CookStatus = 'ok' | 'unknown' | 'locked' | 'short' | 'slots' | 'weaker'

/** 料理を作れるか。作れない理由を返す */
export function cookStatus(save: SaveData, id: string): CookStatus {
  const recipe = recipeOf(id)
  if (recipe === undefined || !knownRecipes(save).some(r => r.id === id)) {
    return 'unknown'
  }
  if (recipe.requires !== undefined && (recipe.requires === 'later' || !READY.has(recipe.requires) || !isUnlocked(save, recipe.requires))) {
    return 'locked'
  }
  if (Object.entries(recipe.needs).some(([item, n]) => haveOf(save, item) < n)) {
    return 'short'
  }
  if (recipe.buff !== undefined) {
    // 食べられるか試す（材料は減らさない）
    const rate = dishRate(recipe.buff.rate, ingredientRate(save, recipe))
    if (addFood(save, id, recipe.buff.kind, rate, recipe.buff) === undefined) {
      const foods = save.buffs.filter(b => b.dish !== undefined)

      return foods.some(b => b.kind === recipe.buff!.kind) ? 'weaker' : 'slots'
    }
  }

  return 'ok'
}

/** 材料を使う（品質の低いものから）。使った作物の品質の倍率の平均も返す */
function takeIngredients(save: SaveData, recipe: Recipe): { save: SaveData; rate: number } {
  let next = save
  const rates: number[] = []
  for (const [item, n] of Object.entries(recipe.needs)) {
    if (!CROP_IDS.includes(item)) {
      next = addItem(next, item, -n)
      continue
    }
    let left = n
    for (const q of QUALITIES) {
      const take = Math.min(left, next.bag[cropItemId(item, q)] ?? 0)
      if (take > 0) {
        next = addItem(next, cropItemId(item, q), -take)
        left -= take
        for (let k = 0; k < take; k += 1) {
          rates.push(QUALITY_RATE[q] ?? 1)
        }
      }
    }
  }

  return { save: next, rate: rates.length === 0 ? 1 : rates.reduce((a, b) => a + b, 0) / rates.length }
}

/** 材料の品質の倍率（作物は品質の低いものから使う） */
export function ingredientRate(save: SaveData, recipe: Recipe): number {
  const rates: number[] = []
  for (const [item, n] of Object.entries(recipe.needs)) {
    if (!CROP_IDS.includes(item)) {
      continue
    }
    let left = n
    for (const quality of QUALITIES) {
      const take = Math.min(left, save.bag[cropItemId(item, quality)] ?? 0)
      for (let i = 0; i < take; i += 1) {
        rates.push(QUALITY_RATE[quality] ?? 1)
      }
      left -= take
    }
  }

  return rates.length === 0 ? 1 : rates.reduce((a, b) => a + b, 0) / rates.length
}

/** 料理の効き目の強さ。金色の作物は設計どおり 3 倍 */
export const dishRate = (base: number, quality: number): number => Math.round(base * quality * 10_000) / 10_000

/** 料理を作る。作れないとき（材料不足・バフの枠がいっぱい・もっと強い料理が効いている・まだ作れない）は undefined */
export function cook(save: SaveData, id: string): SaveData | undefined {
  const recipe = recipeOf(id)
  if (recipe === undefined || cookStatus(save, id) !== 'ok') {
    return undefined
  }
  const taken = takeIngredients(save, recipe)
  if (recipe.stored !== undefined) {
    return addItem(taken.save, recipe.stored, 1)
  }
  const buff = recipe.buff!

  return addFood(taken.save, id, buff.kind, dishRate(buff.rate, taken.rate), buff)
}

// ---- 大農場（12 日目、docs/DAILY.md の 13 章） ----

export type Expansion = { to: number; lv: number; gold: number; wood: number; iron: number }

/** 区画の拡張 6 → 12 → 24 → 36（gold は物価 P の何倍か） */
export const EXPANSIONS: readonly Expansion[] = [
  { to: 12, lv: 5, gold: 5, wood: 30, iron: 20 },
  { to: 24, lv: 10, gold: 15, wood: 80, iron: 60 },
  { to: 36, lv: 15, gold: 40, wood: 150, iron: 120 },
]

/** 次の拡張（もう 36 区画なら undefined） */
export const nextExpansion = (save: SaveData): Expansion | undefined => EXPANSIONS.find(e => e.to > save.farm.plots.length)

const pay = (save: SaveData, gold: number, wood: number, iron: number): SaveData | undefined =>
  save.gold < gold || (save.bag.wood ?? 0) < wood || (save.bag['ore-iron'] ?? 0) < iron
    ? undefined
    : addItem(addItem({ ...save, gold: save.gold - gold }, 'wood', -wood), 'ore-iron', -iron)

/** 畑を広げる（ゴールド・木材・鉄。農場 Lv が足りないとき・足りない素材があるときは undefined） */
export function expandFarm(save: SaveData, priceP: number): SaveData | undefined {
  const next = nextExpansion(save)
  if (!isBigFarmOpen(save) || next === undefined || farmLevel(save) < next.lv) {
    return undefined
  }
  const paid = pay(save, Math.round(priceP * next.gold), next.wood, next.iron)
  if (paid === undefined) {
    return undefined
  }

  return { ...paid, farm: { ...paid.farm, plots: [...paid.farm.plots, ...Array.from({ length: next.to - paid.farm.plots.length }, () => null)] } }
}

/** 温室を建てる費用（gold は物価 P の何倍か）と、必要な農場 Lv */
export const GREENHOUSE_COST = { lv: 8, gold: 10, wood: 60, iron: 30 }

export function buildGreenhouse(save: SaveData, priceP: number): SaveData | undefined {
  if (!isBigFarmOpen(save) || save.farm.greenhouse.length > 0 || farmLevel(save) < GREENHOUSE_COST.lv) {
    return undefined
  }
  const paid = pay(save, Math.round(priceP * GREENHOUSE_COST.gold), GREENHOUSE_COST.wood, GREENHOUSE_COST.iron)
  if (paid === undefined) {
    return undefined
  }

  return { ...paid, farm: { ...paid.farm, greenhouse: Array.from({ length: GREENHOUSE_PLOTS }, () => null) } }
}

/** ユニコードの花の種（温室を建てたあと、物価 P の何倍か）。温室でだけ育つ */
export const FLOWER_SEED_PRICE = 3

export function buyFlowerSeed(save: SaveData, priceP: number): SaveData | undefined {
  const price = Math.round(priceP * FLOWER_SEED_PRICE)
  if (!isBigFarmOpen(save) || save.farm.greenhouse.length === 0 || save.gold < price) {
    return undefined
  }

  return addItem({ ...save, gold: save.gold - price }, seedId('flower'), 1)
}

// ---- スプリンクラー ----

/** スプリンクラーを取り付ける（持ち物の設計図から。畑 6 区画につき 1 台まで） */
export function installSprinkler(save: SaveData, now: number): SaveData | undefined {
  if (!isBigFarmOpen(save) || (save.bag.sprinkler ?? 0) < 1 || save.farm.sprinklers >= Math.floor(save.farm.plots.length / SPRINKLER_PLOTS)) {
    return undefined
  }
  const next = addItem(save, 'sprinkler', -1)

  return { ...next, farm: { ...next.farm, sprinklers: next.farm.sprinklers + 1, sprinkledAt: next.farm.sprinklers === 0 ? now : next.farm.sprinkledAt } }
}

/** 時間を進める役が呼ぶ: スプリンクラーが 1 時間ごとに水をまいた分（最大 24 時間ぶん）と、ペットの小屋の毎日の好感度。変わらなければ同じ save */
export function tickFarm(save: SaveData, now: number, day: string): SaveData {
  if (!isBigFarmOpen(save)) {
    return save
  }
  let next = save
  const f = save.farm
  if (f.sprinklers > 0 && f.sprinkledAt > 0 && now - f.sprinkledAt >= SPRINKLER_MS) {
    const hours = Math.min(24, Math.floor((now - f.sprinkledAt) / SPRINKLER_MS))
    const covered = Math.min(f.plots.length, f.sprinklers * SPRINKLER_PLOTS)
    for (let k = 1; k <= hours; k += 1) {
      const at = f.sprinkledAt + k * SPRINKLER_MS
      for (let index = 0; index < covered; index += 1) {
        next = waterPlot(next, index, at, WATER_STEP) ?? next
      }
    }
    // 24 時間より長く空いたときは、それより前の分は捨てて今から数え直す
    const sprinkledAt = now - f.sprinkledAt > 24 * SPRINKLER_MS ? now : f.sprinkledAt + hours * SPRINKLER_MS
    next = { ...next, farm: { ...next.farm, sprinkledAt } }
  }
  if (hasDecor(next, 'pethouse') && next.farm.petHouseDay !== day && next.pets.owned.length > 0) {
    next = {
      ...next,
      farm: { ...next.farm, petHouseDay: day },
      pets: { ...next.pets, owned: next.pets.owned.map(pet => ({ ...pet, affinity: Math.min(100, pet.affinity + 5) })) },
    }
  }

  return next
}

// ---- 飾り ----

export type DecorItem = { id: string; gold: number; wood: number }

/** 飾り 6 か所（gold は物価 P の何倍か）。かかし = 害虫 -50%、花壇 = 品質 +3%、噴水 = 成長 +3%、風車 = 麦 +1、看板 = 農場の名前、ペットの小屋 = ペットの好感度が毎日 +5 */
export const DECOR: readonly DecorItem[] = [
  { id: 'scarecrow', gold: 3, wood: 20 },
  { id: 'flowerbed', gold: 2, wood: 15 },
  { id: 'fountain', gold: 6, wood: 40 },
  { id: 'windmill', gold: 8, wood: 50 },
  { id: 'sign', gold: 1, wood: 10 },
  { id: 'pethouse', gold: 5, wood: 30 },
]

export const SIGN_NAMES = 6

export function buildDecor(save: SaveData, id: string, priceP: number): SaveData | undefined {
  const item = DECOR.find(d => d.id === id)
  if (item === undefined || !isBigFarmOpen(save) || hasDecor(save, id)) {
    return undefined
  }
  const paid = pay(save, Math.round(priceP * item.gold), item.wood, 0)

  return paid === undefined ? undefined : { ...paid, farm: { ...paid.farm, decor: [...paid.farm.decor, id] } }
}

/** 看板の名前を選ぶ（1〜6。看板を置いたあと） */
export function chooseSignName(save: SaveData, index: number): SaveData | undefined {
  if (!hasDecor(save, 'sign') || !Number.isInteger(index) || index < 1 || index > SIGN_NAMES || save.farm.signName === index) {
    return undefined
  }

  return { ...save, farm: { ...save.farm, signName: index } }
}

// ---- 家畜（牧場） ----

export type AnimalKind = { id: string; product: string; hours: number; feed: string | null; price: number }

/** 家畜 4 種（price は物価 P の何倍か）。みつばちはエサがいらない（ユニコードの花を 1 つあげると 2 倍） */
export const ANIMALS: readonly AnimalKind[] = [
  { id: 'chicken', product: 'animal-egg', hours: 2, feed: 'corn', price: 6 },
  { id: 'cow', product: 'animal-milk', hours: 4, feed: 'wheat', price: 15 },
  { id: 'sheep', product: 'animal-wool', hours: 8, feed: 'carrot', price: 30 },
  { id: 'bee', product: 'animal-honey', hours: 6, feed: null, price: 25 },
]

export const animalKind = (id: string): AnimalKind | undefined => ANIMALS.find(a => a.id === id)

/** 好感度がこれ以上だと、産物が品質★3（大きな卵・濃いミルクなど）で 2 倍の量 */
export const RICH_AFFINITY = 60
export const ANIMAL_XP = 3

export function buyAnimal(save: SaveData, id: string, priceP: number): SaveData | undefined {
  const kind = animalKind(id)
  const price = Math.round(priceP * (kind?.price ?? 0))
  if (kind === undefined || !isBigFarmOpen(save) || save.farm.animals[id] !== undefined || save.gold < price) {
    return undefined
  }
  const animal: Animal = { affinity: 0, fedAt: 0, boosted: false, patDay: '' }

  return { ...save, gold: save.gold - price, farm: { ...save.farm, animals: { ...save.farm.animals, [id]: animal } } }
}

export type AnimalStatus = { state: 'hungry' | 'working' | 'ready'; leftMs: number; isRich: boolean }

export function animalStatus(save: SaveData, id: string, now: number): AnimalStatus | undefined {
  const kind = animalKind(id)
  const animal = save.farm.animals[id]
  if (kind === undefined || animal === undefined) {
    return undefined
  }
  const isRich = animal.affinity >= RICH_AFFINITY
  if (animal.fedAt === 0) {
    return { state: 'hungry', leftMs: 0, isRich }
  }
  const left = animal.fedAt + kind.hours * HOUR - now

  return left > 0 ? { state: 'working', leftMs: left, isRich } : { state: 'ready', leftMs: 0, isRich }
}

/** その作物を、低い品質のものから 1 つ使う。無ければ undefined */
function takeCrop(save: SaveData, crop: string): SaveData | undefined {
  const quality = QUALITIES.find(q => (save.bag[cropItemId(crop, q)] ?? 0) > 0)

  return quality === undefined ? undefined : addItem(save, cropItemId(crop, quality), -1)
}

/** エサをあげる（コーン・麦・にんじん）。みつばちは boost = true なら花を 1 つあげて 2 倍。空腹でないとき・エサが無いときは undefined */
export function feedAnimal(save: SaveData, id: string, now: number, boost = false): SaveData | undefined {
  const kind = animalKind(id)
  const animal = save.farm.animals[id]
  if (kind === undefined || animal === undefined || animal.fedAt !== 0) {
    return undefined
  }
  let next: SaveData | undefined = save
  if (kind.feed !== null) {
    next = takeCrop(next, kind.feed)
  }
  let boosted = false
  if (next !== undefined && boost && kind.id === 'bee') {
    next = takeCrop(next, 'flower')
    boosted = true
  }
  if (next === undefined) {
    return undefined
  }

  return { ...next, farm: { ...next.farm, animals: { ...next.farm.animals, [id]: { ...animal, fedAt: now, boosted, affinity: Math.min(100, animal.affinity + 2) } } } }
}

/** なでる（1 日 1 匹につき 1 回、好感度 +4） */
export function patAnimal(save: SaveData, id: string, day: string): SaveData | undefined {
  const animal = save.farm.animals[id]
  if (animal === undefined || animal.patDay === day) {
    return undefined
  }

  return { ...save, farm: { ...save.farm, animals: { ...save.farm.animals, [id]: { ...animal, patDay: day, affinity: Math.min(100, animal.affinity + 4) } } } }
}

/** 産物をとる（できあがっているとき）。好感度が高いと品質★3 の 2 倍、みつばちの花で 2 倍。農場の経験値も入る */
export function collectAnimal(save: SaveData, id: string, now: number): { save: SaveData; product: string; amount: number; isRich: boolean } | undefined {
  const kind = animalKind(id)
  const animal = save.farm.animals[id]
  const status = animalStatus(save, id, now)
  if (kind === undefined || animal === undefined || status === undefined || status.state !== 'ready') {
    return undefined
  }
  const amount = (status.isRich ? 2 : 1) * (animal.boosted ? 2 : 1)
  const next = addItem(save, kind.product, amount)

  return {
    save: {
      ...next,
      farm: {
        ...next.farm,
        xp: next.farm.xp + ANIMAL_XP,
        animals: { ...next.farm.animals, [id]: { ...animal, fedAt: 0, boosted: false, affinity: Math.min(100, animal.affinity + 1) } },
      },
    },
    product: kind.product,
    amount,
    isRich: status.isRich,
  }
}

/** 採集タブの「!」: できあがった産物がある */
export const ranchReady = (save: SaveData, now: number): boolean =>
  isBigFarmOpen(save) && ANIMALS.some(kind => animalStatus(save, kind.id, now)?.state === 'ready')
