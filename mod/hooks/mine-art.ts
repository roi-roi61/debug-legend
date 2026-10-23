import type { MineCell, Sprite } from '../types'
import { ART } from './art.generated'
import { mineBg } from './icon-art'
import { GEMS, ORES, layerOf } from './mine'
import { halfSprite, spriteHeight, spritePaths, spriteWidth, svg } from './sprite'

// 鉱山の絵（Opus）: 7 × 5 のマスを、深さの地層の背景の上にタイルの絵で描く（押すのは下のボタン。これは見るための地図）。
// まだのマス = 土 / 岩 / 硬い岩のタイル（残りの回数が減るとひびが増える）、光って見えるマス = きらめき、掘れるマス = 金色の縁、
// 開いたマス = 中身のアイコン（鉱石・宝石・宝箱・魔物・化石・泉・階段・日記）。ボスの階は、地図の代わりに鉱山のボスが立つ。
// 同じ絵は <defs> に 1 回だけ書いて <use> で使い回す（Svg の文字数を抑える）。

export const TILE = 24
const COLS = 7
const ROWS = 5
const PAD = 8

const BOSS_ART = ['mine-boss-copper', 'mine-boss-iron', 'mine-boss-crystal', 'mine-boss-mithril', 'mine-boss-adamant']

/** 開いたマスの中身 → 絵の ID（深さで鉱石・宝石が変わる） */
function contentArt(kind: string, floor: number): string | undefined {
  const layer = layerOf(floor)
  const table: Record<string, string | undefined> = {
    ore: ORES[layer],
    gem: GEMS[layer],
    chest: 'chest',
    fossil: 'fossil',
    spring: 'potion-learn',
    stairs: 'tile-stairs',
    diary: 'psi-book',
    monster: undefined,
  }

  return table[kind]
}

/** 絵を size × size に収める（大きい絵は 1/2 にしてから） */
function fit(sprite: Sprite, size: number): { body: string; k: number; w: number; height: number } {
  const small = spriteWidth(sprite) > size * 1.5 ? halfSprite(sprite) : sprite
  const w = spriteWidth(small)
  const height = spriteHeight(small)

  return { body: spritePaths(small), k: size / Math.max(w, height), w, height }
}

export type MineMapInput = { floor: number; grid: readonly MineCell[]; diggable: readonly boolean[]; glimpse: readonly boolean[]; isBoss: boolean; bossType: number }

