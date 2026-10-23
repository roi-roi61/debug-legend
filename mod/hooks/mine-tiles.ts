import type { Sprite } from '../types'
import { ART } from './art.generated'
import { mineBg } from './icon-art'
import { GEMS, ORES, layerOf } from './mine'
import { halfSprite, spriteHeight, spritePaths, spriteWidth, svg } from './sprite'
import { CHAPTERS } from './world'

// 鉱山の絵 2（Opus）: 1 マスずつの絵（すき間なく並べて 1 枚の地図に見せ、押せるマスにだけ文字のないボタンを重ねる）と、鉱山のボス戦の絵。
// デスクトップでは絵そのものは押せない（押せるのは文字のボタンだけ）ため。

export const TILE_PX = 24

const BOSS_ART = ['mine-boss-copper', 'mine-boss-iron', 'mine-boss-crystal', 'mine-boss-mithril', 'mine-boss-adamant']

function fit(sprite: Sprite, size: number): { body: string; k: number; w: number; height: number } {
  const small = spriteWidth(sprite) > size * 1.5 ? halfSprite(sprite) : sprite
  const w = spriteWidth(small)
  const height = spriteHeight(small)

  return { body: spritePaths(small), k: size / Math.max(w, height), w, height }
}

/** 開いたマスの中身 → 絵の ID（深さで鉱石・宝石が変わる） */
function contentArt(kind: string, floor: number): string | undefined {
  const layer = layerOf(floor)
  const table: Record<string, string | undefined> = {
    ore: ORES[layer],
    gem: GEMS[layer],
    chest: 'chest',
    fossil: 'fossil',
    spring: 'potion-learn',
    diary: 'psi-book',
    monster: ORES[layer],
  }

  return table[kind]
}

/** 鉱山の魔物の姿（深さで変わる。本編の雑魚の絵を使う） */
function monsterArt(floor: number): string {
  const chapter = CHAPTERS[(layerOf(floor) * 2) % CHAPTERS.length]

  return chapter?.enemies[floor % 3] ?? 'null-slime'
}

export type TileInput = { kind: string; hp: number; open: boolean; prize?: { items: Record<string, number>; gold: number; lamps: number; exp: number }; alive?: boolean }

/** 絵の無い賞品の簡単な絵（24 × 24 の中に描く）: 小石・木材・お金・経験値・袋 */
const PRIZE_SHAPES: Record<string, string> = {
  pebble: '<ellipse cx="12" cy="14" rx="7" ry="5" fill="#9a9a9a" stroke="#4a4a4a"/><ellipse cx="10" cy="12.5" rx="2.5" ry="1.4" fill="#d0d0d0"/>',
  wood: '<rect x="4" y="9" width="15" height="7" rx="2" fill="#a0662e" stroke="#4d2c10"/><ellipse cx="19" cy="12.5" rx="2.5" ry="3.5" fill="#e2b77a" stroke="#4d2c10"/><path d="M7 11h8M8 14h6" stroke="#6b3f17"/>',
  gold: '<circle cx="12" cy="12" r="7" fill="#ffd23f" stroke="#8a6400"/><text x="12" y="15.5" font-size="9" text-anchor="middle" fill="#8a6400" font-family="sans-serif" font-weight="bold">G</text>',
  exp: '<path d="M12 4l2.4 5 5.4.6-4 3.7 1.1 5.4L12 16l-4.9 2.7 1.1-5.4-4-3.7 5.4-.6z" fill="#9be7ff" stroke="#2a6a85"/>',
  bag: '<path d="M8 9h8l3 9H5z" fill="#c8a165" stroke="#5a3f1a"/><path d="M9 9l1-3h4l1 3" fill="none" stroke="#5a3f1a"/>',
}

/** 出てきたものの絵の ID: 中身の品の絵（鉱石・宝石など）があればそれ、なければマスの種類の絵 */
function prizeArt(cell: TileInput, floor: number): { artId?: string; shape?: string } {
  const items = Object.keys(cell.prize?.items ?? {})
  const withArt = items.find(id => ART[id] !== undefined)
  const byKind = contentArt(cell.kind, floor)
  if (byKind !== undefined && cell.kind !== 'monster') return { artId: byKind }
  if (withArt !== undefined) return { artId: withArt }
  if (byKind !== undefined) return { artId: byKind }
  const shape = items.map(id => PRIZE_SHAPES[id]).find(v => v !== undefined)
  if (shape !== undefined) return { shape }
  if ((cell.prize?.gold ?? 0) > 0 || (cell.prize?.lamps ?? 0) > 0) return { shape: PRIZE_SHAPES.gold }
  if ((cell.prize?.exp ?? 0) > 0) return { shape: PRIZE_SHAPES.exp }
  return { shape: PRIZE_SHAPES.bag }
}

const tileCache = new Map<string, string>()

