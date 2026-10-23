import type { Art, Item, SlotId, Sprite } from '../types'
import { ART } from './art.generated'
import type { Figure } from './art'
import type { Aura } from './art'
import type { HpBar, HpTimeline } from './battle'
import { chestArt, itemArt, rarityColor } from './art'
import { BATTLE } from './config'
import { bob, halfSprite, spritePaths, svg } from './sprite'
import { T } from './texts'

// サイド画面と帯の SVG。動きはすべて SVG の中の SMIL（Svg を isInteractive で描くと動く。スクリプトは使えない）。
// 同じ入力なら同じ文字列を返す（再描画のたびに動きが最初に戻らないように、変わる数字は SVG の外に出す）。

/** 戦闘画面の大きさ（ドット） */
export const SCENE = { w: 340, h: 160, ground: 138 }

/** 章ごとの空と地面の色 */
const CHAPTER_COLORS: readonly [string, string, string, string][] = [
  ['#7ec8f2', '#d9f0ff', '#5b9e4a', '#3f7a34'], // 1 草原
  ['#f2a65e', '#ffe0b3', '#b98a4a', '#8a6233'],
  ['#6a5acd', '#c9c3ff', '#4a6a8a', '#334a63'],
  ['#2b2d42', '#5c6b8a', '#3a3f55', '#24283a'],
]

const colorsFor = (chapter: number) => CHAPTER_COLORS[(chapter - 1) % CHAPTER_COLORS.length] ?? CHAPTER_COLORS[0]!

const OUTLINE = 'font-family="monospace" font-weight="bold" stroke="#1b1b28" stroke-width="3" paint-order="stroke" text-anchor="middle"'

// SVG の中の id は、絵や章ごとに違う名前にする（表示先によっては同じページに複数の Svg が並ぶため）

/** 絵を (x, y) に scale 倍で置く <g>。色違いの絵は hueFilter で定義したフィルターをかける */
function place(figure: Figure, x: number, y: number, extra = ''): string {
  const scale = figure.scale === 1 ? '' : ` scale(${figure.scale})`
  const filter = figure.hue === 0 ? '' : ` filter="url(#hue-${figure.id})"`

  return `<g transform="translate(${x} ${y})${scale}"${filter}${extra}>${spritePaths(figure.sprite)}</g>`
}

const hueFilter = (figure: Figure): string =>
  figure.hue === 0 ? '' : `<defs><filter id="hue-${figure.id}"><feColorMatrix type="hueRotate" values="${figure.hue}"/></filter></defs>`

/** 章の背景の絵（art/export/bg-ch<章>.json、170×80 を 2 倍で描く）。無ければ undefined */
export const backgroundArt = (chapter: number): Art | undefined => ART[`bg-ch${chapter}`]

/** auto: 背景の絵があれば絵、無ければグラデーション / gradient: いつもグラデーション / none: 透明 */
export type Backdrop = 'auto' | 'gradient' | 'none'

/** 波を倒し終えたあと、次の波が歩いて入ってくる長さ（秒） */
export const WAVE_IN = 0.6

/** 移動のあいだに背景が左へ流れる長さ（px） */
const SCROLL = 150

/** 移動の動き（実時間の秒）。elapsed: 移動を始めてからの秒数（途中で描き直したとき用）、total: 移動の全体の長さ */
export type TravelMotion = { elapsed: number; total: number }

/** 移動の残り（実時間の秒）。移動中でなければ 0 */
const leftOf = (travel: TravelMotion | undefined): number => (travel === undefined ? 0 : Math.max(0, travel.total - travel.elapsed))

/** 移動の動きの時間の指定（移動の始まりに合わせる。途中で描き直したときは、その分だけ進んだところから） */
const travelTiming = (travel: TravelMotion): string => `dur="${travel.total.toFixed(2)}s" begin="${(-travel.elapsed).toFixed(2)}s" fill="freeze"`

/** 背景を移動の間だけ左へ流す（同じ絵を 2 つ並べて <use> で使い回す。文字数はほとんど増えない） */
function scrolling(id: string, body: string, travel: TravelMotion | undefined): string {
  if (travel === undefined || leftOf(travel) <= 0) {
    return body
  }

  return (
    `<defs><g id="${id}">${body}</g></defs><g><use href="#${id}"/><use href="#${id}" x="${-SCENE.w}"/>` +
    `<animateTransform attributeName="transform" type="translate" values="${SCROLL} 0;0 0" calcMode="spline" keyTimes="0;1" keySplines="0.3 0 0.6 1" ${travelTiming(travel)}/></g>`
  )
}

/**
 * 戦闘画面のいちばん奥。章の背景の絵があればそれを 2 倍で、無ければ空のグラデーションと丘。
 * 'none' は透明（背景を別の Svg に分けて、その上に重ねるとき）。移動中は左へ流れる。
 */
function background(chapter: number, backdrop: Backdrop = 'auto', travel?: TravelMotion): string {
  const flash = `<defs><filter id="white-${chapter}"><feColorMatrix type="matrix" values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 1 0"/></filter></defs>`
  if (backdrop === 'none') {
    return flash
  }
  const art = backdrop === 'auto' ? backgroundArt(chapter) : undefined
  if (art !== undefined) {
    return `${flash}${scrolling(`bg-${chapter}`, backgroundBody(art), travel)}`
  }
  const [skyTop, skyLow, grass, dirt] = colorsFor(chapter)
  const { w, h, ground } = SCENE
  const hills = `<path fill="${grass}" opacity="0.45" d="M0 ${ground - 18} Q60 ${ground - 46} 120 ${ground - 20} T240 ${ground - 24} T${w} ${ground - 16} V${ground} H0 Z"/>`
  const tiles = Array.from({ length: Math.ceil(w / 20) }, (_, i) => `<rect x="${i * 20}" y="${ground + 6}" width="10" height="3" fill="${dirt}" opacity="0.6"/>`).join('')

  return (
    `${flash}<defs><linearGradient id="sky-${chapter}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${skyTop}"/><stop offset="1" stop-color="${skyLow}"/></linearGradient></defs>` +
    `<rect width="${w}" height="${h}" fill="url(#sky-${chapter})"/>` +
    scrolling(`land-${chapter}`, `${hills}<rect y="${ground}" width="${w}" height="${h - ground}" fill="${grass}"/><rect y="${ground}" width="${w}" height="2" fill="${dirt}"/>${tiles}`, travel)
  )
}

