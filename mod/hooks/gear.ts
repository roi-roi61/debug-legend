import type { Drop, Item, SaveData, SlotId } from '../types'
import { buffRate, useCharge } from './buffs'
import { EVOLUTION, GEAR, LEVEL } from './config'
import { petBattleEffects } from './pets'
import { GOLDEN_HAND_SECONDS, hasPsychicNode, psychicGoldRate, recordPsychicProc } from './psychic'

// 装備とランプの計算。fuel.ts と同じく $ を使わない（同じセーブなら同じ結果）。

export const SLOTS: readonly SlotId[] = ['weapon', 'head', 'body', 'arms', 'legs', 'charm']

/** レア度の数（コモン〜ミシック） */
export const RARITY_COUNT = GEAR.rarityWeights.length

/** 1 枠の名前の候補の数（texts.ts の itemBase と合わせる） */
export const NAME_VARIANTS = 3
export const SET_IDS = ['copper-miner', 'iron-guardian', 'crystal-sage', 'mithril-swift', 'adamant-lord'] as const
export const BOSS_GEAR_IDS = ['merge-shield', 'loop-ring', 'gc-gloves', 'dependency-staff', 'deadlock-chain', 'daemon-helm', 'hydra-armor', 'not-found-cloak', 'zero-day-dagger', 'debt-crown'] as const

/** 乱数（mulberry32）。状態を受け取り、0〜1 の値と次の状態を返す */
export function random(state: number): { value: number; state: number } {
  const next = (state + 0x6d2b79f5) >>> 0
  let t = next
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)

  return { value: ((t ^ (t >>> 14)) >>> 0) / 4294967296, state: next }
}

/** 重みの表から 1 つ選ぶ */
function pickWeighted(weights: readonly number[], value: number): number {
  const total = weights.reduce((sum, w) => sum + w, 0)
  let left = value * total
  for (let i = 0; i < weights.length; i += 1) {
    left -= weights[i] ?? 0
    if (left < 0) {
      return i
    }
  }

  return weights.length - 1
}

/** 装備の強さ */
export function itemPower(slot: SlotId, level: number, rarity: number, roll: number): number {
  const base = GEAR.slotPower[slot] * (1 + GEAR.perLevel * (level - 1)) * (GEAR.rarityPower[rarity] ?? 1)

  return Math.max(1, Math.round(base * (1 - GEAR.spread + roll * GEAR.spread * 2)))
}

/** 売ったときのゴールド */
export function sellValue(item: Item, save?: SaveData): number {
  const bonus = (save !== undefined && hasPsychicNode(save, 'fortune-4') ? 1.1 : 1) * (save === undefined ? 1 : 1 + psychicGoldRate(save))
  return Math.max(1, Math.round(item.power * GEAR.sellRate * (item.rarity + 1) * bonus))
}

/** 強化と金の装飾を含む、装備 1 つの有効な強さ */
export function effectiveItemPower(item: Item): number {
  return item.power * (1 + 0.06 * (item.plus ?? 0)) * (item.goldTrim ? 1.03 : 1)
}

/** 付けているセット装備の個数 */
export function setCount(save: SaveData, id: string): number {
  return SLOTS.filter(slot => save.equipment[slot]?.set === id).length
}

/** いま付けている装備にボス専用装備があるか */
export function hasBossGear(save: SaveData, id: string): boolean {
  return SLOTS.some(slot => save.equipment[slot]?.unique === id)
}

/** 図鑑の収集率のごほうび（戦闘力の上がり幅）。もらった段階（codex.claimed の tier:<率>）ぶんが足し算で効く */
export const CODEX_TIERS: readonly { pct: number; power: number }[] = [
  { pct: 10, power: 0.01 },
  { pct: 25, power: 0.01 },
  { pct: 50, power: 0.02 },
  { pct: 75, power: 0.02 },
  { pct: 100, power: 0.03 },
]

/** 図鑑のごほうびによる戦闘力の上がり幅（0〜0.09） */
export const codexPowerRate = (save: Pick<SaveData, 'codex'>): number =>
  CODEX_TIERS.reduce((sum, tier) => sum + (save.codex.claimed.includes(`tier:${tier.pct}`) ? tier.power : 0), 0)

