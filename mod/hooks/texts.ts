import type { Language } from '../types'
import { EN } from './lang/en'
import { JA } from './lang/ja'

// 画面に出す文言。言語ごとのファイル（lang/ja.ts・lang/en.ts）から、いまの言語のものを T に入れて使う。
// T は 1 つの入れ物で、言語を変えると中身が入れ替わる（どのファイルからも T.xxx で読めば、いまの言語になる）。

export type Texts = typeof JA

const TABLES: Record<Exclude<Language, 'auto'>, Texts> = { ja: JA, en: EN }

export const T: Texts = { ...JA }

let current: Exclude<Language, 'auto'> = 'ja'

/** Claude Code の言語設定から見つけた言語（見つからなければ日本語） */
let detected: Exclude<Language, 'auto'> = 'ja'

export const currentLanguage = (): Exclude<Language, 'auto'> => current

export const detectedLanguage = (): Exclude<Language, 'auto'> => detected

/** 設定の言語（auto なら Claude Code の言語設定）にする */
export function useLanguage(choice: Language): void {
  const next = choice === 'auto' ? detected : choice
  if (next !== current) {
    Object.assign(T, TABLES[next])
    current = next
  }
}

/**
 * Claude Code の設定の language（"japanese"、"日本語"、"English" など）から言語を決める。
 * 日本語なら ja、ほかの言語が書いてあれば en、何も無ければ ja。
 */
export function setDetectedLanguage(setting: unknown): void {
  if (typeof setting !== 'string' || setting.trim() === '') {
    detected = 'ja'
  } else {
    detected = /^(ja|jp|japan|日本)/i.test(setting.trim()) ? 'ja' : 'en'
  }
}
