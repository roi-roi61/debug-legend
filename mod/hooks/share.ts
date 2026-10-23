import type { SaveData, ShareMoment } from '../types'
import { heroTitle, itemName, rarityName } from './art'
import { SHARE } from './config'
import { combatPower } from './gear'
import { T } from './texts'
import { chapterOf } from './world'

// X ポスト: X の投稿画面を開くリンク（intent URL）を作るだけ。mod からは何も送らない。
// 本文はゲームの情報（職・Lv・戦闘力・装備・ボス・ステージ）だけ。作業の内容やプロンプトは絶対に入れない。
// ハッシュタグは texts.ts の hashtag（日本語 #デバッグ伝説、英語版では #DebugLegend）。

/** できごとの本文（ハッシュタグの前まで） */
export function momentText(save: SaveData, moment: ShareMoment): string {
  if (moment.kind === 'job') {
    return T.shareJob(T.jobName[moment.job], save.level, combatPower(save))
  }
  if (moment.kind === 'drop') {
    return T.shareDrop(rarityName(moment.item.rarity), itemName(moment.item), moment.item.power)
  }
  if (moment.kind === 'evolve') {
    return T.shareEvolve(heroTitle(moment.job, moment.evolution), save.level, combatPower(save))
  }

  if (moment.kind === 'trueboss') {
    return T.shareTrueBoss(moment.loop)
  }

  return T.shareBoss(T.enemy[chapterOf(moment.chapter).boss] ?? '', moment.chapter, T.chapterName[moment.chapter - 1] ?? '')
}

/** いつでもポストする「いまの状態」の本文 */
export function statusText(save: SaveData): string {
  return T.shareStatus(heroTitle(save.job, save.evolution), save.level, combatPower(save), T.stageName(save.stage.chapter, save.stage.stage))
}

/** X の投稿画面を開く URL。配布ページの URL が決まっていれば付ける */
export function intentUrl(text: string, pageUrl: string = SHARE.pageUrl): string {
  const params = new URLSearchParams({ text: `${text} ${T.hashtag}` })
  if (pageUrl !== '') {
    params.set('url', pageUrl)
  }

  return `${SHARE.intentUrl}?${params.toString().replace(/\+/g, '%20')}`
}
