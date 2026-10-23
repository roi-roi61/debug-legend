import type { Art, FeatureId, Sprite } from '../types'
import { ART } from './art.generated'
import { halfSprite, spriteHeight, spritePaths, spriteWidth, svg } from './sprite'

// 毎日の冒険の画面に出す小さな絵（docs/DAILY.md の 18 章）: 持ち物のアイコン（48 ドット）、施設の案内役（64 ドット）、施設の背景（170×80）。
// 持ち物の ID（`crop-carrot-q2`・`potion-power-m`・`seed-tomato` など）から、取り込んだ絵の ID を決める。
// 色違い（金色の作物・ボスの欠片・魂・卵）は 1 枚の絵の色相を回して作る（絵を増やさない）。

type Icon = { art: Art; hue: number; glow?: string }

/** 持ち物の ID → 絵の ID と色相（度） */
export function iconFor(id: string): Icon | undefined {
  const pick = (artId: string, hue = 0, glow?: string): Icon | undefined => {
    const art = ART[artId]
    return art === undefined ? undefined : { art, hue, ...(glow === undefined ? {} : { glow }) }
  }
  // 作物: crop-<作物>-q1〜q3 / -gold
  const crop = /^crop-([a-z]+)-(q\d|gold)$/.exec(id)
  if (crop !== null) {
    return pick(`crop-${crop[1]}`, 0, crop[2] === 'gold' ? '#ffd60a' : undefined)
  }
  // 種: seed-<作物>（種袋の絵。金色の種は専用）
  if (id.startsWith('seed-') && id !== 'seed-bag') {
    return pick('seed-bag')
  }
  if (id === 'seed-pack') {
    return pick('seed-bag')
  }
  // 薬: potion-<種類>-<大きさ>。金運の薬は幸運の薬の色違い（緑 → 黄）
  const potion = /^potion-([a-z]+)-[sml]$/.exec(id)
  if (potion !== null) {
    return potion[1] === 'gold' ? pick('potion-luck', -62) : pick(`potion-${potion[1]}`)
  }
  // ボスの欠片・魂: 章ごとに色相を回す
  const shard = /^boss-shard-(\d+)$/.exec(id)
  if (shard !== null) {
    return pick('boss-shard', (Number(shard[1]) - 1) * 36)
  }
  const soul = /^soul-(\d+)$/.exec(id)
  if (soul !== null) {
    return pick('soul', (Number(soul[1]) - 1) * 36)
  }
  // 鉱山のボス鉱石: アダマンの色違い
  const bossOre = /^ore-boss-(\d+)$/.exec(id)
  if (bossOre !== null) {
    return pick('ore-adamant', Number(bossOre[1]) * 60, '#ff9f1c')
  }
  // 首輪: collar-<種類>-r<レア度>
  if (id.startsWith('collar')) {
    return pick('collar')
  }
  const alias: Record<string, string> = {
    pick: 'pickaxe-1',
    'pick-10': 'pickaxe-1',
    'chest-ticket-10': 'chest-ticket',
    'gold-cart': 'cart',
    'egg-shard': 'egg',
    'box-legend': 'chest',
    'box-myth': 'chest',
    'pet-meal': 'dish-petfood',
    'smith-dust': 'ore-silver',
    'ingot-copper': 'ingot',
    'ingot-iron': 'ingot',
    'collar-box': 'collar',
    'soul-lamp': 'soul',
    contract: 'psi-book',
  }
  const hues: Record<string, number> = { 'box-myth': 270, contract: 160 }
  const glows: Record<string, string> = { 'box-legend': '#ff9f1c', 'box-myth': '#c77dff', 'gold-cart': '#ffd60a', 'ingot-copper': '#c87533' }
  const artId = alias[id] ?? id

  return pick(artId, hues[id] ?? 0, glows[id])
}

const iconCache = new Map<string, string>()

/**
 * 持ち物のアイコンの Svg（size × size に縮めて描く。絵が無ければ undefined）。
 * 光（金色の作物・伝説箱など）は後ろにぼんやりした円
 */
export function iconSvg(id: string, size = 24): string | undefined {
  const key = `${id}@${size}`
  const hit = iconCache.get(key)
  if (hit !== undefined) {
    return hit
  }
  const icon = iconFor(id)
  if (icon === undefined) {
    return undefined
  }
  const source = drawFitted(icon.art, size, icon.hue, icon.glow, id)
  iconCache.set(key, source)

  return source
}

