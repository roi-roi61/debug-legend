import type { Buff, BuffKind, SaveData } from '../types'

// 時間で切れるバフ（商店の薬・あとで料理）。$ を使わない純粋な関数。
// 時間は戦闘の秒数（battleSeconds）で数える（作業中は 3 倍速で減る。閉じていた間も、オフラインの分だけ減る）。
// 宝箱のレア度の薬は、時間ではなく回数（charges）で減る。

export const BUFF_KINDS: readonly BuffKind[] = ['power', 'exp', 'gold', 'midas', 'luck', 'killSpeed', 'bossHp', 'crit', 'fortune', 'all', 'heal']

/** 料理のバフが同時に効ける数（違う種類どうし。薬とは別に数える） */
export const FOOD_SLOTS = 2

/** 料理のバフか */
export const isFood = (buff: Buff): boolean => buff.dish !== undefined

/** 同じ種類の薬を重ねたときの時間の上限（戦闘の秒数） */
export const BUFF_MAX_SECONDS = 3 * 60 * 60
/** 回数で減る薬の回数の上限 */
export const BUFF_MAX_CHARGES = 120

/** いま効いているか */
export const isActive = (save: SaveData, buff: Buff): boolean =>
  buff.charges !== undefined ? buff.charges > 0 : (buff.until ?? 0) > save.battleSeconds

const best = (save: SaveData, kinds: readonly BuffKind[], food: boolean): number =>
  save.buffs.filter(buff => kinds.includes(buff.kind) && isFood(buff) === food && isActive(save, buff)).reduce((top, buff) => Math.max(top, buff.rate), 0)

/**
 * いま効いているその種類の強さ（0 = 効いていない）。薬の一番強いものと、料理の一番強いものを足す。
 * 料理の「全部」(all) は攻撃・経験値・ゴールドに、「幸運」(fortune) は宝箱のレア度アップ(luck)にも効く
 */
export function buffRate(save: SaveData, kind: BuffKind): number {
  const extra: BuffKind[] = kind === 'power' || kind === 'exp' || kind === 'gold' ? ['all'] : kind === 'luck' ? ['fortune'] : []

  return best(save, [kind], false) + best(save, [kind, ...extra], true)
}

/** 効いている料理のバフ */
export const foodBuffs = (save: SaveData): Buff[] => save.buffs.filter(buff => isFood(buff) && isActive(save, buff))

/** 残り（戦闘の秒数、または回数）。薬だけ */
export function buffLeft(save: SaveData, kind: BuffKind): { seconds?: number; charges?: number } | undefined {
  const buff = save.buffs.find(b => b.kind === kind && !isFood(b) && isActive(save, b))
  if (buff === undefined) {
    return undefined
  }

  return buff.charges !== undefined ? { charges: buff.charges } : { seconds: Math.max(0, (buff.until ?? 0) - save.battleSeconds) }
}

/**
 * 薬を飲む。同じ種類が効いていれば: 新しい方が強ければ入れ替え、同じ強さなら時間（回数）を足す（上限あり）、弱ければ飲めない（undefined）。
 * 切れたバフはここで片付ける
 */
export function addBuff(save: SaveData, kind: BuffKind, rate: number, length: { seconds?: number; charges?: number }): SaveData | undefined {
  const alive = save.buffs.filter(buff => isActive(save, buff))
  const old = alive.find(buff => buff.kind === kind && !isFood(buff))
  const others = alive.filter(buff => buff !== old)
  if (old !== undefined && old.rate > rate + 1e-9) {
    return undefined
  }
  const isSame = old !== undefined && Math.abs(old.rate - rate) < 1e-9
  let next: Buff
  if (length.charges !== undefined) {
    const base = isSame ? (old.charges ?? 0) : 0
    next = { kind, rate, charges: Math.min(BUFF_MAX_CHARGES, base + length.charges) }
  } else {
    const start = isSame ? Math.max(old.until ?? 0, save.battleSeconds) : save.battleSeconds
    next = { kind, rate, until: Math.min(save.battleSeconds + BUFF_MAX_SECONDS, start + (length.seconds ?? 0)) }
  }

  return { ...save, buffs: [...others, next] }
}

/**
 * 料理を食べる。同時に FOOD_SLOTS 個まで（違う種類どうし）。同じ種類が効いていれば: 強い方が残り、同じ強さなら時間（回数）を足す。
 * 弱い料理・3 つ目の料理は食べられない（undefined）
 */
export function addFood(save: SaveData, dish: string, kind: BuffKind, rate: number, length: { seconds?: number; charges?: number }): SaveData | undefined {
  const alive = save.buffs.filter(buff => isActive(save, buff))
  const foods = alive.filter(isFood)
  const old = foods.find(buff => buff.kind === kind)
  if (old !== undefined && old.rate > rate + 1e-9) {
    return undefined
  }
  if (old === undefined && foods.length >= FOOD_SLOTS) {
    return undefined
  }
  const isSame = old !== undefined && Math.abs(old.rate - rate) < 1e-9
  let next: Buff
  if (length.charges !== undefined) {
    next = { kind, rate, charges: Math.min(BUFF_MAX_CHARGES, (isSame ? (old.charges ?? 0) : 0) + length.charges), dish }
  } else {
    const start = isSame ? Math.max(old.until ?? 0, save.battleSeconds) : save.battleSeconds
    next = { kind, rate, until: Math.min(save.battleSeconds + BUFF_MAX_SECONDS, start + (length.seconds ?? 0)), dish }
  }

  return { ...save, buffs: [...alive.filter(buff => buff !== old), next] }
}

/** 回数で減るバフ（薬も料理も）を 1 回使う（効いていなければそのまま） */
export function useCharge(save: SaveData, kind: BuffKind): SaveData {
  if (!save.buffs.some(b => b.kind === kind && b.charges !== undefined && b.charges > 0)) {
    return save
  }
  const buffs = save.buffs
    .map(b => (b.kind === kind && b.charges !== undefined && b.charges > 0 ? { ...b, charges: b.charges - 1 } : b))
    .filter(b => b.charges === undefined || b.charges > 0)

  return { ...save, buffs }
}
