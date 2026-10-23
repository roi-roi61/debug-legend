import type { FeatureId, Sprite } from '../types'
import { ART } from './art.generated'
import { halfSprite, spriteHeight, spritePaths, spriteWidth, svg } from './sprite'

// 冒険の暦の絵（docs/DAILY.md「冒険の暦」）。14 日のマスを 7 マスずつ 2 枚の Svg に描く。
// 開いた日 = 施設の絵（案内役・アイコン）、まだの日 = 同じ絵を黒く塗った影と「？？？」、次の日 = 金色の枠が光って「あと N 日」。
// 開いたばかり（説明をまだ見ていない）の日は、影が消えて絵が現れ、光が弾ける（SMIL。isInteractive で描く）。
// 影は同じ絵の色を 1 色にしただけなので、別の絵はいらない（path も 1 本になって軽い）。

/** 施設ごとの絵の候補（前から順に、取り込んである絵を使う） */
const FEATURE_ART: Record<FeatureId, readonly string[]> = {
  calendar: ['npc-comet'],
  shop: ['npc-mina', 'chest'],
  mine: ['npc-drill', 'pickaxe-1'],
  farm: ['crop-carrot', 'crop-tomato', 'npc-comet'],
  missions: ['star-shard', 'npc-comet'],
  pet: ['pet-duck-1', 'pet-drake-1'],
  expedition: ['npc-pen'],
  smith: ['npc-bolt'],
  premium: ['box-legend', 'star-shard', 'chest'],
  psychic: ['npc-ora'],
  goldmine: ['cart', 'ore-gold', 'npc-drill'],
  bigfarm: ['animal-cow', 'animal-chicken', 'npc-comet'],
  pet2: ['pet-fox-1', 'pet-owl-1', 'pet-duck-1'],
  codex: ['boss-origin-moth', 'boss-tech-debt'],
}

export type DayState = 'open' | 'today' | 'fresh' | 'next' | 'locked'

export type DayCell = { day: number; feature: FeatureId; state: DayState; label: string; sub: string }

export const CELL = { w: 52, h: 66, gap: 4 }
/** 絵を置く箱の大きさ（ドット） */
const BOX = 40

export function featureSprite(id: FeatureId): Sprite | undefined {
  for (const artId of FEATURE_ART[id]) {
    const art = ART[artId]
    if (art !== undefined) {
      return art
    }
  }

  return undefined
}

const shadows = new Map<Sprite, Sprite>()

/** 影: 透明でない色をすべて 1 色にする */
export function shadowSprite(sprite: Sprite, color = '#07080f'): Sprite {
  const hit = shadows.get(sprite)
  if (hit !== undefined) {
    return hit
  }
  const palette = Object.fromEntries(Object.keys(sprite.palette).map(key => [key, color]))
  const shadow = { rows: sprite.rows, palette }
  shadows.set(sprite, shadow)

  return shadow
}

/** 箱（BOX × BOX）に収まるように縮めた絵（大きい絵は 1/2 にしてから、さらに足りなければ縮尺で） */
function fitted(sprite: Sprite): { body: string; w: number; h: number; k: number } {
  const small = spriteWidth(sprite) > BOX * 1.25 ? halfSprite(sprite) : sprite
  const w = spriteWidth(small)
  const h = spriteHeight(small)
  const k = Math.min(1, BOX / Math.max(w, h))

  return { body: spritePaths(small), w, h, k }
}

function place(body: string, w: number, h: number, k: number, x: number, y: number): string {
  const ox = x + (BOX - w * k) / 2
  const oy = y + (BOX - h * k) / 2

  return `<g transform="translate(${ox.toFixed(2)} ${oy.toFixed(2)}) scale(${k.toFixed(3)})">${body}</g>`
}

const TEXT = 'font-family="sans-serif" font-weight="bold" text-anchor="middle"'

