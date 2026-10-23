import type { SaveData } from '../types'
import { LEVEL } from './config'

// レベルと経験値。

/** Lv n → n+1 に必要な経験値 */
export function expToNext(level: number): number {
  return Math.round(LEVEL.expBase * Math.pow(level, LEVEL.expExponent))
}

/** 経験値を足してレベルを上げる */
export function addExp(save: SaveData, exp: number): SaveData {
  let level = save.level
  let total = save.exp + exp
  while (level < LEVEL.max && total >= expToNext(level)) {
    total -= expToNext(level)
    level += 1
  }
  if (level >= LEVEL.max) {
    total = 0
  }

  const psi = Math.floor(level / 10) - Math.floor(save.level / 10)

  return { ...save, level, exp: total, ...(psi > 0 ? { wallet: { ...save.wallet, psi: save.wallet.psi + psi } } : {}) }
}
