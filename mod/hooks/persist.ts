import { atom, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { SaveData } from '../types'
import { dayKey } from './fuel'
import { combatPower } from './gear'
import { APPLIED_LIMIT, SAVE_KEY, SaveFormatError, SaveTooNewError, checkSaveSize, migrate } from './save'
import { T, useLanguage } from './texts'
import { note, setLogging } from './debuglog'
import { advanceShared } from './lease'

// セーブの読み書き（$.store）と、描画用の写し（$.state）。

export type $ = EngineInterface

// $.state の参照は、使うファイルごとに書く（validate が読めるように、そのファイルの const であること）
const saveView = atom({ plugin: 'debug-legend', key: 'save' } as const, null)
const problem = atom({ plugin: 'debug-legend', key: 'problem' } as const, null)

/** セーブの読み書きを 1 つずつ順番に行う（同じセッション内で書き込みが重ならないように） */
let queue: Promise<unknown> = Promise.resolve()
export function serial<T>(work: () => Promise<T>): Promise<T> {
  const run = queue.then(work, work)
  queue = run.catch(() => undefined)

  return run
}

export const background = (work: Promise<unknown>): void => {
  work.catch(() => undefined)
}

export async function today($: $): Promise<string> {
  const now = await $.clock.now()

  return dayKey(now, new Date(now).getTimezoneOffset())
}

/** 画面（帯・サイド画面・ステータスライン）にセーブを映す */
export async function show($: $, save: SaveData): Promise<void> {
  useLanguage(save.settings.language)
  setLogging(save.settings.debugLog)
  await update($, saveView, () => save)
  $.ui.status(T.status(save.level, combatPower(save)))
}

/** セーブを読む。読めないときは理由を画面に出して undefined */
export async function load($: $): Promise<SaveData | undefined> {
  const now = await $.clock.now()
  try {
    const save = migrate(await $.store.get(SAVE_KEY), now)
    await update($, problem, () => null)

    return save
  } catch (error) {
    if (error instanceof SaveTooNewError || error instanceof SaveFormatError) {
      await update($, problem, () => error.message)
      $.ui.status(T.paused(error.message))

      return undefined
    }
    throw error
  }
}

/**
 * セーブを書いて、画面に映す。画面には、書いたセーブを「いま」まで進めた様子を出す
 * （時間を進める役がほかのセッションのとき、書いた時点から少したっていても、戦闘画面が戻らないように）
 */
export async function store($: $, save: SaveData): Promise<void> {
  try {
    checkSaveSize(save)
    await $.store.set(SAVE_KEY, save)
  } catch (error) {
    // 一度も保存できなかった操作は、次の操作で勝手に入れ直さない。
    watched = watched.filter(entry => entry.isWritten || !save.applied.includes(entry.id))
    throw error
  }
  watched = watched.map(entry => save.applied.includes(entry.id) ? { ...entry, isWritten: true } : entry)
  await show($, advanceShared(save, await $.clock.now()).save)
}

// ---- 違うプロセスが同時に書いたときの取りこぼし ----
// $.store には「比べてから書く」が無いので、ほかのプロセス（セッション）が、このセッションが書く少し前に読んだセーブから
// 作ったものを、書いた直後に書くと、このセッションの変更（ランプ・装備・設定など）が消える。
// そこで、変更ごとに印を付けてセーブ（applied）に残し、変更そのもの（関数）もしばらく覚えておく。
// 次に書く前に読んだセーブに自分の印が無ければ、消されたので、そのセーブに同じ変更をもう一度かけて書く（同じ印のまま）。
// 時間の進み方は、もとから「前回の時刻からの差」で数え直すので、ここでは扱わない（hooks/lease.ts）。

export type Change = (save: SaveData, now: number, day: string) => SaveData

/** 書いてからこれだけたって、まだ印が残っていれば、もう消されない（ほかのプロセスの読む → 書くは数ミリ秒） */
export const CONFIRM_MS = 3_000
/** 覚えておく変更の数 */
const WATCH_LIMIT = 32

/** このプロセスの名前（印の頭。読み込みごとに変わる部分も付けて、ホットリロードの前の印と重ならないように） */
let writer = 'local'
const loadMark = Math.random().toString(36).slice(2, 8)
let counter = 0
/** 書いたが、まだ消されないと決まっていない変更 */
let watched: { id: string; change: Change; wroteAt: number; isWritten: boolean }[] = []

/** 印に使う、このセッションの名前 */
export function setWriter(name: string): void {
  writer = name.slice(0, 40)
}

const stamp = (save: SaveData, id: string): SaveData => ({ ...save, applied: [...save.applied.filter(other => other !== id), id].slice(-APPLIED_LIMIT) })

/**
 * 読んだセーブに、このセッションの変更が消されずに残っているか確かめ、消されていたら入れ直す。
 * 入れ直したセーブ（何も消されていなければ、読んだセーブそのもの）を返す。返したセーブは必ず書くこと。
 */
export function restoreLost(save: SaveData, now: number, day: string): SaveData {
  let next = save
  const keep: typeof watched = []
  for (const entry of watched) {
    if (save.applied.includes(entry.id)) {
      if (now - entry.wroteAt < CONFIRM_MS) {
        keep.push(entry)
      }
      continue
    }
    next = stamp(entry.change(next, now, day), entry.id)
    keep.push({ ...entry, wroteAt: now })
    note(now, 'lost', `ほかのセッションの書き込みで消えた変更を入れ直した（${entry.id}）`)
  }
  watched = keep

  return next
}

/** 変更をかけて印を付け、消されないか見張る。返したセーブは必ず書くこと */
export function track(save: SaveData, change: Change, now: number, day: string): SaveData {
  const changed = change(save, now, day)
  // 断った操作や、途中で例外になった操作は、あとから勝手にやり直さない。
  if (changed === save) {
    return save
  }
  counter += 1
  const id = `${writer}:${loadMark}:${counter}`
  watched = [...watched, { id, change, wroteAt: now, isWritten: false }].slice(-WATCH_LIMIT)

  return stamp(changed, id)
}

/** セーブを読み、変えて、書く。読めないセーブには何もしない（ほかのプロセスに消された変更があれば、いっしょに入れ直す） */
export function mutate($: $, change: Change): Promise<SaveData | undefined> {
  return serial(async () => {
    const save = await load($)
    if (save === undefined) {
      return undefined
    }
    const now = await $.clock.now()
    const day = dayKey(now, new Date(now).getTimezoneOffset())
    const changed = track(restoreLost(save, now, day), change, now, day)
    await store($, changed)

    return changed
  })
}
