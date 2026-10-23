import type { Sprite } from '../types'
import { ART } from './art.generated'
import { halfSprite, spriteHeight, spritePaths, spriteWidth, svg } from './sprite'

// 農場の絵（Opus）: 農場の背景の下半分に畑の区画を並べ、作物の育ち（種 → 芽 → つぼみ → 実り）を描く。
// バグ（害虫）がいる区画は赤い虫、実った区画はきらめき、金色の作物は金の光。今日の天気で空に雨・日差し・虹・嵐・流れ星を重ねる。
// 牧場は大農場の背景の上を家畜がゆっくり歩く。押すのは下のボタン（これは見るための絵）。

const W = 170
const H = 80

export type PlotPicture = { crop?: string; stage: number; hasBug: boolean; isRipe: boolean }

function fit(sprite: Sprite, size: number): { body: string; k: number; w: number; height: number } {
  const small = spriteWidth(sprite) > size * 1.5 ? halfSprite(sprite) : sprite
  const w = spriteWidth(small)
  const height = spriteHeight(small)

  return { body: spritePaths(small), k: size / Math.max(w, height), w, height }
}

/** 天気の重ね絵（空のあたりに） */
function weatherLayer(weather: string): string {
  if (weather === 'rain' || weather === 'storm') {
    const drops = Array.from({ length: 18 }, (_, i) => {
      const x = (i * 37) % W
      const delay = ((i * 0.13) % 0.8).toFixed(2)
      return `<path d="M${x} -6l-3 8" stroke="#9fd3ff" stroke-width="1" opacity="0.7"><animateTransform attributeName="transform" type="translate" values="0 0;-10 70" dur="0.8s" begin="${delay}s" repeatCount="indefinite"/></path>`
    }).join('')
    const dark = weather === 'storm' ? `<rect width="${W}" height="${H}" fill="#1b2235" opacity="0.35"/><rect width="${W}" height="${H}" fill="#ffffff" opacity="0"><animate attributeName="opacity" values="0;0;0.6;0;0" keyTimes="0;0.9;0.92;0.95;1" dur="5s" repeatCount="indefinite"/></rect>` : ''
    return dark + drops
  }
  if (weather === 'sunny') {
    return `<circle cx="${W - 18}" cy="12" r="16" fill="#fff4b0" opacity="0.35"><animate attributeName="r" values="14;18;14" dur="3s" repeatCount="indefinite"/></circle>`
  }
  if (weather === 'rainbow') {
    const colors = ['#ff5a5a', '#ffb347', '#fff275', '#7be37b', '#6ab7ff', '#b38bff']
    return colors.map((color, i) => `<path d="M10 46 A 75 50 0 0 1 160 46" fill="none" stroke="${color}" stroke-width="2" opacity="0.45" transform="translate(0 ${i * 2})"/>`).join('')
  }
  if (weather === 'meteor') {
    return `<path d="M20 2l-14 10" stroke="#fffbd1" stroke-width="1.5" opacity="0"><animateTransform attributeName="transform" type="translate" values="0 0;120 18" dur="2.6s" repeatCount="indefinite"/><animate attributeName="opacity" values="0;1;0" dur="2.6s" repeatCount="indefinite"/></path>`
  }
  if (weather === 'cloudy') {
    return `<rect width="${W}" height="${H}" fill="#9aa3b5" opacity="0.15"/>`
  }

  return ''
}

/**
 * 畑の絵（1 ページ 12 区画まで。6 区画なら 1 段、7 区画以上は 2 段）。isGreenhouse なら背景を温室の色合いにする
 */
