import type { Tab } from '../types'
import { BGM_LENGTH_MS } from './music.generated'
import { BOSS_STAGE, CHAPTER_COUNT } from './world'

// どの場面でどの曲を流すか。曲は固定の一覧（BGM_ASSETS）からだけ選ぶ（外から来た値をファイル名に入れない）。
// - 戦闘タブ: 章ごとの曲（bgm-ch1 〜 bgm-ch10）。ボス戦は共通のボス曲、第 10 章のボスだけラスボス曲
// - ほかのタブ: メニューの曲

export const BGM_TRACKS = [
  'bgm-ch1',
  'bgm-ch2',
  'bgm-ch3',
  'bgm-ch4',
  'bgm-ch5',
  'bgm-ch6',
  'bgm-ch7',
  'bgm-ch8',
  'bgm-ch9',
  'bgm-ch10',
  'bgm-boss',
  'bgm-boss-final',
  'bgm-menu',
] as const

export type BgmTrack = (typeof BGM_TRACKS)[number]

/** 曲のファイル（mod の中の場所）。この表にあるものしか鳴らさない */
export const BGM_ASSETS: Record<BgmTrack, string> = {
  'bgm-ch1': 'sounds/bgm-ch1.mp3',
  'bgm-ch2': 'sounds/bgm-ch2.mp3',
  'bgm-ch3': 'sounds/bgm-ch3.mp3',
  'bgm-ch4': 'sounds/bgm-ch4.mp3',
  'bgm-ch5': 'sounds/bgm-ch5.mp3',
  'bgm-ch6': 'sounds/bgm-ch6.mp3',
  'bgm-ch7': 'sounds/bgm-ch7.mp3',
  'bgm-ch8': 'sounds/bgm-ch8.mp3',
  'bgm-ch9': 'sounds/bgm-ch9.mp3',
  'bgm-ch10': 'sounds/bgm-ch10.mp3',
  'bgm-boss': 'sounds/bgm-boss.mp3',
  'bgm-boss-final': 'sounds/bgm-boss-final.mp3',
  'bgm-menu': 'sounds/bgm-menu.mp3',
}

/** 曲 1 周の長さ（ミリ秒）。mod/dev/make_sounds.py が作った music.generated.ts から */
export const bgmLength = (track: BgmTrack): number => BGM_LENGTH_MS[track]

/** 曲を切り替えるときに、前の曲と次の曲を重ねる時間（ミリ秒）。短いクロスフェードのかわり */
export const CROSSFADE_MS = 600

/** 章の曲（章の数字は 1〜10 に収める） */
export function chapterTrack(chapter: number): BgmTrack {
  const n = Math.min(CHAPTER_COUNT, Math.max(1, Math.floor(chapter)))

  return BGM_TRACKS[n - 1] ?? 'bgm-ch1'
}

export type MusicScene = { chapter: number; stage: number; isCleared: boolean; tab: Tab }

/** いまの場面で流す曲 */
export function trackFor(scene: MusicScene): BgmTrack {
  if (scene.tab !== 'battle') {
    return 'bgm-menu'
  }
  const isBoss = scene.stage >= BOSS_STAGE && !scene.isCleared
  if (isBoss) {
    return scene.chapter >= CHAPTER_COUNT ? 'bgm-boss-final' : 'bgm-boss'
  }

  return chapterTrack(scene.chapter)
}