const backgroundBody = (art: Art): string => `<g transform="scale(${SCENE.w / art.w} ${SCENE.h / art.h})">${spritePaths(art)}</g>`

/** 背景の絵だけの Svg（戦闘画面と重ねて表示するとき用）。移動中は左へ流れる */
export function backgroundSvg(chapter: number, travel?: TravelMotion): string | undefined {
  const art = backgroundArt(chapter)

  return art === undefined ? undefined : svg(SCENE.w, SCENE.h, scrolling(`bg-${chapter}`, backgroundBody(art), travel))
}

export type BattleInput = {
  chapter: number
  hero: Figure
  enemy: Figure
  /** 1 回の攻撃のダメージ（見た目の数字） */
  damage: number
  isBoss: boolean
  /** 1 回の攻撃の長さ（秒）。Lv と進化で短くなる */
  attack: number
  /** 進化のオーラ（無ければ null） */
  aura: Aura | null
  /**
   * いまの波（3 匹ずつ）のまだ倒していない敵と、波の中の並びの位置（0〜2）。最初から全員が並んでいて、倒した敵から消える。
   * 省くと enemy 1 匹だけ。ボス戦では使わない
   */
  group?: readonly { figure: Figure; slot: number }[]
  /** いまの波のもとの数（1〜3。並びの位置を決める。倒した敵の場所は空いたまま） */
  groupSize?: number
  /** ボスの登場の演出（BOSS の文字・右から入ってくる）を出すか。ボス戦が始まったばかりのときだけ */
  isBossIntro?: boolean
  /** 進化したばかり（主人公が光りながら大きくなる演出を 1 回出す） */
  isEvolving?: boolean
  /** HP バー（主人公・群れの先頭の敵・ボス）。描いたときの値から、Svg の中の動きで減っていく。省くと出さない */
  hp?: HpTimeline
  /** ボスの名前（画面の上の大きな HP バーに出す） */
  bossName?: string
  /** ステージ移行の画面（暗転 → ステージ名 → 次の群れが現れる、1 回だけ）。sub は下に小さく出す文字。移動中なら移動の途中に出す */
  cut?: { title: string; sub?: string }
  /**
   * 移動中（主人公がその場で走り、背景が左へ流れ、次の群れ・ボスが右から歩いて入ってくる）。
   * そのあいだは攻撃しない。攻撃・ダメージの数字・HP バーの減り始めは、着いてから（移動の残りの秒数のあと）
   */
  travel?: TravelMotion
  /** 群れの残りの数（画面の右上に小さく「残り N 匹」を出す）。省くと出さない。ボス戦では出さない */
  foesLeft?: number
  /** 波を倒し終えたばかり: 次の波が右から短く（WAVE_IN 秒）歩いて入ってくる。移動中は使わない */
  waveIn?: boolean
  /** いま倒れたばかりの敵（白く光って沈みながら消える演出を 1 回出す）。size は、その敵がいた波の数（並びの位置を決める） */
  fallen?: { figure: Figure; slot: number; size: number }
  backdrop?: Backdrop
  /** 一緒に戦うペット（1 匹目は主人公の足元の前、2 匹目は後ろ）。docs/DAILY.md の 7 章 */
  pets?: readonly Figure[]
}

/**
 * ペット: 主人公の足元でぴょこぴょこ跳ね、主人公の攻撃 3 回に 1 回、先頭の敵へ飛びかかって戻る（主人公の斬りとずらす）。
 * 移動中は主人公と一緒に走る（速く跳ねる）。1 匹目（front）は主人公の前、2 匹目は主人公の後ろ。
 */
function petSvg(pet: Figure, x: number, ground: number, attack: number, go: string, front: number, run: number, index: number): string {
  const pw = pet.w * pet.scale
  const ph = pet.h * pet.scale
  const y = ground - ph + 2
  const leap = Math.max(20, Math.round(front - (x + pw) - 2))
  const cycle = (attack * 3).toFixed(2)
  // 2 匹目は 1 匹目と別の攻撃のときに飛ぶ（keyTimes をずらす）
  const at = index === 0 ? [0.7, 0.76, 0.8, 0.9] : [0.36, 0.42, 0.46, 0.56]
  const pounce =
    `<animateTransform attributeName="transform" type="translate" values="0 0;0 0;${(leap * 0.6).toFixed(0)} -14;${leap} 0;0 0;0 0" ` +
    `keyTimes="0;${at[0]};${at[1]};${at[2]};${at[3]};1" dur="${cycle}s"${go} repeatCount="indefinite"/>`
  const hop = `<animateTransform attributeName="transform" type="translate" values="0 0;0 -3;0 0" dur="${index === 0 ? 0.55 : 0.62}s" repeatCount="indefinite" additive="sum"/>`
  const running = run > 0 ? `<animateTransform attributeName="transform" type="translate" values="0 0;0 -6;0 0" dur="0.22s" repeatDur="${run.toFixed(2)}s" additive="sum"/>` : ''
  const shadow = `<ellipse cx="${(x + pw / 2).toFixed(1)}" cy="${ground + 1}" rx="${(pw * 0.32).toFixed(1)}" ry="2" fill="#000000" opacity="0.25"/>`

  return `${shadow}<g>${place(pet, x, y)}${pounce}${hop}${running}</g>`
}

/**
 * 主人公の左端。進化で絵が大きくなるほど（96 → 112 → 128 ドット）左に寄せて、右の敵の群れと重ならないようにする。
 * 足元はどの大きさでも地面にそろえる（battleSvg）。
 */
export const heroX = (width: number): number => (width <= 96 ? 14 : Math.max(2, Math.round(14 - (width - 96) / 2.5)))

