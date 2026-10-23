import type { RenderElement } from 'claude-code'

import type { $ } from './persist'
import { ART } from './art.generated'
import { FEATURE_BG, FEATURE_NPC, facilitySvg, iconSvg } from './icon-art'
import { petFigure } from './pet-art'
import { bob, spriteHeight, spritePaths, spriteSvg, spriteWidth, svg } from './sprite'

// 毎日の冒険の画面の絵の部品（Opus）: 施設の見出し・案内役の顔・持ち物のアイコン。
// デスクトップ・スマホだけ（ターミナルは Svg が無いので何も出さない＝今までどおりの文字の画面）。
// 注意: .tsx では h という名前の変数を作らない（JSX の h を隠して画面が出なくなる）。

type Els = ReturnType<$['ui']['resolve']>

/** 見出しの絵の大きさ（170×80 を 2 倍） */
const HEADER_SCALE = 2

/** 施設の見出し（背景＋案内役）。key は施設 ID か 'blackmarket'。描けなければ null */
export function facilityHeader(els: Els, key: string, bgId?: string): RenderElement | null {
  if (!('Svg' in els)) {
    return null
  }
  const { Svg } = els
  const source = facilitySvg(bgId ?? FEATURE_BG[key as keyof typeof FEATURE_BG], FEATURE_NPC[key as keyof typeof FEATURE_NPC])
  if (source === undefined) {
    return null
  }

  return <Svg key={`header-${key}-${bgId ?? ''}`} source={source} alt={key} width={170 * HEADER_SCALE} height={80 * HEADER_SCALE} isInteractive />
}

/** 案内役の顔（説明の吹き出しの左）。描けなければ null */
export function npcPortrait(els: Els, featureKey: string, size = 64): RenderElement | null {
  if (!('Svg' in els)) {
    return null
  }
  const { Svg } = els
  const art = ART[FEATURE_NPC[featureKey as keyof typeof FEATURE_NPC] ?? '']
  if (art === undefined) {
    return null
  }
  const artWidth = spriteWidth(art)
  const artHeight = spriteHeight(art)
  const k = size / Math.max(artWidth, artHeight)

  return <Svg key={`npc-${featureKey}`} source={spriteSvg(art)} alt={art.name} width={Math.round(artWidth * k)} height={Math.round(artHeight * k)} />
}

/** 持ち物のアイコン（行の頭に小さく）。絵が無ければ null（文字だけの行になる） */
export function itemIcon(els: Els, id: string, size = 24): RenderElement | null {
  if (!('Svg' in els)) {
    return null
  }
  const { Svg } = els
  // 小さく出すアイコンは 24 ドットの絵で描く（1/2 の絵になり、SVG の文字数が約 1/4。1 画面にたくさん並ぶと、デスクトップが画面ごと出さなくなるため）
  const source = iconSvg(id, size <= 32 ? 24 : 48)
  if (source === undefined) {
    return null
  }

  return <Svg key={`icon-${id}-${size}`} source={source} alt={id} width={size} height={size} />
}

/**
 * ペットの姿（仲間タブのカード・卵を選ぶところ）: ゆっくり跳ねる。好感度が高いとハートが浮かぶ。
 * isShadow なら黒い影（まだ孵っていない卵の中身を見せないとき）
 */
export function petPortrait(els: Els, species: string, form: number, affinity = 0, size = 64): RenderElement | null {
  if (!('Svg' in els)) {
    return null
  }
  const { Svg } = els
  const figure = petFigure(species as never, form)
  if (figure === undefined) {
    return null
  }
  const box = 72
  const k = (size - 8) / Math.max(figure.w, figure.h)
  const x = (box - figure.w * k) / 2
  const y = box - figure.h * k - 4
  const body = bob(`<g transform="translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${k.toFixed(4)})">${spritePaths(figure.sprite)}</g>`, 2, 0.9)
  const shadow = `<ellipse cx="${box / 2}" cy="${box - 3}" rx="${((figure.w * k) / 3).toFixed(1)}" ry="2.5" fill="#000" opacity="0.3"/>`
  const hearts =
    affinity < 50
      ? ''
      : Array.from({ length: affinity >= 100 ? 3 : affinity >= 80 ? 2 : 1 }, (_, i) =>
          `<text x="${box - 12 - i * 9}" y="14" font-size="9" fill="#ff7aa8" opacity="0"><animate attributeName="opacity" values="0;1;0" dur="2.4s" begin="${(i * 0.8).toFixed(1)}s" repeatCount="indefinite"/>` +
          `<animateTransform attributeName="transform" type="translate" values="0 4;0 -4" dur="2.4s" begin="${(i * 0.8).toFixed(1)}s" repeatCount="indefinite"/>♥</text>`,
        ).join('')
  const source = svg(box, box, shadow + body + hearts)
  const scale = size / box

  return <Svg key={`pet-${species}-${form}-${affinity >= 50 ? 'h' : ''}`} source={source} alt={species} width={Math.round(box * scale * 1.25)} height={Math.round(box * scale * 1.25)} isInteractive />
}