/**
 * 1 マスの絵（24 × 24。画面では 2 倍）: まだ = 土 / 岩 / 硬い岩、光る = きらめき、掘れる = 金の縁、掘れない = 暗く、
 * 出てきたもの = 光る縁つきでふわふわ、階段、生きている魔物 = 赤く光る魔物、受け取ったあと = 空の床
 */
export function tileSvg(cell: TileInput, floor: number, diggable: boolean, glimpse: boolean, isCursor = false): string {
  const state = cell.open ? (cell.alive === true ? 'alive' : cell.prize !== undefined ? `prize:${Object.keys(cell.prize.items).join(',')}:${cell.prize.gold > 0 || cell.prize.lamps > 0 ? 'g' : ''}${cell.prize.exp > 0 ? 'x' : ''}` : 'done') : `c${Math.min(3, cell.hp)}${glimpse ? 'g' : ''}${diggable ? 'd' : ''}`
  const key = `${layerOf(floor)}:${floor % 3}:${cell.kind}:${state}${isCursor ? ':cur' : ''}`
  const hit = tileCache.get(key)
  if (hit !== undefined) {
    return hit
  }
  const T = TILE_PX
  const parts: string[] = []
  const draw = (artId: string | undefined, size: number, isBobbing = false): void => {
    const art = artId === undefined ? undefined : ART[artId]
    if (art === undefined) {
      return
    }
    const f = fit(art, size)
    const body = `<g transform="translate(${((T - f.w * f.k) / 2).toFixed(2)} ${((T - f.height * f.k) / 2).toFixed(2)}) scale(${f.k.toFixed(4)})">${f.body}</g>`
    parts.push(isBobbing ? `<g>${body}<animateTransform attributeName="transform" type="translate" values="0 0;0 -1.5;0 0" dur="1.2s" repeatCount="indefinite"/></g>` : body)
  }
  if (!cell.open) {
    draw(cell.hp >= 3 ? 'tile-hardrock' : cell.hp === 2 ? 'tile-rock' : 'tile-dirt', T)
    if (glimpse) {
      parts.push(`<path d="M12 5l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" fill="#fff6c2"><animate attributeName="opacity" values="0.3;1;0.3" dur="1.4s" repeatCount="indefinite"/></path>`)
    }
    parts.push(diggable ? `<rect x="1" y="1" width="${T - 2}" height="${T - 2}" fill="none" stroke="#ffd60a" stroke-width="1.2"/>` : `<rect width="${T}" height="${T}" fill="#000" opacity="0.4"/>`)
  } else {
    parts.push(`<rect width="${T}" height="${T}" fill="#14110d"/>`)
    if (cell.alive === true) {
      parts.push(`<rect width="${T}" height="${T}" fill="#ff3b3b" opacity="0.18"><animate attributeName="opacity" values="0.08;0.3;0.08" dur="1.6s" repeatCount="indefinite"/></rect>`)
      draw(monsterArt(floor), T - 2, true)
    } else if (cell.prize !== undefined) {
      parts.push(`<rect x="1" y="1" width="${T - 2}" height="${T - 2}" fill="none" stroke="#fff3a6" stroke-width="1.2"><animate attributeName="opacity" values="0.35;1;0.35" dur="1.2s" repeatCount="indefinite"/></rect>`)
      const art = prizeArt(cell, floor)
      if (art.artId !== undefined) {
        draw(art.artId, T - 4, true)
      } else if (art.shape !== undefined) {
        parts.push(`<g>${art.shape}<animateTransform attributeName="transform" type="translate" values="0 0;0 -1.5;0 0" dur="1.2s" repeatCount="indefinite"/></g>`)
      }
    } else if (cell.kind === 'stairs') {
      draw('tile-stairs', T - 2)
    }
  }
  // 十字キーで選んでいるマス: 白く点滅する太い枠
  if (isCursor) {
    parts.push(`<rect x="0.75" y="0.75" width="${T - 1.5}" height="${T - 1.5}" fill="none" stroke="#ffffff" stroke-width="1.5"><animate attributeName="opacity" values="1;0.35;1" dur="0.9s" repeatCount="indefinite"/></rect>`)
  }
  const source = svg(T, T, parts.join(''))
  tileCache.set(key, source)

  return source
}

// ---- 鉱山のボス戦（挑むと、この戦いの絵に切り替わる） ----

export type MineBossFight = { floor: number; won: boolean; seconds: number; limit: number; heroHpLeft: number; bossHpLeft: number; at: number }

const escapeText = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** 鉱山のボスの絵の ID（10 階ごとに 5 種、51 階からくり返し） */
export const mineBossArtId = (floor: number): string => BOSS_ART[Math.max(0, Math.floor(floor / 10) - 1) % BOSS_ART.length] ?? BOSS_ART[0]!

/**
 * 鉱山のボス戦の絵（340 × 160、約 5 秒で 1 回だけ流れる）: 深さの背景、左に主人公、右に鉱山のボス。
 * 主人公が何度も斬りかかり、両方の HP バーが戦いの結果まで減っていく → 勝ち（ボスが崩れて消える）/ 負け（主人公が倒れて暗くなる）
 */