/** 群れの i 番目の敵の左端（右端に寄せて、64 ドットずつ重ならずに並べる） */
export function slotX(slot: number, size: number, width = 64): number {
  const gap = 4
  const right = SCENE.w - 6

  return right - (size - slot) * width - (size - 1 - slot) * gap
}

/** 進化したとき: 主人公が足元を中心に小さい姿から少し大きくなって、元の大きさに落ち着く（1 回だけ） */
function evolveIn(body: string, cx: number, feetY: number): string {
  const grow = `<animateTransform attributeName="transform" type="scale" values="0.7;1.12;1" keyTimes="0;0.6;1" dur="1.2s" fill="freeze"/>`

  return `<g transform="translate(${cx} ${feetY})"><g>${grow}<g transform="translate(${-cx} ${-feetY})">${body}</g></g></g>`
}

/** 進化したとき: 白い光が広がって、オーラの色の輪が残り、「進化！」の文字が出る（1 回だけ） */
function evolveFlash(cx: number, cy: number, size: number, color: string): string {
  const r = size * 0.75
  const flash =
    `<circle cx="${cx}" cy="${cy}" r="${r * 0.3}" fill="#ffffff" opacity="0">` +
    `<animate attributeName="r" values="${r * 0.3};${r * 1.4}" dur="0.9s" fill="freeze"/>` +
    `<animate attributeName="opacity" values="0;0.95;0" dur="0.9s" fill="freeze"/></circle>`
  const ring =
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="4" opacity="0">` +
    `<animate attributeName="r" values="${r * 0.5};${r * 1.6}" dur="1.4s" begin="0.3s" fill="freeze"/>` +
    `<animate attributeName="opacity" values="0;0.9;0" dur="1.4s" begin="0.3s" fill="freeze"/></circle>`
  const banner =
    `<text x="${SCENE.w / 2}" y="34" font-size="26" fill="${color}" ${OUTLINE} opacity="0">${T.evoBanner}` +
    `<animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.15;0.8;1" dur="2.4s" begin="0.4s" fill="freeze"/></text>`

  return flash + ring + banner
}

/** SVG の文字に入れる名前（< や & をそのまま入れない） */
const escapeXml = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export const HP_COLORS = { hero: '#4cc38a', foe: '#ff6b6b', boss: '#ff4d6d' }

/**
 * ドット絵ふうの HP バー（黒いふち・暗い中身・色の残り・上に 1 ドットの光）。
 * bar.from から bar.to まで、bar.seconds 秒かけて減っていく（SMIL）。数字が変わるたびに描き直さなくてよいように。
 */
export function hpBarSvg(x: number, y: number, w: number, h: number, bar: HpBar, color: string): string {
  const inner = w - 2
  const from = Math.round(inner * bar.from * 10) / 10
  const to = Math.round(inner * bar.to * 10) / 10
  const delay = bar.delay ?? 0
  const motion =
    bar.seconds > 0 && from !== to ? `<animate attributeName="width" values="${from};${to}" dur="${bar.seconds.toFixed(1)}s"${delay > 0 ? ` begin="${delay.toFixed(2)}s"` : ''} fill="freeze"/>` : ''

  return (
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#10131c"/>` +
    `<rect x="${x + 1}" y="${y + 1}" width="${inner}" height="${h - 2}" fill="#3a1d24"/>` +
    `<rect x="${x + 1}" y="${y + 1}" width="${from}" height="${h - 2}" fill="${color}">${motion}</rect>` +
    `<rect x="${x + 1}" y="${y + 1}" width="${inner}" height="1" fill="#ffffff" opacity="0.25"/>`
  )
}

/** 主人公の後ろのオーラ。段階が上がるほど大きく・明るく・粒と光の筋が増える */
function auraSvg(aura: Aura, cx: number, cy: number): string {
  const id = `aura-${aura.color.slice(1)}-${aura.level}`
  const r = 40 + aura.level * 8
  const pulse = (2.4 - aura.level * 0.35).toFixed(2)
  const glow =
    `<defs><radialGradient id="${id}"><stop offset="0" stop-color="${aura.color}" stop-opacity="1"/><stop offset="0.55" stop-color="${aura.color}" stop-opacity="0.5"/><stop offset="1" stop-color="${aura.color}" stop-opacity="0"/></radialGradient></defs>` +
    `<ellipse cx="${cx}" cy="${cy}" rx="${r}" ry="${r * 1.2}" fill="url(#${id})" opacity="0.6">` +
    `<animate attributeName="opacity" values="${0.4 + aura.level * 0.08};${0.7 + aura.level * 0.07};${0.4 + aura.level * 0.08}" dur="${pulse}s" repeatCount="indefinite"/></ellipse>`
  const sparkles =
    aura.level < 2
      ? ''
      : Array.from({ length: aura.level * 3 }, (_, i) => {
          const x = cx - r + ((i * 37) % (r * 2))
          const dur = (1.2 + (i % 4) * 0.3).toFixed(1)
          return (
            `<circle cx="${x}" cy="${cy + r * 0.8}" r="${1 + (i % 2)}" fill="${aura.color}" opacity="0">` +
            `<animate attributeName="cy" values="${cy + r * 0.8};${cy - r * 1.1}" dur="${dur}s" begin="${(i * 0.23).toFixed(2)}s" repeatCount="indefinite"/>` +
            `<animate attributeName="opacity" values="0;1;0" dur="${dur}s" begin="${(i * 0.23).toFixed(2)}s" repeatCount="indefinite"/></circle>`
          )
        }).join('')
  const rays =
    aura.level < 3
      ? ''
      : `<g opacity="0.35">${Array.from({ length: 8 }, (_, i) => `<path d="M${cx} ${cy} L${cx - 3} ${cy - r * 1.4} L${cx + 3} ${cy - r * 1.4}Z" fill="${aura.color}" transform="rotate(${i * 45} ${cx} ${cy})"/>`).join('')}` +
        `<animateTransform attributeName="transform" type="rotate" values="0 ${cx} ${cy};360 ${cx} ${cy}" dur="${aura.level >= 4 ? 6 : 10}s" repeatCount="indefinite"/></g>`

  return rays + glow + sparkles
}