/** 装備を図鑑に記録する印（部位・名前・レア度） */
export const codexGearKey = (item: Item): string => `gear:${item.slot}:${item.nameIndex % NAME_VARIANTS}:${item.rarity}`

/** 戦闘力 =（基本 + Lv ぶん + 装備の強さの合計）× 進化の倍率（転職では変わらない） */
export function combatPower(save: SaveData): number {
  const gear = SLOTS.reduce((sum, slot) => sum + (save.equipment[slot] === null ? 0 : effectiveItemPower(save.equipment[slot]!)), 0)
  const setPower = setCount(save, 'adamant-lord') >= 6 ? 0.12 : 0
  const bossPower = hasBossGear(save, 'debt-crown') ? 0.08 : 0
  const rate = EVOLUTION.powerRate[save.evolution] ?? 1

  const curseCount = SLOTS.filter(slot => save.equipment[slot]?.curse === true).length

  const power = Math.round((LEVEL.powerBase + save.level * LEVEL.powerPerLevel + gear) * rate * (1 + setPower) * (1 + bossPower) * (1 + codexPowerRate(save)))

  return power * 1.3 ** curseCount
}

/** 新しい装備を 1 つ作る（乱数を進めたセーブも返す） */
export function rollItem(save: SaveData): { save: SaveData; item: Item } {
  let state = save.rng
  const draw = (): number => {
    const r = random(state)
    state = r.state
    return r.value
  }
  const slot = SLOTS[Math.floor(draw() * SLOTS.length)] ?? 'weapon'
  const rarity = pickWeighted(GEAR.rarityWeights, draw())
  const power = itemPower(slot, save.level, rarity, draw())
  const nameIndex = Math.floor(draw() * NAME_VARIANTS)
  const item: Item = { id: save.nextItemId, slot, rarity, level: save.level, power, nameIndex }

  return { save: { ...save, rng: state, nextItemId: save.nextItemId + 1 }, item }
}

/** 30 分たっていれば、次の宝箱にレア度を 1 段足す */
export function applyGoldenHand(save: SaveData, item: Item): { save: SaveData; item: Item; used: boolean } {
  if (!hasPsychicNode(save, 'fortune-5') || save.battleSeconds - save.psychic.goldHandAt < GOLDEN_HAND_SECONDS) {
    return { save, item, used: false }
  }
  let next: SaveData = { ...save, psychic: { ...save.psychic, goldHandAt: save.battleSeconds } }
  next = recordPsychicProc(next, 'fortune-5', save.lastTickAt)
  if (item.rarity >= RARITY_COUNT - 1) return { save: next, item, used: true }
  const roll = random(next.rng)
  const rarity = item.rarity + 1
  return {
    save: { ...next, rng: roll.state },
    item: { ...item, rarity, power: itemPower(item.slot, item.level, rarity, roll.value) },
    used: true,
  }
}

/** 自動判断で決めずに手動確認に回すか */
export function needsManualCheck(save: SaveData, item: Item): boolean {
  return !save.settings.autoJudge || (save.settings.manualRareUp && item.rarity >= GEAR.manualFrom)
}

/** 装備する（外した装備は売る） */
export function equip(save: SaveData, item: Item, now: number): { save: SaveData; drop: Drop } {
  const old = save.equipment[item.slot]
  const keepOld = old !== null && save.settings.keepForSmith && old.rarity >= 2 && save.stash.length < 60
  const gold = old === null || keepOld ? 0 : sellValue(old, save)
  const drop: Drop = { item, action: 'equipped', gold, at: now }

  return {
    save: { ...save, equipment: { ...save.equipment, [item.slot]: item }, stash: keepOld && old !== null ? [...save.stash, old] : save.stash, gold: save.gold + gold, pending: null, lastDrop: drop },
    drop,
  }
}