export function fieldSvg(plots: readonly PlotPicture[], weather: string, isBig: boolean, isGreenhouse: boolean): string {
  const parts: string[] = []
  const defs = new Map<string, string>()
  const use = (artId: string, size: number, x: number, y: number): string => {
    const art = ART[artId]
    if (art === undefined) {
      return ''
    }
    const id = `f-${artId}-${size}`
    if (!defs.has(id)) {
      const f = fit(art, size)
      defs.set(id, `<g id="${id}" transform="translate(${((size - f.w * f.k) / 2).toFixed(2)} ${(size - f.height * f.k).toFixed(2)}) scale(${f.k.toFixed(4)})">${f.body}</g>`)
    }
    return `<use href="#${id}" x="${x.toFixed(1)}" y="${y.toFixed(1)}"/>`
  }

  const bg = ART[isBig ? 'bg-farm-big' : 'bg-farm']
  parts.push(bg === undefined ? `<rect width="${W}" height="${H}" fill="#6fa857"/>` : spritePaths(bg))
  if (isGreenhouse) {
    parts.push(`<rect width="${W}" height="${H}" fill="#bfefff" opacity="0.25"/><path d="M0 0 L${W / 2} -10 L${W} 0" stroke="#e8fbff" stroke-width="2" fill="none" opacity="0.6"/>`)
  } else {
    parts.push(weatherLayer(weather))
  }

  const perRow = plots.length > 6 ? Math.ceil(plots.length / 2) : plots.length
  const rows = Math.max(1, Math.ceil(plots.length / Math.max(1, perRow)))
  const cell = Math.min(24, Math.floor((W - 8) / Math.max(1, perRow)))
  const top = H - rows * (cell + 2) - 2
  plots.forEach((plot, i) => {
    const col = i % perRow
    const row = Math.floor(i / perRow)
    const x = (W - perRow * cell) / 2 + col * cell
    const y = top + row * (cell + 2)
    // 土の畝
    parts.push(`<rect x="${(x + 1).toFixed(1)}" y="${(y + cell * 0.55).toFixed(1)}" width="${cell - 2}" height="${(cell * 0.45).toFixed(1)}" rx="2" fill="#5b3a22"/><rect x="${(x + 2).toFixed(1)}" y="${(y + cell * 0.6).toFixed(1)}" width="${cell - 4}" height="2" fill="#7a5233"/>`)
    if (plot.crop === undefined) {
      return
    }
    const art = plot.stage >= 3 ? `crop-${plot.crop}` : `crop-sprout-${Math.min(3, plot.stage + 1)}`
    const size = plot.stage >= 3 ? cell - 2 : cell - 4
    parts.push(use(art, size, x + (cell - size) / 2, y + (cell - size) - 2))
    if (plot.isRipe) {
      parts.push(`<path d="M${(x + cell - 6).toFixed(1)} ${(y + 2).toFixed(1)}l1.5 3.5 3.5 1.5-3.5 1.5-1.5 3.5-1.5-3.5-3.5-1.5 3.5-1.5z" fill="#fff6c2"><animate attributeName="opacity" values="0.2;1;0.2" dur="1.2s" begin="${(i * 0.15).toFixed(2)}s" repeatCount="indefinite"/></path>`)
    }
    if (plot.hasBug) {
      const bx = x + cell * 0.3
      const by = y + cell * 0.45
      parts.push(
        `<g><ellipse cx="${bx.toFixed(1)}" cy="${by.toFixed(1)}" rx="3" ry="2.2" fill="#d63a3a" stroke="#2a0a0a" stroke-width="0.6"/><path d="M${(bx - 3).toFixed(1)} ${by.toFixed(1)}h-2M${(bx + 3).toFixed(1)} ${by.toFixed(1)}h2" stroke="#2a0a0a" stroke-width="0.6"/>` +
          `<animateTransform attributeName="transform" type="translate" values="0 0;2 -1;0 0;-2 -1;0 0" dur="1.6s" repeatCount="indefinite"/></g>`,
      )
    }
  })

  return svg(W, H, `<defs>${[...defs.values()].join('')}</defs>${parts.join('')}`)
}

/** 牧場の絵: 大農場の背景の上を、持っている家畜（chicken / cow / sheep / bee）が行ったり来たりする */
export function ranchSvg(animals: readonly string[]): string {
  const parts: string[] = []
  const bg = ART['bg-farm-big']
  parts.push(bg === undefined ? `<rect width="${W}" height="${H}" fill="#6fa857"/>` : spritePaths(bg))
  animals.forEach((kind, i) => {
    const art = ART[`animal-${kind}`]
    if (art === undefined) {
      return
    }
    const size = kind === 'bee' ? 14 : kind === 'cow' ? 26 : 20
    const f = fit(art, size)
    const baseX = 14 + i * 36
    const y = kind === 'bee' ? 30 : H - 6 - f.height * f.k
    const dur = (5 + i * 1.3).toFixed(1)
    const drift = kind === 'bee' ? `values="0 0;20 -6;34 2;12 6;0 0"` : `values="0 0;18 0;18 0;0 0;0 0"`
    parts.push(
      `<g><g transform="translate(${baseX} ${y.toFixed(1)}) scale(${f.k.toFixed(4)})">${f.body}</g>` +
        `<animateTransform attributeName="transform" type="translate" ${drift} dur="${dur}s" repeatCount="indefinite"/></g>`,
    )
  })

  return svg(W, H, parts.join(''))
}