/**
 * サイド画面の戦闘シーン: 左に主人公、右に敵の群れ（いまの波の 1〜3 匹、最初から全員が並んでいる。ボス戦はボス 1 体）。
 * 主人公が先頭の敵まで踏み込んで斬る → 先頭の敵が白く光ってのけぞる → ダメージ数字。
 * 敵は実際に倒したとき（画面が描き直されたとき）に消える。途中で敵が湧いて出てくる演出はしない。
 * ボスは、ボス戦が始まったばかりのときだけ「BOSS」の文字と一緒に右から入ってくる。
 */
export function battleSvg({ chapter, hero, enemy, damage, isBoss, attack, aura, group, groupSize, foesLeft, waveIn = false, isBossIntro = true, isEvolving = false, hp, bossName, fallen, cut, travel, backdrop = 'auto', pets = [] }: BattleInput): string {
  const t = attack
  // 移動中なら、着くまでの秒数（実時間）。攻撃の動き・ダメージの数字は、そのあとから始まる
  const left = leftOf(travel)
  const moving = travel !== undefined && left > 0 ? travel : undefined
  // 波を倒し終えたばかりなら、次の波が歩いて入ってくるのを待ってから攻撃を始める（移動中は移動の残りを待つ）
  const arriveIn = moving === undefined && waveIn && !isBoss ? WAVE_IN : left
  const go = arriveIn > 0 ? ` begin="${arriveIn.toFixed(2)}s"` : ''
  const crit = t * BATTLE.critEvery
  const { ground } = SCENE
  const foes = isBoss || group === undefined ? [{ figure: enemy, slot: 0 }] : group
  const size = isBoss ? 1 : Math.max(groupSize ?? foes.length, foes.length)
  const target = foes[0]?.figure ?? enemy
  const ew = target.w * target.scale
  const eh = target.h * target.scale
  const heroY = ground - hero.h * hero.scale + 2
  const yOf = (figure: Figure) => ground - figure.h * figure.scale + 2
  const enemyY = yOf(target)
  const xOf = (slot: number, figure: Figure) => (isBoss ? 188 : slotX(slot, size, figure.w * figure.scale))
  const front = xOf(foes[0]?.slot ?? 0, target)

  // 敵の絵は種類ごとに 1 回だけ定義して <use> で使い回す（SVG の文字数を抑える）
  const kinds = [...new Map([...foes, ...(fallen === undefined || isBoss ? [] : [fallen])].map(foe => [foe.figure.id, foe.figure])).values()]
  const foe = kinds.map(figure => `${hueFilter(figure)}<defs><g id="foe-${figure.id}">${place(figure, 0, 0)}</g></defs>`).join('')
  const useOf = (figure: Figure, x: number) => `<use href="#foe-${figure.id}" x="${x}" y="${yOf(figure)}"/>`
  const use = (x: number) => useOf(target, x)

  // 主人公は先頭の敵の手前まで踏み込む（敵が奥にいるほど大きく踏み込む）
  const hw = hero.w * hero.scale
  const hh = hero.h * hero.scale
  const hx = heroX(hw)
  const reach = Math.max(34, Math.round(front - (hx + hw) - 6))
  const heroAura = aura === null ? '' : auraSvg(aura, hx + hw / 2, heroY + hh / 2)
  const strike = `<g>${place(hero, hx, heroY)}<animateTransform attributeName="transform" type="translate" values="0 0;0 0;${reach} 0;${reach} 0;0 0;0 0" keyTimes="0;0.28;0.4;0.46;0.62;1" dur="${t}s"${go} repeatCount="indefinite"/></g>`
  // 移動中: その場で走る（速い上下の揺れと、足元の土ぼこり）
  const dust =
    moving === undefined
      ? ''
      : [0, 0.12].map(
          delay =>
            `<circle cx="${hx + hw * 0.3}" cy="${ground}" r="2" fill="#e8dcc0" opacity="0"><animate attributeName="r" values="2;6" dur="0.24s" begin="${delay}s" repeatDur="${left.toFixed(2)}s"/>` +
            `<animate attributeName="opacity" values="0.8;0" dur="0.24s" begin="${delay}s" repeatDur="${left.toFixed(2)}s"/>` +
            `<animate attributeName="cx" values="${hx + hw * 0.3};${hx + hw * 0.3 - 14}" dur="0.24s" begin="${delay}s" repeatDur="${left.toFixed(2)}s"/></circle>`,
        ).join('')
  const body = moving === undefined ? strike : `<g>${strike}<animateTransform attributeName="transform" type="translate" values="0 0;0 -5;0 0" dur="0.24s" repeatDur="${left.toFixed(2)}s"/></g>${dust}`
  const heroGroup = heroAura + bob(isEvolving ? evolveIn(body, hx + hw / 2, ground + 2) : body, 1, 1.2) + (isEvolving ? evolveFlash(hx + hw / 2, heroY + hh / 2, hh, aura?.color ?? '#ffffff') : '')
  // ペット: 1 匹目は主人公の前の足元、2 匹目は主人公の足元の少し左（どちらも主人公より手前に描く。大きい主人公でも隠れないように）
  const [firstPet, secondPet] = pets
  const run = moving === undefined ? 0 : left
  const petFront =
    (secondPet === undefined ? '' : petSvg(secondPet, Math.max(0, Math.round(hx + hw * 0.18)), ground, t, go, front, run, 1)) +
    (firstPet === undefined ? '' : petSvg(firstPet, Math.round(hx + hw - firstPet.w * firstPet.scale * 0.45), ground, t, go, front, run, 0))
  const slashX = front + Math.min(ew, 64) / 2
  const slash =
    `<path d="M${front - 6} ${enemyY + eh / 2 - 34} Q${slashX} ${enemyY + eh / 2} ${front + 8} ${enemyY + eh / 2 + 34}" fill="none" stroke="#ffffff" stroke-width="5" stroke-linecap="round" opacity="0">` +
    `<animate attributeName="opacity" values="0;0;1;0;0" keyTimes="0;0.4;0.43;0.55;1" dur="${t}s"${go} repeatCount="indefinite"/></path>`

  const hit = `<animateTransform attributeName="transform" type="translate" values="0 0;0 0;${isBoss ? 4 : 9} 0;0 0;0 0" keyTimes="0;0.42;0.47;0.6;1" dur="${t}s"${go} repeatCount="indefinite"/>`
  const flash = `<g filter="url(#white-${chapter})" opacity="0">${use(front)}<animate attributeName="opacity" values="0;0;0.9;0;0.7;0;0" keyTimes="0;0.42;0.45;0.5;0.53;0.58;1" dur="${t}s"${go} repeatCount="indefinite"/></g>`
  // 移動中: 次の群れ（ボス）は画面の右の外から歩いて入ってきて、定位置で止まる（ステージが変わるときは暗転が明けるころに）
  const walkFrom = cut === undefined ? 0.2 : 0.5
  // 先頭の敵が、ちょうど画面の右の外から入ってくる位置から（奥に並ぶ敵はそのぶん遅れて見えてくる）
  const enterFrom = Math.max(40, SCENE.w - front + 6)
  const walkIn = (body: string): string =>
    moving === undefined
      ? body
      : `<g><animateTransform attributeName="transform" type="translate" values="${enterFrom} 0;${enterFrom} 0;0 0" keyTimes="0;${walkFrom};1" ${travelTiming(moving)}/>` +
        `<g>${body}<animateTransform attributeName="transform" type="translate" values="0 0;0 -3;0 0" dur="0.3s" repeatDur="${left.toFixed(2)}s"/></g></g>`
  // 着いてから出すもの（HP バーなど）
  const onArrival = (body: string): string => (arriveIn > 0 ? `<g opacity="0"><set attributeName="opacity" to="1" begin="${arriveIn.toFixed(2)}s" fill="freeze"/>${body}</g>` : body)

  let enemies: string
  if (isBoss) {
    // ボス登場: 白く光りながら右から入ってきて、BOSS の文字が点滅する（ボス戦が始まったばかりのときだけ。
    // 途中で宝箱を開けるなどして描き直しても、登場の演出はくり返さない）
    const delay = moving !== undefined ? left : cut === undefined ? 0 : 1
    const enter =
      isBossIntro && moving === undefined
        ? `<animate attributeName="opacity" values="0;1" dur="0.6s" begin="${delay}s" fill="freeze"/>` +
          `<animateTransform attributeName="transform" type="translate" values="80 0;0 0" dur="0.6s" begin="${delay}s" fill="freeze"/>`
        : ''
    const banner = isBossIntro
      ? `<text x="${SCENE.w / 2}" y="58" font-size="28" fill="#ff4d6d" ${OUTLINE} opacity="0">BOSS` +
        `<animate attributeName="opacity" values="0;1;0;1;0;1;0" dur="2s" begin="${Math.round((delay + 0.2) * 100) / 100}s" fill="freeze"/></text>`
      : ''
    enemies = walkIn(`<g opacity="${isBossIntro && moving === undefined ? 0 : 1}">${enter}<g>${hit}${use(front)}${flash}</g></g>`) + banner
  } else {
    // 群れ: 先頭の敵だけが斬られてのけぞる。ほかは並んだまま揺れて待つ
    const waiting = foes.slice(1).map((foe, i) => bob(useOf(foe.figure, xOf(foe.slot, foe.figure)), 2, 1.1 + i * 0.2, 0.3 * (i + 1))).join('')
    enemies = waiting + `<g>${hit}${use(front)}${flash}</g>`
    if (moving !== undefined) {
      enemies = walkIn(enemies)
    } else if (cut !== undefined) {
      // 次の群れは、移行の画面が明けるときに現れる（湧いて出てくるのではなく、暗転のあとに並んでいる）
      enemies = `<g opacity="0"><animate attributeName="opacity" values="0;1" dur="0.3s" begin="0.8s" fill="freeze"/>${enemies}</g>`
    } else if (waveIn) {
      // 次の波: 右の外から短く歩いて入ってくる
      enemies = `<g><animateTransform attributeName="transform" type="translate" values="${enterFrom} 0;0 0" dur="${WAVE_IN}s" fill="freeze"/>${enemies}</g>`
    }
    if (fallen !== undefined) {
      // 倒れた敵: 白く光って、沈みながら消える（1 回だけ）。そのあとに残るのは、まだ倒していない敵だけ
      const fx = slotX(fallen.slot, fallen.size, fallen.figure.w * fallen.figure.scale)
      const fw = fallen.figure.w * fallen.figure.scale
      const fy = yOf(fallen.figure)
      enemies +=
        `<g><animate attributeName="opacity" values="1;1;0" keyTimes="0;0.35;1" dur="0.7s" fill="freeze"/>` +
        `<animateTransform attributeName="transform" type="translate" values="0 0;0 10" dur="0.7s" fill="freeze"/>` +
        `${useOf(fallen.figure, fx)}<g filter="url(#white-${chapter})" opacity="0.9">${useOf(fallen.figure, fx)}<animate attributeName="opacity" values="0.9;0" dur="0.5s" fill="freeze"/></g></g>` +
        `<circle cx="${fx + fw / 2}" cy="${fy + (fallen.figure.h * fallen.figure.scale) / 2}" r="6" fill="none" stroke="#ffffff" stroke-width="3" opacity="0">` +
        `<animate attributeName="r" values="6;${fw * 0.6}" dur="0.6s" fill="freeze"/><animate attributeName="opacity" values="0.9;0" dur="0.6s" fill="freeze"/></circle>`
    }
  }

  const numberAt = (text: string, size: number, color: string, dur: number, start: number, dy: number) =>
    `<text x="${slashX}" y="${Math.max(24, enemyY - 2) - dy}" font-size="${size}" fill="${color}" ${OUTLINE} opacity="0">${text}` +
    `<animate attributeName="opacity" values="0;0;1;1;0;0" keyTimes="0;${start};${start + 0.02};${start + 0.25};${start + 0.32};1" dur="${dur}s"${go} repeatCount="indefinite"/>` +
    `<animateTransform attributeName="transform" type="translate" values="0 0;0 0;0 -18;0 -18" keyTimes="0;${start};${start + 0.32};1" dur="${dur}s"${go} repeatCount="indefinite"/></text>`
  const critStart = (BATTLE.critEvery - 1 + 0.43) / BATTLE.critEvery
  const numbers =
    numberAt(T.comma(damage), 14, '#ffffff', t, 0.43, 0) +
    numberAt(`${T.crit} ${T.comma(damage * 2)}`, 18, '#ffd60a', crit, critStart, 16)

  // HP バー: 主人公は頭の上、雑魚はそれぞれの頭の上（斬られている先頭だけ減っていく）、ボスは画面の上に名前つきで大きく
  let bars = ''
  if (hp !== undefined) {
    bars += hpBarSvg(Math.round(hx + hw / 2 - 20), Math.max(2, heroY - 7), 40, 5, hp.hero, HP_COLORS.hero)
    let foeBars = ''
    if (isBoss && hp.boss !== null) {
      const name = bossName === undefined ? '' : `<text x="215" y="13" font-size="9" fill="#ffffff" ${OUTLINE.replace('stroke-width="3"', 'stroke-width="2"')}>${escapeXml(bossName)}</text>`
      foeBars += name + hpBarSvg(120, 16, 190, 7, hp.boss, HP_COLORS.boss)
    } else if (!isBoss) {
      for (const [i, member] of foes.entries()) {
        const w = member.figure.w * member.figure.scale
        const bar = i === 0 && hp.front !== null ? hp.front : { from: 1, to: 1, seconds: 0 }
        foeBars += hpBarSvg(Math.round(xOf(member.slot, member.figure) + w / 2 - 18), Math.max(2, yOf(member.figure) - 6), 36, 5, bar, HP_COLORS.foe)
      }
    }
    bars += onArrival(foeBars)
  }

  // 群れの残りの数: 画面の右上に小さく（上の HP バー・ダメージの数字・進化の文字・BOSS の文字と重ならない隅）
  const remain =
    isBoss || foesLeft === undefined || foesLeft <= 0
      ? ''
      : `<text x="${SCENE.w - 6}" y="13" font-size="10" fill="#ffffff" ${OUTLINE.replace('text-anchor="middle"', 'text-anchor="end"').replace('stroke-width="3"', 'stroke-width="2"')}>${escapeXml(T.foesLeft(foesLeft))}</text>`

  // ステージ移行の画面: 暗転して、ステージ名（章の 1 面目は章の名前）が出て、明ける（1 回だけ）。
  // 移動中なら、走り出してから暗転し、明けると次の群れが歩いて入ってくるところ（移動の長さに合わせる）
  const cutFade =
    moving === undefined
      ? `<animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.2;0.7;1" dur="1.3s" fill="freeze"/>`
      : `<animate attributeName="opacity" values="0;0;1;1;0;0" keyTimes="0;0.06;0.2;0.55;0.68;1" ${travelTiming(moving)}/>`
  const cutSvg =
    cut === undefined
      ? ''
      : `<g opacity="0">${cutFade}` +
        `<rect width="${SCENE.w}" height="${SCENE.h}" fill="#0b0d14"/>` +
        `<text x="${SCENE.w / 2}" y="${SCENE.h / 2 + (cut.sub === undefined ? 6 : 0)}" font-size="${cut.sub === undefined ? 22 : 16}" fill="#ffffff" ${OUTLINE}>${escapeXml(cut.title)}</text>` +
        (cut.sub === undefined ? '' : `<text x="${SCENE.w / 2}" y="${SCENE.h / 2 + 20}" font-size="12" fill="#ffd60a" ${OUTLINE}>${escapeXml(cut.sub)}</text>`) +
        `</g>`

  return svg(SCENE.w, SCENE.h, background(chapter, backdrop, moving) + foe + enemies + heroGroup + petFront + slash + numbers + bars + remain + cutSvg)
}