/** 絵を size × size に収めて描く（大きい絵は 1/2 にしてから縮める。SVG の文字数を抑える） */
function drawFitted(art: Sprite, size: number, hue: number, glow: string | undefined, key: string): string {
  const small = spriteWidth(art) > size * 1.5 ? halfSprite(art) : art
  const w = spriteWidth(small)
  const h = spriteHeight(small)
  const k = size / Math.max(w, h)
  const id = `h${key.replace(/[^a-z0-9]/g, '')}`
  const filter = hue === 0 ? '' : `<defs><filter id="${id}"><feColorMatrix type="hueRotate" values="${hue}"/></filter></defs>`
  const halo = glow === undefined ? '' : `<circle cx="${size / 2}" cy="${size / 2}" r="${size * 0.48}" fill="${glow}" opacity="0.35"/>`
  const body = `<g transform="translate(${((size - w * k) / 2).toFixed(2)} ${((size - h * k) / 2).toFixed(2)}) scale(${k.toFixed(4)})"${hue === 0 ? '' : ` filter="url(#${id})"`}>${spritePaths(small)}</g>`

  return svg(size, size, filter + halo + body, false)
}

/** 施設の案内役（説明の吹き出し・施設の見出しに出す） */
export const FEATURE_NPC: Partial<Record<FeatureId | 'blackmarket', string>> = {
  calendar: 'npc-comet',
  shop: 'npc-mina',
  premium: 'npc-mina',
  blackmarket: 'npc-nox',
  mine: 'npc-drill',
  goldmine: 'npc-drill',
  farm: 'npc-comet',
  bigfarm: 'npc-comet',
  missions: 'npc-comet',
  pet: 'npc-comet',
  pet2: 'npc-comet',
  expedition: 'npc-pen',
  smith: 'npc-bolt',
  psychic: 'npc-ora',
  codex: 'npc-comet',
}

/** 施設の背景（170×80） */
export const FEATURE_BG: Partial<Record<FeatureId | 'blackmarket', string>> = {
  shop: 'bg-shop',
  premium: 'bg-shop-premium',
  blackmarket: 'bg-black-market',
  smith: 'bg-smith',
  expedition: 'bg-guild',
  mine: 'bg-mine-1',
  goldmine: 'bg-gold-mine',
  farm: 'bg-farm',
  bigfarm: 'bg-farm-big',
  psychic: 'bg-psychic',
  codex: 'bg-seal',
}

/** 鉱山の深さごとの背景 */
export const mineBg = (floor: number): string => (floor > 50 ? 'bg-mine-star' : `bg-mine-${Math.min(5, Math.max(1, Math.ceil(floor / 10)))}`)

const headerCache = new Map<string, string>()

/**
 * 施設の見出しの絵: 背景（170×80）の左に案内役（64 ドット）が立ち、ゆっくり揺れる。背景か案内役が無ければ、ある方だけ。どちらも無ければ undefined
 */
export function facilitySvg(bgId: string | undefined, npcId: string | undefined): string | undefined {
  const key = `${bgId ?? ''}|${npcId ?? ''}`
  const hit = headerCache.get(key)
  if (hit !== undefined) {
    return hit
  }
  const bg = bgId === undefined ? undefined : ART[bgId]
  const npc = npcId === undefined ? undefined : ART[npcId]
  if (bg === undefined && npc === undefined) {
    return undefined
  }
  const W = 170
  const H = 80
  const back = bg === undefined ? `<rect width="${W}" height="${H}" fill="#1b2033"/>` : spritePaths(bg)
  // 案内役は 72 ドットの高さに（64 ドットの絵を少し大きめに）。足元を下にそろえる
  let front = ''
  if (npc !== undefined) {
    const small = npc.w > 64 ? halfSprite(npc) : npc
    const k = 72 / Math.max(spriteWidth(small), spriteHeight(small))
    const x = 8
    const y = H - spriteHeight(small) * k
    front =
      `<ellipse cx="${(x + (spriteWidth(small) * k) / 2).toFixed(1)}" cy="${H - 2}" rx="${((spriteWidth(small) * k) / 3).toFixed(1)}" ry="2.5" fill="#000" opacity="0.35"/>` +
      `<g><g transform="translate(${x} ${y.toFixed(2)}) scale(${k.toFixed(4)})">${spritePaths(small)}</g>` +
      `<animateTransform attributeName="transform" type="translate" values="0 0;0 -1.5;0 0" dur="2.4s" repeatCount="indefinite"/></g>`
  }
  const source = svg(W, H, back + front)
  headerCache.set(key, source)

  return source
}
