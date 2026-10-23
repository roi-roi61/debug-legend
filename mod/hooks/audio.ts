import { atom, read } from 'claude-code'

import type { Settings } from '../types'
import type { $ } from './persist'
import { background } from './persist'
import { setBgmWindows, playEffectWindows, stopBgmWindows, useWindowsSound } from './winsound'
import type { BgmTrack } from './music'
import { BGM_ASSETS, CROSSFADE_MS, trackFor } from './music'

// BGM と効果音。音はサイド画面が表示されている間だけ（画面の外は控えめに）。
// $.audio.play は鳴らせない環境（Windows のターミナル・デスクトップアプリなど）ではすぐ終わるか失敗するので、
// 失敗は黙って無視する（何もしない）。

const saveView = atom({ plugin: 'debug-legend', key: 'save' } as const, null)
const tab = atom({ plugin: 'debug-legend', key: 'tab' } as const, 'battle')


export type Effect =
  | 'attack'
  | 'crit'
  | 'hit'
  | 'defeat'
  | 'lamp'
  | 'drop-common'
  | 'drop-rare'
  | 'drop-epic'
  | 'levelup'
  | 'jobchange'
  | 'boss-appear'
  | 'victory'


const PANE_ID = 'debug-legend'

const bgmGain = (settings: Settings): number => (settings.isMuted ? 0 : settings.bgmVolume / 10)
const seGain = (settings: Settings): number => (settings.isMuted ? 0 : settings.seVolume / 10)

/** いま流している BGM（モジュールを読み直すと止まる） */
let playing: { track: BgmTrack; gain: number; controller: AbortController } | undefined

export function stopBgm(): void {
  playing?.controller.abort()
  playing = undefined
  stopBgmWindows()
}

/** サイド画面が表示されているか */
export async function isPaneShown($: $): Promise<boolean> {
  const panes = await $.ui.panes().catch(() => [])

  return panes.some(pane => pane.id === PANE_ID && pane.isShown && pane.isPlaced)
}

/** 流す BGM を切り替える（null で止める）。同じ曲・同じ音量なら何もしない */
export function setBgm($: $, track: BgmTrack | null, settings: Settings): void {
  const gain = bgmGain(settings)
  if (track === null || gain === 0) {
    stopBgm()
    return
  }
  // Windows で「Windows で音を鳴らす」がオンなら PowerShell で（winsound.ts）
  if (useWindowsSound(settings.windowsSound)) {
    playing?.controller.abort()
    playing = undefined
    background(setBgmWindows($, track, gain))
    return
  }
  stopBgmWindows()
  if (playing !== undefined && playing.track === track && playing.gain === gain) {
    return
  }
  // 新しい曲を先に鳴らし始めて、少し重ねてから前の曲を止める（短いクロスフェード）
  const previous = playing
  if (previous !== undefined) {
    $.clock.after(CROSSFADE_MS, () => previous.controller.abort())
  }
  const controller = new AbortController()
  playing = { track, gain, controller }
  background($.audio.play({ asset: BGM_ASSETS[track] }, { shouldLoop: true, signal: controller.signal, gain }))
}

/** サイド画面・タブ・ステージに合わせて BGM を合わせる（タイマーと、画面を開いた・タブを変えたときに呼ぶ） */
export async function syncBgm($: $): Promise<void> {
  const save = await read($, saveView)
  if (save === null) {
    return
  }
  if (!(await isPaneShown($))) {
    setBgm($, null, save.settings)
    return
  }
  const current = await read($, tab)
  setBgm($, trackFor({ chapter: save.stage.chapter, stage: save.stage.stage, isCleared: save.isCleared, tab: current }), save.settings)
}

/** 効果音を 1 回鳴らす（サイド画面が表示されているときだけ） */
export async function playEffect($: $, effect: Effect, settings: Settings): Promise<void> {
  const gain = seGain(settings)
  if (gain === 0 || !(await isPaneShown($))) {
    return
  }
  if (useWindowsSound(settings.windowsSound)) {
    background(playEffectWindows($, `se-${effect}`, gain))
    return
  }
  background($.audio.play({ asset: `sounds/se-${effect}.mp3` }, { gain }))
}

/** ドロップのレア度に合った効果音 */
export const dropEffect = (rarity: number): Effect => (rarity >= 3 ? 'drop-epic' : rarity >= 2 ? 'drop-rare' : 'drop-common')