/** 帯の小さな戦闘画面: 主人公と敵が並んで揺れるだけ（簡素に） */
const halfFigure = (figure: Figure): Figure =>
  figure.scale === 1 ? { ...figure, sprite: halfSprite(figure.sprite), w: Math.ceil(figure.w / 2), h: Math.ceil(figure.h / 2) } : { ...figure, scale: figure.scale / 2 }

/** @param travel 移動の残り（実時間の秒）。そのあいだ主人公は小さく走り、着いたら敵が出てくる */
export function bandSvg(fullHero: Figure, fullEnemy: Figure, isBusy: boolean, heroHp?: number, travel = 0, fullPet?: Figure): string {
  // 帯は小さく出すので、絵を 1/2 にしてから描く（縦横比は同じなので、表示の大きさは変わらない）
  const hero = halfFigure(fullHero)
  const enemy = halfFigure(fullEnemy)
  const hw = hero.w * hero.scale
  const hh = hero.h * hero.scale
  const ew = enemy.w * enemy.scale
  const eh = enemy.h * enemy.scale
  const h = Math.max(hh, eh)
  const w = hw + 12 + ew
  // 主人公の HP（細いバー、10% きざみ。ボス戦でだけ減る）を足元に
  const life = heroHp === undefined ? '' : hpBarSvg(Math.round(hw * 0.1), h - 3, Math.round(hw * 0.8), 3, { from: Math.round(heroHp * 10) / 10, to: Math.round(heroHp * 10) / 10, seconds: 0 }, HP_COLORS.hero)
  const idle = bob(place(hero, 0, h - hh), 1, isBusy ? 0.5 : 1.2, travel > 0 ? Math.round(travel * 100) / 100 : 0)
  const runner = travel > 0 ? `<g>${idle}<animateTransform attributeName="transform" type="translate" values="0 0;0 -2;0 0" dur="0.24s" repeatDur="${travel.toFixed(2)}s"/></g>` : idle
  const foe = bob(place(enemy, hw + 12, h - eh), 1, 0.9, 0.3)
  const arrive = Math.max(0, travel - 0.3).toFixed(2)
  const foeIn =
    travel > 0
      ? `<g opacity="0"><animate attributeName="opacity" values="0;1" dur="0.3s" begin="${arrive}s" fill="freeze"/>` +
        `<animateTransform attributeName="transform" type="translate" values="16 0;0 0" dur="0.3s" begin="${arrive}s" fill="freeze"/>${foe}</g>`
      : foe
  // ペット（1 匹目）: 主人公の足元の前で小さく跳ねる
  const pet = fullPet === undefined ? undefined : { ...halfFigure({ ...fullPet, scale: 1 }), scale: fullPet.scale }
  const petBody =
    pet === undefined
      ? ''
      : bob(place(pet, Math.round(hw - pet.w * pet.scale * 0.55), Math.round(h - pet.h * pet.scale)), 2, travel > 0 ? 0.24 : 0.55)
  const body = hueFilter(enemy) + runner + petBody + foeIn + life

  return svg(w, h, body, false)
}