/** 鉱山の地図の Svg（幅 7 × 24 + 余白、高さ 5 × 24 + 余白）。背景は深さの地層を暗くして敷く */
export function mineMapSvg(input: MineMapInput): string {
  const width = COLS * TILE + PAD * 2
  const height = ROWS * TILE + PAD * 2
  const parts: string[] = []
  const defs = new Map<string, string>()
  const def = (id: string, artId: string, size: number): string | undefined => {
    const art = ART[artId]
    if (art === undefined) {
      return undefined
    }
    if (!defs.has(id)) {
      const f = fit(art, size)
      defs.set(id, `<g id="${id}" transform="translate(${((TILE - f.w * f.k) / 2).toFixed(2)} ${((TILE - f.height * f.k) / 2).toFixed(2)}) scale(${f.k.toFixed(4)})">${f.body}</g>`)
    }
    return id
  }

  // 背景: 深さの地層（170×80 を地図の大きさに引き伸ばし、暗くする）
  const bg = ART[mineBg(input.floor)]
  if (bg !== undefined) {
    parts.push(`<g transform="scale(${(width / 170).toFixed(4)} ${(height / 80).toFixed(4)})">${spritePaths(bg)}</g><rect width="${width}" height="${height}" fill="#0b0d16" opacity="0.55"/>`)
  } else {
    parts.push(`<rect width="${width}" height="${height}" fill="#1a1712"/>`)
  }

  if (input.isBoss) {
    const art = ART[BOSS_ART[input.bossType % BOSS_ART.length] ?? '']
    if (art !== undefined) {
      const f = fit(art, height - 12)
      parts.push(
        `<g><g transform="translate(${((width - f.w * f.k) / 2).toFixed(2)} ${(height - f.height * f.k - 4).toFixed(2)}) scale(${f.k.toFixed(4)})">${f.body}</g>` +
          `<animateTransform attributeName="transform" type="translate" values="0 0;0 -2;0 0" dur="1.6s" repeatCount="indefinite"/></g>`,
      )
    }
    return svg(width, height, parts.join(''))
  }

  input.grid.forEach((cell, index) => {
    const x = PAD + (index % COLS) * TILE
    const y = PAD + Math.floor(index / COLS) * TILE
    if (cell.open) {
      // 開いたマス: 暗い床。出てきたもの（まだ受け取っていない）は光る縁つきで出し、受け取ったあとは空の床。
      // 階段はずっと残る。負けた魔物は赤い ×（勝ったときは落とし物が出る）
      parts.push(`<rect x="${x + 0.5}" y="${y + 0.5}" width="${TILE - 1}" height="${TILE - 1}" fill="#14110d" opacity="0.75"/>`)
      const hasPrize = cell.prize !== undefined
      if (hasPrize) {
        const artId = cell.kind === 'monster' ? ORES[layerOf(input.floor)] : contentArt(cell.kind, input.floor)
        const id = artId === undefined ? undefined : def(`c-${artId}`, artId, TILE - 4)
        parts.push(`<rect x="${x + 1}" y="${y + 1}" width="${TILE - 2}" height="${TILE - 2}" fill="none" stroke="#fff3a6" stroke-width="1.2"><animate attributeName="opacity" values="0.35;1;0.35" dur="1.2s" repeatCount="indefinite"/></rect>`)
        if (id !== undefined) {
          parts.push(`<g><use href="#${id}" x="${x}" y="${y}"/><animateTransform attributeName="transform" type="translate" values="0 0;0 -1.5;0 0" dur="1.2s" repeatCount="indefinite"/></g>`)
        }
      } else if (cell.kind === 'stairs') {
        const id = def('c-tile-stairs', 'tile-stairs', TILE - 2)
        if (id !== undefined) {
          parts.push(`<use href="#${id}" x="${x}" y="${y}"/>`)
        }
      } else if (cell.kind === 'monster') {
        parts.push(`<path d="M${x + 7} ${y + 7}l10 10m0 -10l-10 10" stroke="#ff6b6b" stroke-width="3" stroke-linecap="round"/>`)
      }
      return
    }
    // まだのマス: 残りの回数でタイルを変える（1 = 土、2 = 岩、3 以上 = 硬い岩）
    const tile = cell.hp >= 3 ? 'tile-hardrock' : cell.hp === 2 ? 'tile-rock' : 'tile-dirt'
    const id = def(`t-${tile}`, tile, TILE)
    if (id !== undefined) {
      parts.push(`<use href="#${id}" x="${x}" y="${y}"/>`)
    } else {
      parts.push(`<rect x="${x}" y="${y}" width="${TILE}" height="${TILE}" fill="#6b5236"/>`)
    }
    if (input.glimpse[index] === true) {
      // 鉱脈の光: ゆっくり明滅するきらめき
      parts.push(
        `<path d="M${x + 12} ${y + 5}l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" fill="#fff6c2"><animate attributeName="opacity" values="0.3;1;0.3" dur="1.4s" begin="${((index % 5) * 0.2).toFixed(1)}s" repeatCount="indefinite"/></path>`,
      )
    }
    if (input.diggable[index] === true) {
      parts.push(`<rect x="${x + 1}" y="${y + 1}" width="${TILE - 2}" height="${TILE - 2}" fill="none" stroke="#ffd60a" stroke-width="1" opacity="0.85"/>`)
    } else {
      parts.push(`<rect x="${x}" y="${y}" width="${TILE}" height="${TILE}" fill="#000" opacity="0.35"/>`)
    }
  })

  return svg(width, height, `<defs>${[...defs.values()].join('')}</defs>${parts.join('')}`)
}
