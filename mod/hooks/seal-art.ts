import type { Sprite, TrueBossLast } from '../types'
import type { Figure } from './art'
import { ART } from './art.generated'
import { shadowSprite } from './calendar-art'
import { halfSprite, spriteHeight, spritePaths, spriteWidth, svg } from './sprite'
import { CHAPTERS } from './world'

// 封印の間と真のラスボス戦の絵（Opus、docs/DAILY.md の 14 章）。
// 封印の魔法陣: 床の大きな円（ゆっくり回る呪文の輪）のまわりに 10 の台座。魂を捧げた台座にはボスの小さな姿と、章の色の光の柱。
//   中央には始原のバグの影。捧げた数が増えるほど濃くなり、10 個そろうと魔法陣が明るく回り出して、影が本当の色で揺らめく。倒したあとは光だけ。
// 真のラスボス戦: 最後の戦いを 3 段階でふり返る（第 1 形態 → 十の残響（ボスの影が順に現れる）→ 羽が裂けた第 3 形態 → 勝ち / 負け）。

const W = 200
const H = 120

/** 章の色（台座の光の柱・ボスの欠片と同じ考え。色相を 36 度ずつ） */
export const chapterColor = (chapter: number): string => `hsl(${((chapter - 1) * 36) % 360} 85% 62%)`

/** 小さく描くための絵（大きい絵は 1/2 を何度か） */
function shrink(sprite: Sprite, size: number): Sprite {
  let small = sprite
  while (spriteWidth(small) > size * 1.6) {
    small = halfSprite(small)
  }

  return small
}

/** detail: 絵の細かさの上限（ドット）。大きく描く絵も粗めの絵から描いて、Svg の文字数を抑える */
function placed(sprite: Sprite, cx: number, bottom: number, size: number, extra = '', detail = size): string {
  const small = shrink(sprite, detail)
  const k = size / Math.max(spriteWidth(small), spriteHeight(small))
  const x = cx - (spriteWidth(small) * k) / 2
  const y = bottom - spriteHeight(small) * k

  return `<g transform="translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${k.toFixed(4)})"${extra}>${spritePaths(small)}</g>`
}

