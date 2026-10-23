import type { Sprite } from '../types'

// ドット絵（文字列配列＋パレット）を SVG にする。M0 のドット絵データもこの形で受け取る。
// 色ごとに 1 本の path にまとめ、横に同じ色が続くところは太さ 1 の線 1 本（M x y.5 h w）にする。
// こうすると 96×96 で約 2 万文字、128×128 のボスでも 4〜5 万文字に収まる（Svg の上限は 131,072 文字）。

export const SVG_LIMIT = 131_072

const cache = new Map<Sprite, string>()

/** ドット絵 1 枚を、左上 (0, 0) から描く path の並びにする。同じ絵は 2 回目から使い回す */
export function spritePaths(sprite: Sprite): string {
  const hit = cache.get(sprite)
  if (hit !== undefined) {
    return hit
  }
  // 色ごとに、線の並びとペンの位置（線を引き終わった所）。2 本目からは前の線の終わりからの相対移動（m）で短く書く
  const byColor = new Map<string, { d: string; x: number; y: number }>()
  sprite.rows.forEach((row, y) => {
    let start = 0
    while (start < row.length) {
      const key = row[start] ?? '.'
      let end = start + 1
      while (end < row.length && row[end] === key) {
        end += 1
      }
      const color = sprite.palette[key]
      if (color !== undefined) {
        const pen = byColor.get(color)
        const move = pen === undefined ? `M${start} ${y}.5` : `m${start - pen.x} ${y - pen.y}`
        byColor.set(color, { d: `${pen?.d ?? ''}${move}h${end - start}`, x: end, y })
      }
      start = end
    }
  })
  const body = [...byColor].map(([color, pen]) => `<path stroke="${color}" d="${pen.d}"/>`).join('')
  cache.set(sprite, body)

  return body
}

export const spriteWidth = (sprite: Sprite): number => Math.max(0, ...sprite.rows.map(row => row.length))

export const spriteHeight = (sprite: Sprite): number => sprite.rows.length

/**
 * 横 width × 縦 height ドットの SVG で中身を包む。
 * isCrisp: 整数倍で大きく出すときはくっきり（crispEdges）、縮めて出すときはなめらかにする。
 */
export function svg(width: number, height: number, body: string, isCrisp = true): string {
  const rendering = isCrisp ? ' shape-rendering="crispEdges"' : ''
  const source = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"${rendering}>${body}</svg>`
  if (source.length > SVG_LIMIT) {
    throw new Error(`SVG が長すぎます（${source.length} 文字）`)
  }

  return source
}

/** ドット絵 1 枚だけの SVG */
export function spriteSvg(sprite: Sprite, isCrisp = true): string {
  return svg(spriteWidth(sprite), spriteHeight(sprite), spritePaths(sprite), isCrisp)
}

/**
 * ゆらゆら上下に揺らす（SMIL。Svg を isInteractive で描くと動く）。
 * @param dy 何ドット揺らすか
 */
export function bob(body: string, dy: number, seconds: number, delay = 0): string {
  return `<g>${body}<animateTransform attributeName="transform" type="translate" values="0 0;0 ${-dy};0 0" dur="${seconds}s" begin="${delay}s" repeatCount="indefinite"/></g>`
}

const shrunk = new Map<Sprite, Sprite>()

/**
 * ドット絵を縦横 1/2 にする（2×2 マスでいちばん多い色。同じ数なら透明でない色）。
 * 帯のように小さく出すところで使う（SVG の文字数がおよそ 1/4 になり、描き直しが軽くなる）。
 */
export function halfSprite(sprite: Sprite): Sprite {
  const hit = shrunk.get(sprite)
  if (hit !== undefined) {
    return hit
  }
  const rows: string[] = []
  for (let y = 0; y < sprite.rows.length; y += 2) {
    let row = ''
    const width = Math.max(sprite.rows[y]?.length ?? 0, sprite.rows[y + 1]?.length ?? 0)
    for (let x = 0; x < width; x += 2) {
      const counts = new Map<string, number>()
      for (const key of [sprite.rows[y]?.[x], sprite.rows[y]?.[x + 1], sprite.rows[y + 1]?.[x], sprite.rows[y + 1]?.[x + 1]]) {
        const k = key === undefined || sprite.palette[key] === undefined ? '.' : key
        counts.set(k, (counts.get(k) ?? 0) + 1)
      }
      let best = '.'
      let most = 0
      for (const [key, count] of counts) {
        if (count > most || (count === most && best === '.')) {
          best = key
          most = count
        }
      }
      row += best
    }
    rows.push(row)
  }
  const half = { rows, palette: sprite.palette }
  shrunk.set(sprite, half)

  return half
}
