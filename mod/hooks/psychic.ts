import type { PsychicState, SaveData } from '../types'

// 超能力ツリーの定義と計算。表示・購入・戦闘から使う純粋な関数。

export type PsychicPath = 'mind' | 'future' | 'fortune'
export type PsychicNode = { id: string; path: PsychicPath; order: number; cost: number; skill?: boolean }

export const PSYCHIC_NODES: readonly PsychicNode[] = [
  { id: 'mind-1', path: 'mind', order: 1, cost: 1 },
  { id: 'mind-2', path: 'mind', order: 2, cost: 1 },
  { id: 'mind-3', path: 'mind', order: 3, cost: 2 },
  { id: 'mind-4', path: 'mind', order: 4, cost: 2 },
  { id: 'mind-5', path: 'mind', order: 5, cost: 3, skill: true },
  { id: 'mind-6', path: 'mind', order: 6, cost: 2 },
  { id: 'mind-7', path: 'mind', order: 7, cost: 3 },
  { id: 'mind-8', path: 'mind', order: 8, cost: 3 },
  { id: 'mind-9', path: 'mind', order: 9, cost: 3 },
  { id: 'mind-10', path: 'mind', order: 10, cost: 5, skill: true },
  { id: 'future-1', path: 'future', order: 1, cost: 1 },
  { id: 'future-2', path: 'future', order: 2, cost: 1 },
  { id: 'future-3', path: 'future', order: 3, cost: 2 },
  { id: 'future-4', path: 'future', order: 4, cost: 2 },
  { id: 'future-5', path: 'future', order: 5, cost: 3, skill: true },
  { id: 'future-6', path: 'future', order: 6, cost: 2 },
  { id: 'future-7', path: 'future', order: 7, cost: 3 },
  { id: 'future-8', path: 'future', order: 8, cost: 3 },
  { id: 'future-9', path: 'future', order: 9, cost: 3 },
  { id: 'future-10', path: 'future', order: 10, cost: 5, skill: true },
  { id: 'fortune-1', path: 'fortune', order: 1, cost: 1 },
  { id: 'fortune-2', path: 'fortune', order: 2, cost: 1 },
  { id: 'fortune-3', path: 'fortune', order: 3, cost: 2 },
  { id: 'fortune-4', path: 'fortune', order: 4, cost: 2 },
  { id: 'fortune-5', path: 'fortune', order: 5, cost: 3, skill: true },
  { id: 'fortune-6', path: 'fortune', order: 6, cost: 2 },
  { id: 'fortune-7', path: 'fortune', order: 7, cost: 3 },
  { id: 'fortune-8', path: 'fortune', order: 8, cost: 3 },
  { id: 'fortune-9', path: 'fortune', order: 9, cost: 3 },
  { id: 'fortune-10', path: 'fortune', order: 10, cost: 5, skill: true },
]

export const PSYCHIC_NODE_IDS = new Set<string>(PSYCHIC_NODES.map(node => node.id))
export const GOLDEN_HAND_SECONDS = 30 * 60

export const emptyPsychic = (): PsychicState => ({
  nodes: [],
  resets: 0,
  midasDay: '',
  bossMemory: {},
  // 宝箱の間隔と技の記録をセーブに置き、再読み込み後も結果を変えない。
  goldHandAt: 0,
  procCount: 0,
  lastProc: '',
  procAt: 0,
  procLog: [],
})

export const hasPsychicNode = (save: Pick<SaveData, 'psychic'>, id: string): boolean => save.psychic.nodes.includes(id)

export function psychicNode(id: string): PsychicNode | undefined {
  return PSYCHIC_NODES.find(node => node.id === id)
}

export function canLearnPsychic(save: SaveData, id: string): boolean {
  const node = psychicNode(id)
  if (node === undefined || save.psychic.nodes.includes(id) || save.wallet.psi < node.cost) return false
  return node.order === 1 || save.psychic.nodes.includes(`${node.path}-${node.order - 1}`)
}

export function learnPsychic(save: SaveData, id: string): SaveData | undefined {
  const node = psychicNode(id)
  if (node === undefined || !canLearnPsychic(save, id)) return undefined
  return {
    ...save,
    wallet: { ...save.wallet, psi: save.wallet.psi - node.cost },
    psychic: { ...save.psychic, nodes: [...save.psychic.nodes, id] },
  }
}

/** 振り直しは開いたノードのポイントを返す。最初の 1 回だけ星を使わない。 */
export function resetPsychic(save: SaveData): SaveData | undefined {
  if (save.psychic.nodes.length === 0) return undefined
  const cost = save.psychic.resets === 0 ? 0 : 100
  if (save.wallet.stars < cost) return undefined
  const refund = save.psychic.nodes.reduce((sum, id) => sum + (psychicNode(id)?.cost ?? 0), 0)
  return {
    ...save,
    wallet: { stars: save.wallet.stars - cost, psi: save.wallet.psi + refund },
    psychic: { ...save.psychic, nodes: [], resets: save.psychic.resets + 1 },
  }
}

export function bossRetrySeconds(save: SaveData, baseSeconds: number): number {
  return hasPsychicNode(save, 'future-6') ? baseSeconds * 0.75 : baseSeconds
}

export const psychicGoldRate = (save: SaveData): number => (hasPsychicNode(save, 'fortune-1') ? 0.05 : 0)
export const psychicGoldReward = (save: SaveData, amount: number): number => Math.floor(amount * (1 + psychicGoldRate(save)))
export const psychicStarReward = (save: SaveData, amount: number): number =>
  Math.floor(amount * (hasPsychicNode(save, 'fortune-9') ? 1.1 : 1))

export const psychicBossMemory = (save: SaveData, chapter: number): number => Math.min(5, Math.max(0, save.psychic.bossMemory[chapter] ?? 0))

export function rememberPsychicBoss(save: SaveData, chapter: number, won: boolean): SaveData {
  const bossMemory = { ...save.psychic.bossMemory }
  if (won) delete bossMemory[chapter]
  else bossMemory[chapter] = Math.min(5, (bossMemory[chapter] ?? 0) + 1)
  return { ...save, psychic: { ...save.psychic, bossMemory } }
}

/** 技が発動した印。実際の記録出力は actions.ts がセーブ差分から行う。 */
export function recordPsychicProc(save: SaveData, id: string, at: number, count = 1): SaveData {
  const total = save.psychic.procCount + count
  return {
    ...save,
    psychic: {
      ...save.psychic,
      procCount: total,
      lastProc: id,
      procAt: at,
      procLog: [...save.psychic.procLog, { id, at, count, total }].slice(-64),
    },
  }
}