// ---- 宝箱 ----

/** 宝箱の絵を「ふた」と「箱」に分ける（上から 42% をふたとして、開く演出で動かす） */
const chestParts = new Map<Sprite, { lid: Sprite; box: Sprite; split: number }>()

function splitChest(art: Art): { lid: Sprite; box: Sprite; split: number } {
  const hit = chestParts.get(art)
  if (hit !== undefined) {
    return hit
  }
  const split = Math.round(art.h * 0.42)
  const blank = '.'.repeat(art.w)
  const parts = {
    lid: { palette: art.palette, rows: art.rows.map((row, y) => (y < split ? row : blank)) },
    box: { palette: art.palette, rows: art.rows.map((row, y) => (y < split ? blank : row)) },
    split,
  }
  chestParts.set(art, parts)

  return parts
}

/** 64×64 の宝箱の「箱」と「ふた」（絵が無ければ図形）。lid はふたを動かす SMIL を入れる場所 */
function chestBody(lidMotion: string, isLit: boolean): string {
  const art = chestArt()
  if (art !== undefined) {
    const { lid, box } = splitChest(art)
    const scale = 64 / Math.max(art.w, art.h)
    return `<g transform="scale(${scale})">${spritePaths(box)}<g>${spritePaths(lid)}${lidMotion}</g></g>`
  }
  const wood = isLit ? '#a0612b' : '#6b5a4c'
  const dark = isLit ? '#6e3d16' : '#4a3f36'
  const gold = isLit ? '#ffd166' : '#9a9a9a'
  const box = `<rect x="8" y="30" width="48" height="28" rx="3" fill="${wood}" stroke="${dark}" stroke-width="2"/><rect x="8" y="40" width="48" height="4" fill="${gold}"/><rect x="28" y="36" width="8" height="10" rx="1" fill="${gold}" stroke="${dark}"/>`
  const lid = `<g><path d="M8 32 V22 Q32 8 56 22 V32 Z" fill="${wood}" stroke="${dark}" stroke-width="2"/><rect x="30" y="12" width="4" height="20" fill="${gold}"/>${lidMotion}</g>`

  return box + lid
}