/** 封印の魔法陣の Svg（200×120） */
export function sealCircleSvg(offered: readonly number[], stage: number, isBeaten: boolean): string {
  const parts: string[] = []
  const bg = ART['bg-seal']
  if (bg !== undefined) {
    parts.push(`<g transform="scale(${(W / 170).toFixed(4)} ${(H / 80).toFixed(4)})">${spritePaths(bg)}</g><rect width="${W}" height="${H}" fill="#070814" opacity="0.45"/>`)
  } else {
    parts.push(`<rect width="${W}" height="${H}" fill="#0b0d1f"/>`)
  }
  const cx = W / 2
  const cy = 86
  const rx = 78
  const ry = 26
  const isComplete = offered.length >= CHAPTERS.length
  const glow = isComplete || isBeaten ? '#9fd8ff' : '#5c6fd6'
  // 魔法陣（床）: 外の輪・内の輪・回る呪文の点線・星形
  const spin = isComplete ? 12 : 40
  parts.push(
    `<g transform="translate(${cx} ${cy}) scale(1 ${(ry / rx).toFixed(3)})">` +
      `<circle r="${rx}" fill="none" stroke="${glow}" stroke-width="2" opacity="0.8"/>` +
      `<circle r="${rx - 9}" fill="none" stroke="${glow}" stroke-width="1" opacity="0.6"/>` +
      `<g><circle r="${rx - 4.5}" fill="none" stroke="${glow}" stroke-width="3" stroke-dasharray="2 5" opacity="0.7"/>` +
      `<animateTransform attributeName="transform" type="rotate" values="0;360" dur="${spin}s" repeatCount="indefinite"/></g>` +
      `<g opacity="0.55"><path d="${starPath(rx - 12)}" fill="none" stroke="${glow}" stroke-width="1.2"/>` +
      `<animateTransform attributeName="transform" type="rotate" values="360;0" dur="${spin * 1.5}s" repeatCount="indefinite"/></g>` +
      (isComplete ? `<circle r="${rx}" fill="${glow}" opacity="0.12"><animate attributeName="opacity" values="0.05;0.25;0.05" dur="2s" repeatCount="indefinite"/></circle>` : '') +
      `</g>`,
  )
  // 中央の影（始原のバグ）。捧げた数で濃く、10 個で本当の色。倒したあとは光の柱だけ。奥の台座のあと、手前の台座の前に描く
  const centerParts: string[] = []
  const moth = ART['boss-origin-moth']
  if (isBeaten) {
    centerParts.push(`<rect x="${cx - 6}" y="0" width="12" height="${cy}" fill="#fff6d6" opacity="0.35"><animate attributeName="opacity" values="0.2;0.5;0.2" dur="3s" repeatCount="indefinite"/></rect>`)
  } else if (moth !== undefined) {
    const opacity = [0.15, 0.3, 0.5, 0.75][Math.min(3, stage)] ?? 0.2
    const body = isComplete ? moth : shadowSprite(moth, '#05060d')
    centerParts.push(
      `<g opacity="${isComplete ? 1 : opacity}">${placed(body, cx, cy - 4, 62)}` +
        `<animateTransform attributeName="transform" type="translate" values="0 0;0 -3;0 0" dur="${isComplete ? 1.8 : 4}s" repeatCount="indefinite"/></g>`,
    )
    if (!isComplete) {
      // ひびの入った封印
      centerParts.push(`<path d="M${cx - 10} ${cy - 30}l6 8-5 6 8 7-3 9" stroke="#c8d4ff" stroke-width="1" fill="none" opacity="${(0.3 + stage * 0.15).toFixed(2)}"/>`)
    }
  }
  // 10 の台座（楕円の上に並べる。奥の台座から描く）
  const altars = CHAPTERS.map((chapter, i) => {
    const angle = (i / CHAPTERS.length) * Math.PI * 2 - Math.PI / 2
    return { chapter: i + 1, boss: chapter.boss, x: cx + Math.cos(angle) * (rx + 2), y: cy + Math.sin(angle) * (ry + 2) }
  }).sort((a, b) => a.y - b.y)
  let isCenterDrawn = false
  for (const altar of altars) {
    if (!isCenterDrawn && altar.y >= cy) {
      parts.push(...centerParts)
      isCenterDrawn = true
    }
    const isLit = offered.includes(altar.chapter)
    const color = chapterColor(altar.chapter)
    parts.push(`<rect x="${(altar.x - 5).toFixed(1)}" y="${(altar.y - 4).toFixed(1)}" width="10" height="6" rx="1" fill="${isLit ? '#3a3f66' : '#23263d'}" stroke="#0a0b14" stroke-width="0.6"/>`)
    if (isLit) {
      parts.push(
        `<rect x="${(altar.x - 3).toFixed(1)}" y="0" width="6" height="${(altar.y - 4).toFixed(1)}" fill="${color}" opacity="0.25"><animate attributeName="opacity" values="0.12;0.35;0.12" dur="${(2 + (altar.chapter % 3) * 0.4).toFixed(1)}s" repeatCount="indefinite"/></rect>`,
      )
      const boss = ART[altar.boss]
      if (boss !== undefined) {
        parts.push(`<g>${placed(boss, altar.x, altar.y - 5, 16)}<animateTransform attributeName="transform" type="translate" values="0 0;0 -1.5;0 0" dur="2.2s" begin="${(altar.chapter * 0.2).toFixed(1)}s" repeatCount="indefinite"/></g>`)
      }
    } else {
      parts.push(`<circle cx="${altar.x.toFixed(1)}" cy="${(altar.y - 7).toFixed(1)}" r="2" fill="#3a3f5a"/>`)
    }
  }

  if (!isCenterDrawn) {
    parts.push(...centerParts)
  }

  return svg(W, H, parts.join(''))
}

/** 五芒星の線（中心 0, 0） */
function starPath(r: number): string {
  const points = Array.from({ length: 5 }, (_, i) => {
    const a = (i * 4 * Math.PI) / 5 - Math.PI / 2
    return `${(Math.cos(a) * r).toFixed(1)} ${(Math.sin(a) * r).toFixed(1)}`
  })

  return `M${points.join('L')}Z`
}

/**
 * 真のラスボス戦のふり返り（340×160 の 1 枚、約 9 秒で 1 回だけ流れる）。
 * 第 1 形態（オリジン・モス）→ 十の残響（ボスの影が 1 体ずつ光って消える）→ 第 3 形態（羽が裂けた姿）→ 勝ち（光の粒になって消え、10 の魂が星になる）/ 負け（暗くなる）
 */
