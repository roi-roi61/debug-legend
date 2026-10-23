import type { Art, Item, JobId, Sprite } from '../types'
import { ART } from './art.generated'
import { BUG, HERO } from './placeholder'
import { spriteHeight, spriteWidth } from './sprite'
import { T } from './texts'
import { BASE_MOB_IDS, BOSS_STAGE, JOB_ART, chapterOf, enemyId } from './world'

// どの絵を使うか。art/export から取り込んだ絵（art.generated.ts）があればそれを、無ければ仮の絵を使う。

export type Figure = {
  id: string
  name: string
  sprite: Sprite
  /** 絵のドット数 */
  w: number
  h: number
  /** 戦闘画面で何倍に描くか（仮の 16×16 は 4 倍にして 64×64 相当にする） */
  scale: number
  /** 色違い（色相を何度回すか）。絵がまだ無い敵は、ある敵の色違いで代わりに出す */
  hue: number
}

function fromArt(id: string, name: string, art: Art, hue = 0): Figure {
  return { id, name, sprite: art, w: art.w, h: art.h, scale: 1, hue }
}

function placeholder(id: string, name: string, sprite: Sprite, scale: number, hue = 0): Figure {
  return { id, name, sprite, w: spriteWidth(sprite), h: spriteHeight(sprite), scale, hue }
}

/** 職と進化の段階の絵の ID（進化前は class-<職>、進化後は class-<職>-e<段階>。見習いは主人公） */
export const heroArtId = (job: JobId, evolution: number): string => (job === 'novice' || evolution === 0 ? JOB_ART[job] : `${JOB_ART[job]}-e${evolution}`)

/**
 * 職と進化の段階の絵。進化後の絵がまだ無い間は進化前の絵、それも無ければ主人公の絵。
 * isStandIn: 進化後の絵の代わりに進化前の絵を出している（オーラを強めて見分ける）。
 */
export function heroFigure(job: JobId = 'novice', evolution = 0): Figure & { isStandIn: boolean } {
  const name = T.jobName[job]
  const id = heroArtId(job, evolution)
  const art = ART[id]
  if (art !== undefined) {
    return { ...fromArt(id, name, art), isStandIn: false }
  }
  const before = ART[JOB_ART[job]] ?? ART[JOB_ART.novice]
  const isStandIn = evolution > 0

  return { ...(before === undefined ? placeholder(JOB_ART[job], name, HERO, 6) : fromArt(JOB_ART[job], name, before)), isStandIn }
}

/** 進化の段階のオーラ（0 段目は無し）。色は職ごと、強さは段階ごと（進化後の絵がまだ無いときは 1 段強く） */
export type Aura = { color: string; level: number }

const AURA_COLOR: Record<JobId, string> = {
  novice: '#ffffff',
  'backend-knight': '#ffd166',
  'frontend-mage': '#c77dff',
  'infra-sniper': '#4cc38a',
}

export function auraFor(job: JobId, evolution: number, isStandIn: boolean): Aura | null {
  return evolution === 0 ? null : { color: AURA_COLOR[job], level: Math.min(4, evolution + (isStandIn ? 1 : 0)) }
}

/** 装備の絵（art/export/item-<部位>-<0〜2>.json）。無ければ undefined（文字のアイコンを出す） */
export const itemArt = (item: Item): Art | undefined => ART[`item-${item.slot}-${item.nameIndex % 3}`]

/** 宝箱の絵（art/export/chest.json）。無ければ undefined（図形で描く） */
export const chestArt = (): Art | undefined => ART.chest

/**
 * そのステージで戦う敵（10 ステージ目はボス）。
 * 絵が無い敵は、絵のあるもとの雑魚から ID のハッシュで選んだ色違い（ボスは第 1 章のボスの色違い）。それも無ければ仮のバグ。
 * sync_art.py で絵が入れば、そのまま本物に置き換わる。
 */
export function enemyFigure(chapter: number, stage: number): Figure {
  return enemyFigureById(chapter, enemyId(chapter, stage), stage >= BOSS_STAGE)
}

/** 敵の ID から絵を選ぶ（群れの 1 匹ずつに使う） */
export function enemyFigureById(chapter: number, id: string, isBoss: boolean): Figure {
  const name = T.enemy[id] ?? T.enemyFallback
  const art = ART[id]
  if (art !== undefined) {
    return fromArt(id, name, art)
  }
  if (isBoss) {
    // ボスの代役は、第 1 章のボスの色違い（章ごとに色相を回す）
    const bossArt = ART[chapterOf(1).boss]
    const hue = ((chapter - 1) * 67) % 360 || 180

    return bossArt === undefined ? placeholder(id, name, BUG, 8, hue) : fromArt(id, name, bossArt, hue)
  }
  // 絵が無い雑魚（2.1.0 で増やした分）は、絵のあるもとの雑魚から ID のハッシュで 1 つ選び、色相もハッシュで回す
  // （新しい種類どうしが同じ見た目にならないように）。sync_art.py で絵が入れば、そのまま本物に置き換わる
  const hash = idHash(id)
  const drawn = BASE_MOB_IDS.filter(base => ART[base] !== undefined)
  const standArt = drawn.length === 0 ? undefined : ART[drawn[hash % drawn.length]!]
  const hue = (Math.floor(hash / 64) % 330) + 20

  return standArt === undefined ? placeholder(id, name, BUG, 4, hue) : fromArt(id, name, standArt, hue)
}

/** ID から作る決まった数（代役の絵と色相を選ぶ） */
function idHash(id: string): number {
  let h = 2166136261
  for (let i = 0; i < id.length; i += 1) {
    h = Math.imul(h ^ id.charCodeAt(i), 16777619)
  }
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d)

  return (h ^ (h >>> 13)) >>> 0
}

/** 進化の段階つきの職の名前（例: スタッフ バックエンド騎士） */
export const heroTitle = (job: JobId, evolution: number): string => T.heroTitle(T.evolutionName[evolution] ?? '', T.jobName[job])

/** 装備の名前 */
export function itemName(item: Item): string {
  const bases = T.itemBase[item.slot]
  const baseName = item.unique === undefined
    ? T.itemName(T.itemPrefix[item.rarity] ?? '', bases[item.nameIndex % bases.length] ?? '')
    : T.bossGearName[item.unique] ?? T.itemName(T.itemPrefix[item.rarity] ?? '', bases[item.nameIndex % bases.length] ?? '')
  const setName = item.set === undefined ? '' : `${T.setName[item.set] ?? item.set} `

  return `${setName}${baseName}${(item.plus ?? 0) > 0 ? ` +${item.plus}` : ''}${item.goldTrim ? ` ${T.goldTrimMark}` : ''}`
}

export const rarityName = (rarity: number): string => T.rarity[rarity] ?? ''

export const rarityColor = (rarity: number): string => T.rarityColor[rarity] ?? '#ffffff'

/** +5 / +10 / +15 の段階で、枠に使う強化色 */
export function plusColor(item: Item): string {
  const plus = item.plus ?? 0
  if (plus >= 15) return '#ff6df0'
  if (plus >= 10) return '#ffd60a'
  if (plus >= 5) return '#dce7f2'
  return rarityColor(item.rarity)
}