/** 売る */
export function sell(save: SaveData, item: Item, now: number): { save: SaveData; drop: Drop } {
  const gold = sellValue(item, save)
  const drop: Drop = { item, action: 'sold', gold, at: now }

  return { save: { ...save, gold: save.gold + gold, pending: null, lastDrop: drop }, drop }
}

/** いま付けている装備より強いか */
export function isUpgrade(save: SaveData, item: Item): boolean {
  return effectiveItemPower(item) > (save.equipment[item.slot] === null ? 0 : effectiveItemPower(save.equipment[item.slot]!))
}

function stashOrSell(save: SaveData, item: Item, now: number): { save: SaveData; drop: Drop } {
  if (save.settings.keepForSmith && item.rarity >= 2 && save.stash.length < 60) {
    const drop: Drop = { item, action: 'stashed', gold: 0, at: now }
    return { save: { ...save, stash: [...save.stash, item], pending: null, lastDrop: drop }, drop }
  }

  return sell(save, item, now)
}

/**
 * ランプを 1 回叩く: ストックを 1 減らし、装備を 1 つ出して、自動判断（装備 / 売却）か手動確認に回す。
 * ランプが無いとき・確認待ちの装備があるときは undefined。
 */
export function pullLamp(input: SaveData, now: number): { save: SaveData; drop: Drop } | undefined {
  if (input.lamps <= 0 || input.pending !== null) {
    return undefined
  }
  const rolled = rollItem({ ...input, lamps: input.lamps - 1 })
  const golden = applyGoldenHand(rolled.save, rolled.item)
  const lucky = luckyRarity(golden.save, golden.item, chestLuck(golden.save))

  return judge(lucky.save, lucky.item, now)
}

/** 宝箱のレア度が 1 段上がる確率の上限（薬・料理とペットの幸運を足したあと） */
const CHEST_LUCK_MAX = 0.5

/** 宝箱の幸運: 幸運の薬・料理に、戦闘に出ているペット（クジラ・幸運の首輪・組み合わせ）の幸運を足す */
export const chestLuck = (save: SaveData): number => Math.min(CHEST_LUCK_MAX, buffRate(save, 'luck') + petBattleEffects(save).luckRate)

/** 宝箱を開けるとき、幸運の薬が効いていればレア度を 1 段上げる（回数を 1 減らす）。pullLamp から呼ぶ */
export function luckyRarity(save: SaveData, item: Item, rate: number): { save: SaveData; item: Item } {
  if (rate <= 0) {
    return { save, item }
  }
  const r = random(save.rng)
  const used = useCharge({ ...save, rng: r.state }, 'luck')
  if (r.value >= rate || item.rarity >= RARITY_COUNT - 1) {
    return { save: used, item }
  }
  const rarity = item.rarity + 1
  const roll = random(used.rng)

  return { save: { ...used, rng: roll.state }, item: { ...item, rarity, power: itemPower(item.slot, item.level, rarity, roll.value) } }
}


/** 出た装備を自動判断（装備 / 売却）するか、手動確認に回す */
export function judge(input: SaveData, item: Item, now: number): { save: SaveData; drop: Drop } {
  const key = codexGearKey(item)
  const save = {
    ...input,
    totals: { ...input.totals, drops: input.totals.drops + 1 },
    // 図鑑: 売ってしまう装備も「出たこと」は残す
    codex: input.codex.seen.includes(key) ? input.codex : { ...input.codex, seen: [...input.codex.seen, key] },
  }
  if (needsManualCheck(save, item)) {
    const drop: Drop = { item, action: 'pending', gold: 0, at: now }
    return { save: { ...save, pending: item, lastDrop: drop }, drop }
  }

  return isUpgrade(save, item) ? equip(save, item, now) : stashOrSell(save, item, now)
}

/** 手動確認待ちの装備を、装備するか売るか決める */
export function resolvePending(save: SaveData, choice: 'equip' | 'sell', now: number): { save: SaveData; drop: Drop } | undefined {
  const item = save.pending
  if (item === null) {
    return undefined
  }

  return choice === 'equip' ? equip(save, item, now) : stashOrSell(save, item, now)
}