export function mineBossFightSvg(fight: MineBossFight, hero: Sprite, labels: { title: string; win: string; lose: string }): string {
  const W = 340
  const H = 160
  const parts: string[] = []
  const bg = ART[mineBg(fight.floor)]
  parts.push(bg === undefined ? `<rect width="${W}" height="${H}" fill="#1a1712"/>` : `<g transform="scale(4)">${spritePaths(halfSprite(bg))}</g><rect width="${W}" height="${H}" fill="#05060c" opacity="0.35"/>`)
  const fightSeconds = 3.6
  const total = 5.4
  const swings = Math.round(fightSeconds / 0.6)
  // 主人公（左）
  const heroSmall = spriteWidth(hero) > 80 ? halfSprite(hero) : hero
  const hk = 100 / Math.max(spriteWidth(heroSmall), spriteHeight(heroSmall))
  const heroBody = `<g transform="translate(20 ${(H - 8 - spriteHeight(heroSmall) * hk).toFixed(1)}) scale(${hk.toFixed(4)})">${spritePaths(heroSmall)}</g>`
  const lunge = `<animateTransform attributeName="transform" type="translate" values="0 0;90 0;0 0" dur="0.6s" repeatCount="${swings}"/>`
  const heroFall = fight.won ? '' : `<animate attributeName="opacity" values="1;1;0.25" keyTimes="0;${(fightSeconds / total).toFixed(3)};1" dur="${total}s" fill="freeze"/>`
  parts.push(`<g>${heroBody}${lunge}${heroFall}</g>`)
  // ボス（右）
  const bossArt = ART[mineBossArtId(fight.floor)]
  if (bossArt !== undefined) {
    const small = spriteWidth(bossArt) > 80 ? halfSprite(bossArt) : bossArt
    const bk = 112 / Math.max(spriteWidth(small), spriteHeight(small))
    const bx = 316 - spriteWidth(small) * bk
    const body = `<g transform="translate(${bx.toFixed(1)} ${(H - 8 - spriteHeight(small) * bk).toFixed(1)}) scale(${bk.toFixed(4)})">${spritePaths(small)}</g>`
    const hitShake = `<animateTransform attributeName="transform" type="translate" values="0 0;0 0;5 0;0 0" keyTimes="0;0.5;0.6;1" dur="0.6s" repeatCount="${swings}"/>`
    const crumble = fight.won ? `<animate attributeName="opacity" values="1;1;0;0" keyTimes="0;${(fightSeconds / total).toFixed(3)};${((fightSeconds + 0.8) / total).toFixed(3)};1" dur="${total}s" fill="freeze"/>` : ''
    parts.push(`<g>${body}${hitShake}${crumble}</g>`)
  }
  // 斬撃の光
  parts.push(`<path d="M196 50 Q214 80 200 112" fill="none" stroke="#ffffff" stroke-width="5" stroke-linecap="round" opacity="0"><animate attributeName="opacity" values="0;0;1;0" keyTimes="0;0.45;0.55;1" dur="0.6s" repeatCount="${swings}"/></path>`)
  // HP バー（主人公 = 左上、ボス = 右上）
  const bar = (x: number, to: number, color: string): string => {
    const w = 120
    const end = Math.max(0, Math.min(1, to)) * (w - 2)
    return (
      `<rect x="${x}" y="20" width="${w}" height="9" fill="#10131c"/><rect x="${x + 1}" y="21" width="${w - 2}" height="7" fill="#3a1d24"/>` +
      `<rect x="${x + 1}" y="21" width="${w - 2}" height="7" fill="${color}"><animate attributeName="width" values="${w - 2};${end.toFixed(1)}" dur="${fightSeconds}s" fill="freeze"/></rect>`
    )
  }
  parts.push(bar(14, fight.heroHpLeft, '#4cc38a') + bar(W - 134, fight.bossHpLeft, '#ff4d6d'))
  parts.push(`<text x="${W / 2}" y="13" font-size="10" fill="#f2f2f2" text-anchor="middle" font-family="sans-serif" font-weight="bold" stroke="#000" stroke-width="2" paint-order="stroke">${escapeText(labels.title)}</text>`)
  // 結末
  const text = fight.won ? labels.win : labels.lose
  parts.push(
    `<text x="${W / 2}" y="${H / 2 + 6}" font-size="22" fill="${fight.won ? '#fff3b0' : '#c8b8ff'}" text-anchor="middle" font-family="sans-serif" font-weight="bold" stroke="#1a1000" stroke-width="4" paint-order="stroke" opacity="0">${escapeText(text)}` +
      `<animate attributeName="opacity" values="0;0;1" keyTimes="0;${((fightSeconds + 0.6) / total).toFixed(3)};1" dur="${total}s" fill="freeze"/></text>`,
  )

  return svg(W, H, parts.join(''))
}