/** 宝箱。残りがあるときは光って、ときどき跳ねる */
export function chestSvg(count: number): string {
  const lit = count > 0
  const glow = lit
    ? `<ellipse cx="32" cy="40" rx="30" ry="24" fill="#ffd60a" opacity="0.2"><animate attributeName="opacity" values="0.1;0.4;0.1" dur="1.6s" repeatCount="indefinite"/></ellipse>`
    : ''
  const hop = lit ? `<animateTransform attributeName="transform" type="translate" values="0 0;0 0;0 -4;0 0;0 -2;0 0" keyTimes="0;0.7;0.78;0.86;0.92;1" dur="2.4s" repeatCount="indefinite"/>` : ''

  return svg(64, 64, `${glow}<g>${chestBody('', lit)}${hop}</g>`, chestArt() !== undefined)
}

// ---- 装備のアイコン ----

/** 装備のアイコン（size × size の枠の中）。装備の絵があれば絵、無ければ枠の文字 */
function itemIcon(item: Item, x: number, y: number, size: number): string {
  const color = rarityColor(item.rarity)
  const frame = `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="6" fill="#2a2d3d" stroke="${color}" stroke-width="3"/>`
  const art = itemArt(item)
  if (art === undefined) {
    return `${frame}<text x="${x + size / 2}" y="${y + size * 0.69}" font-size="${size / 2}" fill="${color}" font-family="sans-serif" font-weight="bold" text-anchor="middle">${T.slotGlyph[item.slot]}</text>`
  }
  const inner = size - 8
  const scale = inner / Math.max(art.w, art.h)

  return `${frame}<g transform="translate(${x + 4} ${y + 4}) scale(${scale})">${spritePaths(art)}</g>`
}

/** 装備枠のアイコン（レア度の色の枠＋枠の文字）。空なら点線 */
export function slotSvg(slot: SlotId, item: Item | null): string {
  const glyph = T.slotGlyph[slot]
  if (item === null) {
    return svg(
      40,
      40,
      `<rect x="2" y="2" width="36" height="36" rx="6" fill="#20222e" stroke="#555b6e" stroke-width="2" stroke-dasharray="4 3"/>` +
        `<text x="20" y="26" font-size="16" fill="#555b6e" font-family="sans-serif" text-anchor="middle">${glyph}</text>`,
      false,
    )
  }
  const color = rarityColor(item.rarity)
  const shine =
    item.rarity >= 3
      ? `<rect x="2" y="2" width="36" height="36" rx="6" fill="none" stroke="${color}" stroke-width="4" opacity="0.5"><animate attributeName="opacity" values="0.2;0.8;0.2" dur="1.8s" repeatCount="indefinite"/></rect>`
      : ''

  return svg(40, 40, itemIcon(item, 2, 2, 36) + shine, false)
}

/**
 * 宝箱を開ける演出: ふたが開く → 中から光があふれる（レア度の色の光の筋と柱）→ 装備のアイコンが飛び出す。
 * 新しいドロップのたびに id が変わって SVG が変わるので、そのたびに最初から再生される。
 */
