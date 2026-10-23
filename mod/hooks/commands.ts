import { atom, read, update } from 'claude-code'

import type { Drop, SaveData } from '../types'
import { announce, summaryLines, withDropShare } from './actions'
import { LAMP, LEVEL, SAVE_FILES, TIME } from './config'
import { MAX_EVOLUTION, fight, stageProgress } from './battle'
import { addExp, expToNext } from './fuel'
import type { DayLog } from './sim'
import { TYPICAL, firstDay, simulate } from './sim'
import { BOSS_STAGE, CHAPTER_COUNT } from './world'
import { ROADMAP_DAYS, addItem, setPlayedDays } from './calendar'
import { enterFloor, ORES } from './mine'
import { CROPS, WEATHERS, cheatWeather, growAll, seedId } from './farm'
import { completeMissions, countReport } from './missions'
import { cheatFinishTrips } from './expedition'
import { PET_SPECIES, cheatHatch, cheatPetLevel } from './pets'
import { awardBossStars, cheatOpenBlackMarket } from './premium'
import { cheatReadyTrueBoss } from './seal'
import { RARITY_COUNT, SLOTS, itemPower, judge, rollItem } from './gear'
import type { $ } from './persist'
import { background, load, mutate, serial, store, today } from './persist'
import { SAVE_KEY, SaveFormatError, SaveTooNewError, exportText, importText, migrate, newSave } from './save'
import { T } from './texts'
import { buildLabel } from './build'
import { clearLog, formatLog, isLogging, readLog } from './debuglog'
import { isWindowsHost, playEffectWindows } from './winsound'

// スラッシュコマンドの中身: 状態の表示、書き出し / 読み込み、開発用チート、音の確認。

const problem = atom({ plugin: 'debug-legend', key: 'problem' } as const, null)

let loop: AbortController | undefined

// ---- 書き出し / 読み込み ----

async function exportFolder($: $): Promise<string> {
  const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? '.'

  return `${home.replace(/\\/g, '/')}/.claude/debug-legend/exports`
}

function stamp(now: number): string {
  const local = new Date(now - new Date(now).getTimezoneOffset() * 60 * 1000).toISOString()

  return local.slice(0, 19).replace(/[-:]/g, '').replace('T', '-')
}

/**
 * いまのセーブをファイルに書き出し、そのパスを返す。
 * 同じ秒に書き出しても上書きしないように、同じ名前があれば -2, -3 … と番号を付ける。
 */
async function writeExport($: $, save: SaveData, prefix: string): Promise<string> {
  const now = await $.clock.now()
  return writeJson($, exportText(save, now), prefix, now)
}

async function writeJson($: $, text: string, prefix: string, now: number): Promise<string> {
  const base = `${await exportFolder($)}/${prefix}-${stamp(now)}`
  for (let i = 1; i <= SAVE_FILES.maxNameTries; i += 1) {
    const path = i === 1 ? `${base}.json` : `${base}-${i}.json`
    if (!(await $.fs.exists(path))) {
      await $.fs.write(path, text)
      return path
    }
  }
  throw new Error(T.exportNoName)
}

async function newestExport($: $): Promise<string | undefined> {
  const folder = await exportFolder($)
  const entries = await $.fs.list(folder).catch(() => [])
  const newest = entries
    .filter(entry => entry.kind === 'file' && entry.name.endsWith('.json') && entry.name.startsWith('save-'))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)[0]

  return newest === undefined ? undefined : `${folder}/${newest.name}`
}

export async function runExport($: $): Promise<string> {
  const save = await serial(() => load($))
  if (save === undefined) {
    return T.paused((await read($, problem)) ?? '')
  }
  const path = await writeExport($, save, 'save')
  const copied = await $.ui.copy({ text: exportText(save, await $.clock.now()) }).catch(() => ({ isCopied: false }))

  return T.exported(path, copied.isCopied)
}