/** 1 マス */
function cellSvg(cell: DayCell, x: number): string {
  const sprite = featureSprite(cell.feature)
  const isShadow = cell.state === 'next' || cell.state === 'locked'
  const frame =
    cell.state === 'today' || cell.state === 'fresh' ? '#ffd60a' : cell.state === 'open' ? '#8a7a3a' : cell.state === 'next' ? '#c9a227' : '#2e3245'
  const fill = isShadow ? (cell.state === 'next' ? '#3a3550' : '#2b3047') : '#232a3f'
  const parts: string[] = [`<rect x="${x + 0.5}" y="0.5" width="${CELL.w - 1}" height="${CELL.h - 1}" rx="4" fill="${fill}" stroke="${frame}" stroke-width="${cell.state === 'next' || cell.state === 'today' || cell.state === 'fresh' ? 2 : 1}"/>`]
  // 日の番号
  parts.push(`<text x="${x + CELL.w / 2}" y="10" font-size="8" fill="${isShadow ? '#6b7088' : '#ffd60a'}" ${TEXT}>${cell.sub}</text>`)
  const bx = x + (CELL.w - BOX) / 2
  const by = 12
  if (sprite !== undefined) {
    const color = fitted(sprite)
    if (isShadow) {
      const shadow = fitted(shadowSprite(sprite))
      parts.push(place(shadow.body, shadow.w, shadow.h, shadow.k, bx, by))
      parts.push(`<text x="${x + CELL.w / 2}" y="${by + BOX / 2 + 5}" font-size="14" fill="#c9a227" opacity="0.85" ${TEXT}>?</text>`)
    } else if (cell.state === 'fresh') {
      // 開いたばかり: 影 → 光 → 絵（くり返さない）
      const shadow = fitted(shadowSprite(sprite))
      parts.push(`<g opacity="0">${place(color.body, color.w, color.h, color.k, bx, by)}<animate attributeName="opacity" values="0;0;1" keyTimes="0;0.5;1" dur="1.6s" fill="freeze"/></g>`)
      parts.push(`<g>${place(shadow.body, shadow.w, shadow.h, shadow.k, bx, by)}<animate attributeName="opacity" values="1;1;0" keyTimes="0;0.45;0.75" dur="1.6s" fill="freeze"/></g>`)
      parts.push(
        `<circle cx="${x + CELL.w / 2}" cy="${by + BOX / 2}" r="2" fill="none" stroke="#fff3b0" stroke-width="3" opacity="0"><animate attributeName="r" values="2;2;26" keyTimes="0;0.45;1" dur="1.6s" fill="freeze"/><animate attributeName="opacity" values="0;0;1;0" keyTimes="0;0.44;0.6;1" dur="1.6s" fill="freeze"/></circle>`,
      )
    } else {
      parts.push(place(color.body, color.w, color.h, color.k, bx, by))
    }
  } else {
    parts.push(`<text x="${x + CELL.w / 2}" y="${by + BOX / 2 + 6}" font-size="18" fill="${isShadow ? '#3a3f55' : '#ffd60a'}" ${TEXT}>${isShadow ? '?' : '★'}</text>`)
  }
  // 名前（まだの日は ？？？、次の日は「あと N 日」）
  const labelColor = isShadow ? (cell.state === 'next' ? '#e8c45a' : '#5a5f75') : '#f2f2f2'
  parts.push(`<text x="${x + CELL.w / 2}" y="${CELL.h - 5}" font-size="7.5" fill="${labelColor}" ${TEXT}>${escapeXml(cell.label)}</text>`)
  if (cell.state === 'next') {
    // 次の日: 金色の枠がゆっくり明滅
    parts.push(
      `<rect x="${x + 1.5}" y="1.5" width="${CELL.w - 3}" height="${CELL.h - 3}" rx="4" fill="none" stroke="#ffe27a" stroke-width="1.5" opacity="0.2"><animate attributeName="opacity" values="0.15;0.9;0.15" dur="2.2s" repeatCount="indefinite"/></rect>`,
    )
  }
  if (cell.state === 'fresh') {
    parts.push(`<text x="${x + CELL.w - 4}" y="20" font-size="7" fill="#ff4d6d" font-family="sans-serif" font-weight="bold" text-anchor="end">NEW</text>`)
  }

  return parts.join('')
}

const escapeXml = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** 1 段（7 マスまで）の Svg */
export function calendarRowSvg(cells: readonly DayCell[]): string {
  const width = cells.length * CELL.w + (cells.length - 1) * CELL.gap

  return svg(width, CELL.h, cells.map((cell, i) => cellSvg(cell, i * (CELL.w + CELL.gap))).join(''))
}