export function trueBossReplaySvg(last: TrueBossLast, hero: Figure, labels: { phase: readonly string[]; win: string; lose: string }): string {
  const SW = 340
  const SH = 160
  const parts: string[] = []
  const bg = ART['bg-void']
  // 背景は 1/2 の絵を 4 倍で（ぼかしたような遠景になり、文字数も 1/3）
  parts.push(bg === undefined ? `<rect width="${SW}" height="${SH}" fill="#05060f"/>` : `<g transform="scale(4)">${spritePaths(halfSprite(bg))}</g><rect width="${SW}" height="${SH}" fill="#04050c" opacity="0.5"/>`)
  const reached = last.phases.length
  const total = 9
  const t1 = 0
  const t2 = reached >= 2 ? 2.4 : 99
  const t3 = reached >= 3 ? 5 : 99
  const tEnd = Math.min(7.4, reached >= 3 ? 7.4 : reached >= 2 ? 5 : 2.4)
  const show = (from: number, to: number) =>
    `<animate attributeName="opacity" values="0;0;1;1;0;0" keyTimes="0;${(from / total).toFixed(3)};${((from + 0.3) / total).toFixed(3)};${(Math.max(from + 0.3, to - 0.3) / total).toFixed(3)};${(to / total).toFixed(3)};1" dur="${total}s" fill="freeze"/>`
  // 主人公（左）
  const heroSmall = shrink(hero.sprite, 64)
  const hk = 96 / Math.max(spriteWidth(heroSmall), spriteHeight(heroSmall))
  parts.push(`<g transform="translate(18 ${(SH - 8 - spriteHeight(heroSmall) * hk).toFixed(1)}) scale(${hk.toFixed(4)})">${spritePaths(heroSmall)}</g>`)
  // 第 1 形態
  const moth1 = ART['boss-origin-moth']
  const moth3 = ART['boss-origin-moth-2'] ?? moth1
  if (moth1 !== undefined) {
    parts.push(`<g opacity="0">${placed(moth1, 240, SH - 10, 128, '', 72)}${show(t1, Math.min(t2, tEnd))}</g>`)
  }
  // 十の残響: ボスの影が順に光る
  if (reached >= 2) {
    CHAPTERS.forEach((chapter, i) => {
      const boss = ART[chapter.boss]
      if (boss === undefined) {
        return
      }
      const from = t2 + i * 0.24
      parts.push(`<g opacity="0">${placed(shadowSprite(boss, '#7d5cff'), 230 + (i % 2) * 24, SH - 14, 72, '', 20)}${show(from, from + 0.5)}</g>`)
    })
  }
  if (reached >= 3 && moth3 !== undefined) {
    parts.push(`<g opacity="0">${placed(moth3, 240, SH - 10, 128, '', 72)}${show(t3, tEnd + (last.won ? 0 : 1.6))}</g>`)
  }
  // 段階の名前
  ;[t1, t2, t3].forEach((from, i) => {
    if (from < 90) {
      parts.push(`<text x="${SW / 2}" y="22" font-size="13" fill="#e8dcff" text-anchor="middle" font-family="sans-serif" font-weight="bold" stroke="#120a24" stroke-width="3" paint-order="stroke" opacity="0">${labels.phase[i] ?? ''}${show(from, from + 1.4)}</text>`)
    }
  })
  // 結末
  if (last.won) {
    // 光の粒になって消える → 10 の魂が星になって昇る
    parts.push(`<circle cx="240" cy="90" r="4" fill="#ffffff" opacity="0"><animate attributeName="r" values="4;4;120" keyTimes="0;${(tEnd / total).toFixed(3)};1" dur="${total}s" fill="freeze"/><animate attributeName="opacity" values="0;0;0.9;0" keyTimes="0;${(tEnd / total).toFixed(3)};${((tEnd + 0.5) / total).toFixed(3)};1" dur="${total}s" fill="freeze"/></circle>`)
    CHAPTERS.forEach((_, i) => {
      const x = 150 + i * 18
      parts.push(`<circle cx="${x}" cy="120" r="2.5" fill="${chapterColor(i + 1)}" opacity="0"><animate attributeName="cy" values="120;120;${20 + (i % 3) * 8}" keyTimes="0;${((tEnd + 0.3) / total).toFixed(3)};1" dur="${total}s" fill="freeze"/><animate attributeName="opacity" values="0;0;1" keyTimes="0;${((tEnd + 0.3) / total).toFixed(3)};1" dur="${total}s" fill="freeze"/></circle>`)
    })
    parts.push(`<text x="${SW / 2}" y="${SH / 2}" font-size="20" fill="#fff3b0" text-anchor="middle" font-family="sans-serif" font-weight="bold" stroke="#2a1a00" stroke-width="4" paint-order="stroke" opacity="0">${labels.win}<animate attributeName="opacity" values="0;0;1" keyTimes="0;${((tEnd + 0.6) / total).toFixed(3)};1" dur="${total}s" fill="freeze"/></text>`)
  } else {
    parts.push(`<rect width="${SW}" height="${SH}" fill="#000000" opacity="0"><animate attributeName="opacity" values="0;0;0.6" keyTimes="0;${((tEnd + 0.8) / total).toFixed(3)};1" dur="${total}s" fill="freeze"/></rect>`)
    parts.push(`<text x="${SW / 2}" y="${SH / 2}" font-size="16" fill="#c8b8ff" text-anchor="middle" font-family="sans-serif" font-weight="bold" opacity="0">${labels.lose}<animate attributeName="opacity" values="0;0;1" keyTimes="0;${((tEnd + 1) / total).toFixed(3)};1" dur="${total}s" fill="freeze"/></text>`)
  }

  return svg(SW, SH, parts.join(''))
}