export async function runImport($: $, args: string): Promise<string> {
  const arg = args.trim().replace(/^["']|["']$/g, '')
  let text: string
  if (arg.startsWith('{')) {
    text = arg
  } else {
    const path = arg === '' ? await newestExport($) : arg
    if (path === undefined) {
      return T.importNothing(await exportFolder($))
    }
    try {
      // 大きすぎるファイルは中身を読まずに断る
      const { size } = await $.fs.stat(path)
      if (size > SAVE_FILES.importMaxBytes) {
        return T.importFailed(T.saveError.tooLarge(SAVE_FILES.importMaxBytes))
      }
      text = await $.fs.read(path)
    } catch (error) {
      return T.importFailed(error instanceof Error ? error.message : String(error))
    }
  }

  return serial(async () => {
    let incoming: SaveData
    try {
      incoming = importText(text, await $.clock.now())
    } catch (error) {
      return T.importFailed(error instanceof Error ? error.message : String(error))
    }
    // 読み込む前のセーブを残しておく（読めないセーブでも、生のまま残す）
    const before = await $.store.get(SAVE_KEY)
    let old: SaveData | undefined
    let backup: string
    try {
      old = migrateOrNew(before, incoming.lastTickAt)
      backup = old === undefined
        ? await writeJson($, JSON.stringify(before, null, 2), 'before-import-raw', await $.clock.now())
        : await writeExport($, old, 'before-import')
    } catch (error) {
      return T.importFailed(error instanceof Error ? error.message : String(error))
    }
    // 書いた変更の印は前のセーブから引き継ぐ（読み込んだセーブに、消されたと思った変更を入れ直さないように）
    // 担当の印（clock）と作業中の印（busy）はほかの端末・セッションのものなので持ち込まない
    await store($, { ...incoming, lastTickAt: await $.clock.now(), applied: old?.applied ?? [], clock: null, busy: [] })
    await update($, problem, () => null)

    return T.imported(backup)
  })
}

function migrateOrNew(stored: unknown, now: number): SaveData | undefined {
  try {
    return migrate(stored, now)
  } catch (error) {
    if (error instanceof SaveTooNewError || error instanceof SaveFormatError) return undefined
    throw error
  }
}

// ---- 開発用チート ----

/** 開発用チート。使えるかどうか（DEV_CHEATS / DEBUG_LEGEND_DEV）は register.tsx で決める */
export async function runCheat($: $, args: string): Promise<string> {
  // 何行かまとめて貼ったときは、1 行ずつ順に動かす（行の頭の /dl-cheat は取る）
  const lines = args.split(/\r?\n/).map(line => line.trim().replace(/^\/dl-cheat\s*/, '')).filter(line => line !== '')
  if (lines.length > 1) {
    const results: string[] = []
    for (const line of lines) {
      results.push(await runCheat($, line))
    }
    return results.join('\n')
  }
  const [head = '', value = ''] = args.trim().split(/\s+/)
  const n = Number(value)
  if (head === 'max' && args.trim() === 'max') {
    return cheatMax($)
  }
  if (head === 'stars') {
    if (value === '' || !Number.isInteger(n) || n < 0 || n > 100_000) return T.cheatHelp
    await mutate($, save => ({ ...save, wallet: { ...save.wallet, stars: save.wallet.stars + n } }))
    return T.cheatStars(n)
  }
  if (head === 'psi') {
    if (value === '' || !Number.isInteger(n) || n < 0 || n > 100_000) return T.cheatHelp
    await mutate($, save => ({ ...save, wallet: { ...save.wallet, psi: save.wallet.psi + n } }))
    return T.cheatPsi(n)
  }
  if (head === 'night' && args.trim() === 'night') {
    await mutate($, (save, now) => cheatOpenBlackMarket(save, now))
    return T.cheatNight
  }
  if (head === 'grow' && args.trim() === 'grow') {
    await mutate($, (save, now) => growAll(save, now))
    return T.cheatGrow
  }
  if (head === 'weather') {
    const input = value.toLocaleLowerCase()
    const weather = WEATHERS.find(id => id === input || T.farmWeatherName[id]?.toLocaleLowerCase() === input)
    if (weather === undefined) {
      return T.cheatHelp
    }
    await mutate($, (save, _now, day) => cheatWeather(save, day, weather) ?? save)
    return T.cheatWeatherResult(T.farmWeatherName[weather] ?? weather)
  }
  if (head === 'seed') {
    const parts = args.trim().split(/\s+/)
    const amount = Number(parts[parts.length - 1])
    const label = parts.slice(1, -1).join(' ').toLocaleLowerCase()
    const crop = CROPS.find(item => item.id === label || T.farmCropName[item.id]?.toLocaleLowerCase() === label)
    if (crop === undefined || !Number.isInteger(amount) || amount < 1 || amount > 9_999) {
      return T.cheatHelp
    }
    await mutate($, save => addItem(save, seedId(crop.id), amount))
    return T.cheatSeed(T.farmCropName[crop.id] ?? crop.id, amount)
  }
  if (head === 'ff' && n > 0) {
    // 閉じていた扱いにはしない（お知らせは出さない）
    await mutate($, (save, now, day) => {
      const fought = fight(save, n * 60 * TIME.battleSpeed, now)
      // 倒した数も数える（日課・週課・実績の確認用）
      const rewarded = awardBossStars(fought.save, fought.report.bossWins)
      return { ...countReport(rewarded, fought.report, day), lastTickAt: now }
    })
    return T.cheatFf(n)
  }
  if (head === 'stage') {
    const [, ch = '', st = ''] = args.trim().split(/\s+/)
    const chapter = Number(ch)
    const stage = Number(st || '1')
    if (!(Number.isInteger(chapter) && chapter >= 1 && chapter <= CHAPTER_COUNT && Number.isInteger(stage) && stage >= 1 && stage <= BOSS_STAGE)) {
      return T.cheatHelp
    }
    await mutate($, s => ({ ...s, stage: { chapter, stage, kills: 0, bossTime: 0 }, boss: { retryAt: null, last: s.boss.last }, isCleared: false }))
    return T.cheatStage(chapter, stage)
  }
  if (head === 'away' && n > 0) {
    // n 分閉じていたことにする（オフライン報酬のお知らせの確認用）
    await mutate($, (save, now) => ({ ...save, lastTickAt: now - n * 60 * 1000 }))
    return T.cheatAway(n)
  }
  if (head === 'sim') {
    const lines = (['backend-knight', 'frontend-mage', 'infra-sniper'] as const).map(job => {
      const logs = simulate({ ...TYPICAL, job }, 45)
      const day30 = logs[29]
      const day = (test: (log: DayLog) => boolean): string => String(firstDay(logs, test) ?? '—')
      return [
        T.simLine(T.jobName[job], firstDay(logs, l => l.level >= 20), firstDay(logs, l => l.isCleared), day30?.level ?? 0, day30?.chapter ?? 0),
        T.simEvolution(T.jobName[job], day(l => l.job !== 'novice'), day(l => l.evolution >= 1), day(l => l.evolution >= 2), day(l => l.evolution >= 3)),
      ].join('\n')
    })
    return [T.simHeader(TYPICAL.workingHours, TYPICAL.idleHours, TYPICAL.turns), ...lines].join('\n')
  }
  if (head === 'drops' && Number.isInteger(n) && n > 0) {
    const save = await mutate($, s => ({ ...s, lamps: Math.min(LAMP.stockCap, s.lamps + n) }))
    return T.cheatDrops(n, save?.lamps ?? 0)
  }
  if (head === 'evo' && Number.isInteger(n) && n >= 0 && n <= MAX_EVOLUTION) {
    await mutate($, s => ({ ...s, evolution: n }))
    return T.cheatEvo(n)
  }
  if (head === 'lv' && Number.isInteger(n) && n >= 1) {
    await mutate($, s => addExp({ ...s, level: n, exp: 0 }, 0))
    return T.cheatLv(n)
  }
  if (head === 'item' && Number.isInteger(n) && n >= 0 && n < RARITY_COUNT) {
    // 指定したレア度の装備を 1 つ出す（光の柱やトーストの確認用。ランプは減らない）
    let drops: Drop[] = []
    await mutate($, (save, now) => {
      drops = []
      if (save.pending !== null) {
        return save
      }
      const rolled = rollItem(save)
      const item = { ...rolled.item, rarity: n, power: itemPower(rolled.item.slot, save.level, n, 0.5) }
      const judged = judge(rolled.save, item, now)
      drops = [judged.drop]
      return withDropShare(judged.save, drops, now)
    })
    const after = await serial(() => load($))
    if (after !== undefined) {
      announce($, drops, after.settings)
    }
    return drops.length > 0 ? T.cheatItem(T.rarity[n] ?? '') : T.lampBlocked
  }
  if (head === 'day' && /^\+?\d+$/.test(value)) {
    // 遊んだ日数を決める（+N で N 日進める）。スタンプは押さない
    const save = await mutate($, s => setPlayedDays(s, value.startsWith('+') ? s.calendar.playedDays + n : n))
    return T.cheatDay(save?.calendar.playedDays ?? 0)
  }
  if (head === 'missions' && (value === 'done' || value === 'week')) {
    // 今日の日課（week なら今週の週課）を達成済みにする。受け取りはボタンから
    await mutate($, (save, _now, day) => completeMissions(save, day, value === 'week' ? 'weekly' : 'daily'))
    return T.cheatMissions(value === 'week' ? 'weekly' : 'daily')
  }
  if (head === 'egg') {
    const input = value.toLocaleLowerCase()
    const species = PET_SPECIES.find(id => id === input || T.petSpeciesName[id]?.toLocaleLowerCase() === input)
    if (species === undefined) return T.cheatHelp
    await mutate($, save => cheatHatch(save, species))
    return T.cheatEgg(T.petSpeciesName[species] ?? species)
  }
  if (head === 'petlv' && Number.isInteger(n) && n >= 1 && n <= 60) {
    const save = await mutate($, current => cheatPetLevel(current, n))
    return save?.pets.owned.length ? T.cheatPetLevel(n) : T.cheatHelp
  }
  if (head === 'trip' && value === 'done') {
    await mutate($, (save, now) => cheatFinishTrips(save, now))
    return T.cheatTripDone
  }
  if (head === 'pick' && Number.isInteger(n) && n > 0) {
    // つるはしを n 回足す（鉱山の確認用）
    const save = await mutate($, s => addItem(s, 'pick', n))
    return T.cheatPick(n, save?.bag.pick ?? 0)
  }
  if (head === 'ore') {
    const parts = args.trim().split(/\s+/)
    const id = parts[1] ?? ''
    const amount = Number(parts[2])
    if (!(ORES as readonly string[]).includes(id) && !/^ore-boss-[1-5]$/.test(id) && !['ore-gold', 'ore-silver', 'wood'].includes(id)) return T.cheatHelp
    if (!Number.isInteger(amount) || amount < 1 || amount > 9_999) return T.cheatHelp
    const save = await mutate($, current => addItem(current, id, amount))
    return T.cheatOre(T.bagItem[id] ?? id, amount, save?.bag[id] ?? 0)
  }
  if (head === 'gm' && value === 'full') {
    // 金山・銀山のトロッコを満杯にする（回収から 48 時間たったことにする）
    await mutate($, (save, now) => ({ ...save, goldMine: { ...save.goldMine, collectedAt: now - 48 * 3_600_000, collectWork: save.goldMine.workMs, workAt: now, workSpans: [], spansFrom: now, settledAt: now - 48 * 3_600_000, settledGold: [], settledSilver: [] } }))
    return T.cheatGoldMine
  }
  if (head === 'plus') {
    const parts = args.trim().split(/\s+/)
    const slotText = parts[1] ?? ''
    const plus = Number(parts[2])
    const slot = SLOTS.find(candidate => candidate === slotText || T.slot[candidate] === slotText)
    if (slot === undefined || !Number.isInteger(plus) || plus < 0 || plus > 15) return T.cheatHelp
    let changed = false
    await mutate($, save => {
      const item = save.equipment[slot]
      if (item === null) return save
      changed = true
      return { ...save, equipment: { ...save.equipment, [slot]: { ...item, plus } } }
    })
    return changed ? T.cheatPlus(T.slot[slot], plus) : T.cheatPlusMissing(T.slot[slot])
  }
  if (head === 'floor' && Number.isInteger(n) && n >= 1) {
    // 地下 n 階に移る（新しいマス）
    await mutate($, s => enterFloor(s, n))
    return T.cheatFloor(n)
  }
  if (head === 'unlock' && value === 'all') {
    const save = await mutate($, s => setPlayedDays(s, Math.max(s.calendar.playedDays, ROADMAP_DAYS)))
    return T.cheatDay(save?.calendar.playedDays ?? 0)
  }
  if (head === 'soul' && value === 'all') {
    // 10 体の魂をすべて手に入れる（台座に捧げるのは自分で）
    await mutate($, s => ({ ...s, souls: Array.from({ length: CHAPTER_COUNT }, (_, i) => i + 1) }))
    return T.cheatSoul
  }
  if (head === 'trueboss' && args.trim() === 'trueboss') {
    // 魂を捧げ終え、本編もクリア済みにして、いますぐ真のラスボスに挑める状態にする
    await mutate($, s => cheatReadyTrueBoss(s))
    return T.cheatTrueBoss
  }
  if (head === 'reset') {
    return serial(async () => {
      const now = await $.clock.now()
      const old = migrateOrNew(await $.store.get(SAVE_KEY), now) ?? newSave(now)
      const backup = await writeExport($, old, 'before-reset')
      // 書いた変更の印は引き継ぐ（作り直したセーブに、前の変更を入れ直さないように）
      await store($, { ...newSave(now), applied: old.applied })
      await update($, problem, () => null)
      return T.cheatReset(backup)
    })
  }

  return T.cheatHelp
}

/** 開発用: 全部を最強にする（テスト用。ほかのチートを順に動かし、最後に全部の枠へ最高レア度・+15 の装備を付ける） */
async function cheatMax($: $): Promise<string> {
  const owned = (await serial(() => load($)))?.pets.owned.map(pet => pet.species) ?? []
  const steps = [
    'unlock all',
    `lv ${LEVEL.max}`,
    `evo ${MAX_EVOLUTION}`,
    `stage ${CHAPTER_COUNT}`,
    'stars 100000',
    'psi 100000',
    `drops ${LAMP.stockCap}`,
    'pick 9999',
    ...[...ORES, 'ore-gold', 'ore-silver', 'wood', ...Array.from({ length: 5 }, (_, i) => `ore-boss-${i + 1}`)].map(id => `ore ${id} 9999`),
    ...CROPS.map(crop => `seed ${crop.id} 9999`),
    'gm full',
    'grow',
    // 持っていない種類から 2 匹まで（同じ種類は孵さない）
    ...PET_SPECIES.filter(species => !owned.includes(species)).map(species => `egg ${species}`),
    'missions done',
    'missions week',
    'trip done',
    'night',
    'soul all',
    'trueboss',
  ]
  for (const step of steps) {
    await runCheat($, step)
  }
  await mutate($, save => {
    let next = save
    const equipment = { ...save.equipment }
    for (const slot of SLOTS) {
      const rolled = rollItem(next)
      next = rolled.save
      const rarity = RARITY_COUNT - 1
      equipment[slot] = { ...rolled.item, slot, rarity, power: itemPower(slot, next.level, rarity, 1), plus: 15 }
    }
    // ペットは 2 匹とも Lv.60（第 3 形態）
    const owned = next.pets.owned.map(pet => ({ ...pet, level: 60, exp: 0, form: 3 as const, affinity: 100 }))
    return { ...next, equipment, pets: { ...next.pets, owned } }
  })

  return T.cheatMax
}

// ---- 音の確認（M1 の実機確認用。M4 で本物の BGM / 効果音に置き換える） ----

async function logSound($: $, entry: Record<string, unknown>): Promise<void> {
  const list = (await $.store.get('soundLog')) as unknown[] | undefined
  await $.store.set('soundLog', [...(Array.isArray(list) ? list : []), entry].slice(-20))
}

function playAndLog($: $, kind: string, play: () => Promise<void>): void {
  background(
    (async () => {
      const startedAt = await $.clock.now()
      const surfaces = await $.session.surfaces()
      let result = 'resolved'
      try {
        await play()
      } catch (error) {
        result = `rejected: ${error instanceof Error ? error.message : String(error)}`
      }
      const ms = (await $.clock.now()) - startedAt
      await logSound($, { at: startedAt, kind, surfaces, result, ms })
      $.ui.toast(T.soundResult(kind, result, ms))
    })(),
  )
}

export async function runSound($: $, args: string): Promise<string> {
  const kind = args.trim() || 'once'
  if (kind === 'once') {
    playAndLog($, kind, () => $.audio.play({ asset: 'sounds/test-beep.wav' }))
  } else if (kind === 'b64') {
    const { base64 } = await $.fs.read(`${$.plugin.root}/sounds/test-beep.wav`, { as: 'bytes' })
    playAndLog($, kind, () => $.audio.play({ base64, mime: 'audio/wav' }))
  } else if (kind === 'loop') {
    loop?.abort()
    const controller = new AbortController()
    loop = controller
    playAndLog($, kind, () => $.audio.play({ asset: 'sounds/test-loop.wav' }, { shouldLoop: true, signal: controller.signal, gain: 0.6 }))
    // 止め忘れても 30 秒で止まる
    $.clock.after(30_000, () => controller.abort())
  } else if (kind === 'win') {
    // Windows の PowerShell で 1 回鳴らす（設定がオフでも試せる。Windows のときだけ）
    if (!isWindowsHost()) {
      return T.soundWinOnly
    }
    playAndLog($, kind, () => playEffectWindows($, 'se-levelup', 0.8))
  } else if (kind === 'stop') {
    if (loop === undefined || loop.signal.aborted) {
      return T.soundNothing
    }
    loop.abort()
    loop = undefined
    return T.soundStopped
  } else {
    return T.soundHelp
  }

  return T.soundStart(kind)
}

/** /dl-debuglog: 実機の記録を見る（on / off で記録の切り替え、clear で消す）。全部をファイルにも書き出す */
export async function runDebugLog($: $, args: string): Promise<string> {
  const arg = args.trim()
  if (arg === 'on' || arg === 'off') {
    await mutate($, save => ({ ...save, settings: { ...save.settings, debugLog: arg === 'on' } }))
    return arg === 'on' ? T.debugLogOn : T.debugLogOff
  }
  if (arg === 'clear') {
    await clearLog($)
    return T.debugLogCleared
  }
  const list = await readLog($)
  if (list.length === 0) {
    return isLogging() ? T.debugLogEmpty : T.debugLogOff
  }
  const now = await $.clock.now()
  const path = `${await exportFolder($)}/debuglog-${stamp(now)}.txt`
  await $.fs.write(path, `${T.debugLogHeader(buildLabel())}\n${formatLog(list)}\n`)

  return `${T.debugLogShown(Math.min(60, list.length), list.length, path)}\n${formatLog(list.slice(-60))}`
}

export async function runSummary($: $): Promise<string> {
  const save = await serial(() => load($))
  if (save === undefined) {
    return T.paused((await read($, problem)) ?? '')
  }
  const percent = Math.floor(stageProgress(save) * 100)

  return summaryLines(save, await today($), expToNext(save.level), percent).join('\n')
}