export function dropSvg(item: Item): string {
  const color = rarityColor(item.rarity)
  const w = 96
  const h = 112
  const chestTop = h - 56
  // ふた: 左下の角を軸に少し持ち上がって傾く（0〜0.3 秒）
  const lidMotion =
    `<animateTransform attributeName="transform" type="translate" values="0 0;0 -6" dur="0.3s" fill="freeze"/>` +
    `<animateTransform attributeName="transform" type="rotate" values="0 8 32;-16 8 32" dur="0.3s" fill="freeze" additive="sum"/>`
  const chest = `<g transform="translate(${(w - 56) / 2} ${chestTop}) scale(0.875)">${chestBody(lidMotion, true)}</g>`
  const cx = w / 2
  const cy = chestTop + 16
  // 箱の口から上に、扇形の光の筋とやわらかい光（レア度が高いほど筋が多い）
  const count = 6 + item.rarity * 2
  const rays = Array.from({ length: count }, (_, i) => {
    const angle = (i - (count - 1) / 2) * (120 / count)
    return `<path d="M${cx} ${cy} L${cx - 2.5} ${cy - 52} L${cx + 2.5} ${cy - 52}Z" fill="${color}" transform="rotate(${angle.toFixed(1)} ${cx} ${cy})"/>`
  }).join('')
  const glowId = `burst-${item.id}`
  const burst =
    `<defs><radialGradient id="${glowId}"><stop offset="0" stop-color="#ffffff" stop-opacity="0.95"/><stop offset="0.4" stop-color="${color}" stop-opacity="0.6"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></radialGradient></defs>` +
    `<g opacity="0"><circle cx="${cx}" cy="${cy}" r="40" fill="url(#${glowId})"/>${rays}<animate attributeName="opacity" values="0;1;0.45" keyTimes="0;0.3;1" dur="1.1s" begin="0.25s" fill="freeze"/>` +
    (item.rarity >= 2 ? `<animate attributeName="opacity" values="0.35;0.7;0.35" dur="1.4s" begin="1.35s" repeatCount="indefinite"/>` : '') +
    `</g>`
  const pillar =
    `<defs><linearGradient id="pillar-${item.id}" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="${color}" stop-opacity="0.9"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>` +
    `<rect x="${cx - 10 - item.rarity}" y="0" width="${20 + item.rarity * 2}" height="${cy}" fill="url(#pillar-${item.id})" opacity="0">` +
    `<animate attributeName="opacity" values="0;1;0.55" keyTimes="0;0.3;1" dur="1.2s" begin="0.3s" fill="freeze"/></rect>`
  const icon =
    `<g opacity="0"><animate attributeName="opacity" values="0;1" dur="0.15s" begin="0.45s" fill="freeze"/>` +
    `<animateTransform attributeName="transform" type="translate" values="0 ${cy - 22};0 -6;0 0" keyTimes="0;0.7;1" dur="0.5s" begin="0.45s" fill="freeze"/>` +
    `${itemIcon(item, cx - 18, 4, 36)}</g>`

  return svg(w, h, burst + pillar + chest + icon, false)
}

export type BattleScene = { single: string } | { back: string; front: string } | { single: string; isFallback: true }

/**
 * 戦闘画面の Svg。1 枚に収まれば 1 枚、上限を超えるなら「背景の Svg」と「透明な戦闘の Svg」の 2 枚に分けて重ねる。
 * 背景の絵だけで上限を超えるときは、背景をグラデーションに戻して 1 枚にする。
 */
export function battleScene(input: BattleInput): BattleScene {
  const attempt = (make: () => BattleScene): BattleScene | undefined => {
    try {
      return make()
    } catch {
      return undefined // Svg の文字数の上限を超えた
    }
  }
  const split = (value: BattleInput): BattleScene | undefined => {
    const back = backgroundSvg(value.chapter, value.travel)
    return back === undefined ? undefined : { back, front: battleSvg({ ...value, backdrop: 'none' }) }
  }
  // 大きな絵どうし（128 ドットの主人公 + 128 ドットのボス + 背景）でも収まるように、順に試す:
  // 1 枚 → 背景と戦闘の 2 枚 → 背景をグラデーションにして 1 枚 → 主人公を粗い絵にして 2 枚 → 主人公も敵も粗い絵でグラデーション
  // ペットは小さいので、主人公より先に粗い絵にする
  const coarsePets = { ...input, pets: input.pets?.map(coarsePet) }
  const coarseHero = { ...coarsePets, hero: coarse(input.hero) }
  const allCoarse = { ...coarseHero, enemy: coarse(input.enemy), group: input.group?.map(foe => ({ ...foe, figure: coarse(foe.figure) })) }

  return (
    attempt(() => ({ single: battleSvg(input) })) ??
    attempt(() => split(input) ?? (undefined as never)) ??
    attempt(() => (input.pets === undefined || input.pets.length === 0 ? undefined : split(coarsePets)) ?? (undefined as never)) ??
    attempt(() => ({ single: battleSvg({ ...input, backdrop: 'gradient' }), isFallback: true })) ??
    attempt(() => split(coarseHero) ?? (undefined as never)) ??
    attempt(() => ({ single: battleSvg({ ...coarseHero, backdrop: 'gradient' }), isFallback: true })) ?? {
      single: battleSvg({ ...allCoarse, backdrop: 'gradient' }),
      isFallback: true,
    }
  )
}

/** 粗い絵（縦横 1/2 のドット絵を 2 倍で描く。見た目の大きさは同じで、SVG の文字数はおよそ 1/4） */
/** ペットの粗い絵（縮めて描いているので、縮尺に関係なく 1/2 にして 2 倍で描く） */
const coarsePet = (figure: Figure): Figure => ({ ...figure, sprite: halfSprite(figure.sprite), w: Math.ceil(figure.w / 2), h: Math.ceil(figure.h / 2), scale: figure.scale * 2 })

function coarse(figure: Figure): Figure {
  return figure.scale === 1 || figure.scale % 2 === 0
    ? { ...figure, sprite: halfSprite(figure.sprite), w: Math.ceil(figure.w / 2), h: Math.ceil(figure.h / 2), scale: figure.scale * 2 }
    : figure
}

