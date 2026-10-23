import type { AdventurerId, BattleReport, Drop, FeatureId, JobId, Language, PetSpecies, SaveData, Settings, SlotId } from '../types'
import type { Effect } from './audio'
import { dropEffect, playEffect, syncBgm } from './audio'
import { heroTitle, itemName, rarityName } from './art'
import { challengeBoss, changeJob, evolve } from './battle'
import { markSeen, priceUnit } from './calendar'
import { claimCodex, recordDish, syncCodex } from './codex'
import { challengeTrueBoss, offerSoul, runTrial, startHardLoop } from './seal'
import type { TrialResult, TrueBossRun } from './seal'
import { addBuff } from './buffs'
import { hasPsychicNode, learnPsychic as learnPsychicPure, recordPsychicProc, resetPsychic as resetPsychicPure } from './psychic'
import { note } from './debuglog'
import { claimAchievement, claimMission, count as countUp, swapDaily } from './missions'
import { canDig, collectCell, ensureFloor, fightBoss, goToFloor, isMineOpen, picksOf, rollMine, swing, toggleAuto, toggleBombMode, upgradePickaxe, useBomb } from './mine'
import {
  buildDecor, buildGreenhouse, buyAnimal, buyFlowerSeed, chooseSignName, collectAnimal, cook as cookFood, expandFarm, farmLevel, feedAnimal,
  fertilize as fertilizeFarmPlot, harvest as harvestFarmPlot, installSprinkler, killPest, patAnimal, plant as plantFarmCrop,
} from './farm'
import { collect as collectGoldMine, fixDerail, pickNugget, smeltGoldIngot, upgrade as upgradeGoldMine, useGoldCart } from './goldmine'
import type { Upgrade as GoldMineUpgrade } from './goldmine'
import type { Scope } from './missions'
import { claimTrip as claimExpeditionTrip, startTrip as startExpeditionTrip } from './expedition'
import type { ExpeditionSetup } from './expedition'
import { chooseEgg, choosePairEgg, toggleActivePet, equipCollar, evolvePet as evolveCompanionPure, feedPet as feedCompanionPure, patPet as patCompanionPure, removeCollar, renamePet, setActivePet } from './pets'
import { buy, greet, refresh, sellItem, takeAmulet, takeLuckyBag, useItem } from './shop'
import { applyGoldTrim, combine as combineSmithGear, craftBossGear, craftSet, disassemble as disassembleSmithGear, enhance as enhanceSmithGear, equipStashed, inheritPlus, reforge as reforgeSmithGear, sellStashed, weeklyGuardGift } from './smith'
import type { EnhanceResult } from './smith'
import { GEAR, LAMP } from './config'
import { combatPower, pullLamp, resolvePending, sellValue } from './gear'
import type { $ } from './persist'
import { background, load, mutate } from './persist'
import type { BlackMarketItemId } from './premium'
import { buyBlackMarket, buyPremium, exchangeSilver, finishBlackMarketIntro, visitBlackMarket } from './premium'
import { T } from './texts'
import { BOSS_STAGE, chapterOf } from './world'

// ボタンやタイマーから呼ぶゲームの操作。

export const PANE_ID = 'debug-legend'

/** エピック以上が出たときだけトーストと X ポストのボタン（画面の外は控えめに） */
const NOTABLE_FROM = 3

const bestDrop = (drops: readonly Drop[]): Drop | undefined => [...drops].sort((a, b) => b.item.rarity - a.item.rarity)[0]

function logPsychicProcs(before: SaveData | undefined, after: SaveData | undefined): void {
  if (before === undefined || after === undefined || after.psychic.procCount <= before.psychic.procCount) return
  const events = after.psychic.procLog.filter(event => event.total > before.psychic.procCount)
  if (events.length === 0) {
    const count = after.psychic.procCount - before.psychic.procCount
    note(after.psychic.procAt, 'psychic', T.psychicProc(T.psychicNodeName[after.psychic.lastProc] ?? after.psychic.lastProc, count))
    return
  }
  for (const event of events) {
    note(event.at, 'psychic', T.psychicProc(T.psychicNodeName[event.id] ?? event.id, event.count))
  }
}

/** ドロップを知らせる: 効果音（サイド画面を開いているとき）と、エピック以上のトースト（設定でオフにできる） */
export function announce($: $, drops: readonly Drop[], settings: Settings): void {
  const best = bestDrop(drops)
  if (best === undefined) {
    return
  }
  background(playEffect($, dropEffect(best.item.rarity), settings))
  if (best.item.rarity >= NOTABLE_FROM && settings.notifyEpic) {
    $.ui.toast(T.dropToast(rarityName(best.item.rarity), itemName(best.item)))
  }
}

/** エピック以上が出ていれば、X にポストできるできごととして残す */
export function withDropShare(save: SaveData, drops: readonly Drop[], now: number): SaveData {
  const best = bestDrop(drops)

  return best !== undefined && best.item.rarity >= NOTABLE_FROM ? { ...save, share: { kind: 'drop', item: best.item, at: now } } : save
}

/** ランプを最大 count 回叩く。出た装備を返す */
export async function pressLamp($: $, count = 1): Promise<Drop[]> {
  const before = await load($)
  let drops: Drop[] = []
  const save = await mutate($, (current, now, day) => {
    // ほかのプロセスに消されて入れ直すときにも呼ばれるので、出た装備は毎回作り直す
    const pulled: Drop[] = []
    let next = current
    for (let i = 0; i < count; i += 1) {
      const one = pullLamp(next, now)
      if (one === undefined) {
        break
      }
      next = one.save
      pulled.push(one.drop)
    }
    drops = pulled
    if (pulled.length === 0) return current
    // 開けた宝箱の数を数える（日課・週課・実績）
    return syncCodex(withDropShare(countUp(next, 'chests', pulled.length, day), pulled, now))
  })
  if (save !== undefined && drops.length > 0) {
    logPsychicProcs(before, save)
    background(playEffect($, 'lamp', save.settings))
    announce($, drops, save.settings)
  }

  return drops
}

/** 手動確認待ちの装備を決める */
export async function decide($: $, choice: 'equip' | 'sell'): Promise<void> {
  await mutate($, (save, now) => resolvePending(save, choice, now)?.save ?? save)
}

export type Toggle = { [K in keyof Settings]: Settings[K] extends boolean ? K : never }[keyof Settings]
export type Volume = 'bgmVolume' | 'seVolume'

export async function toggleSetting($: $, key: Toggle): Promise<void> {
  await mutate($, save => ({ ...save, settings: { ...save.settings, [key]: !save.settings[key] } }))
  await syncBgm($)
}

/** 音量を 1 段階上げ下げする（0〜10） */
export async function changeVolume($: $, key: Volume, step: number): Promise<void> {
  const save = await mutate($, current => ({ ...current, settings: { ...current.settings, [key]: Math.max(0, Math.min(10, current.settings[key] + step)) } }))
  await syncBgm($)
  if (save !== undefined && key === 'seVolume') {
    await playEffect($, 'drop-common', save.settings)
  }
}

const LANGUAGE_ORDER: readonly Language[] = ['auto', 'ja', 'en']

/** 言語を 自動 → 日本語 → English → 自動 の順に切り替える */
export async function cycleLanguage($: $): Promise<void> {
  await mutate($, save => {
    const next = LANGUAGE_ORDER[(LANGUAGE_ORDER.indexOf(save.settings.language) + 1) % LANGUAGE_ORDER.length] ?? 'auto'
    return { ...save, settings: { ...save.settings, language: next } }
  })
}

/** X ポストのできごとを閉じる */
export async function dismissShare($: $): Promise<void> {
  await mutate($, save => ({ ...save, share: null }))
}

/** タイマーから: 自動ランプがオンなら少しずつ叩く */
export async function autoLamp($: $, save: SaveData | undefined): Promise<void> {
  if (save !== undefined && save.settings.autoLamp && save.lamps > 0 && save.pending === null) {
    await pressLamp($, GEAR.autoLampPerTick)
  }
}

export async function openPane($: $): Promise<string> {
  const opened = await $.ui.open({ id: PANE_ID, title: T.paneTitle })
  background(syncBgm($))

  return opened.isPlaced ? T.paneOpened : T.paneWaiting(opened.reason)
}

/** /dl とステータスタブで使う、いまの状態の行 */
export function summaryLines(save: SaveData, day: string, expNeed: number, stagePercent: number): string[] {
  const daily = save.daily.day === day ? save.daily : { turnLamps: 0, toolGold: 0, tokenBonus: 0 }

  return [
    T.status(save.level, combatPower(save)),
    T.expLine(Math.floor(save.exp), expNeed),
    T.percentIn(T.stageName(save.stage.chapter, save.stage.stage), stagePercent),
    T.summaryDrops(T.drops(save.lamps), LAMP.stockCap, save.gold),
    T.summaryToday(daily.turnLamps, LAMP.dailyTurnCap, daily.toolGold, daily.tokenBonus.toFixed(2)),
    T.summaryTotal(save.totals.turns, save.totals.toolCalls, save.totals.tokens, save.totals.drops),
  ]
}

/**
 * 時間で進んだ結果を知らせる。画面の外（トースト）はボス撃破だけ（設定でオフにできる）。
 * 効果音はサイド画面を開いているときだけ: ボス撃破・ボスに負け・ボス登場・レベルアップ。
 */
export function announceReport($: $, report: BattleReport, before: SaveData, after: SaveData): void {
  const settings = after.settings
  logPsychicProcs(before, after)
  for (const chapter of report.bossWins) {
    if (settings.notifyBoss) {
      $.ui.toast(T.bossWinToast(T.enemy[chapterOf(chapter).boss] ?? ''))
    }
  }
  // 本編のボスを初めて倒して魂を手に入れた（14 日目以降）
  for (const chapter of after.souls) {
    if (!before.souls.includes(chapter) && settings.notifyBoss) {
      $.ui.toast(T.soulToast(chapter, T.enemy[chapterOf(chapter).boss] ?? ''))
    }
  }
  const isBossNow = after.stage.stage >= BOSS_STAGE && !after.isCleared
  const wasBoss = before.stage.stage >= BOSS_STAGE && !before.isCleared
  const effect: Effect | undefined =
    report.bossWins.length > 0 ? 'victory' : report.bossLosses.length > 0 ? 'hit' : isBossNow && !wasBoss ? 'boss-appear' : report.levels > 0 ? 'levelup' : undefined
  if (effect !== undefined) {
    background(playEffect($, effect, settings))
  }
}

/** ボスを倒していれば、X にポストできるできごととして残す */
export function withBossShare(save: SaveData, report: BattleReport, now: number): SaveData {
  const chapter = report.bossWins[report.bossWins.length - 1]

  return chapter === undefined ? save : { ...save, share: { kind: 'boss', chapter, at: now } }
}

/** 転職する */
export async function chooseJob($: $, job: JobId): Promise<boolean> {
  let isChanged = false
  const save = await mutate($, (current, now) => {
    const changed = changeJob(current, job, now)
    isChanged = changed !== undefined
    // X ポストのお知らせは、見習いから初めて職に就いたときだけ（横に移るたびには出さない）
    const isFirst = current.job === 'novice'
    return changed === undefined ? current : isFirst ? { ...changed, share: { kind: 'job', job, at: now } } : changed
  })
  if (isChanged && save !== undefined) {
    background(playEffect($, 'jobchange', save.settings))
  }

  return isChanged
}

/** 進化する */
export async function evolveHero($: $): Promise<boolean> {
  let isEvolved = false
  const save = await mutate($, (current, now) => {
    const evolved = evolve(current)
    isEvolved = evolved !== undefined
    return evolved === undefined ? current : { ...evolved, share: { kind: 'evolve', job: evolved.job, evolution: evolved.evolution, at: now } }
  })
  if (isEvolved && save !== undefined) {
    background(playEffect($, 'jobchange', save.settings))
    $.ui.toast(T.evoDone(heroTitle(save.job, save.evolution)))
  }

  return isEvolved
}

/** 「ボスに挑む」 */
export async function challenge($: $): Promise<void> {
  await mutate($, save => challengeBoss(save) ?? save)
  await syncBgm($)
}

/** 施設の説明を見終わった（タブの NEW の印が消える） */
export async function seeFeature($: $, id: FeatureId): Promise<void> {
  await mutate($, save => markSeen(save, id))
}

/** 施設の説明をもう一度見る */
export async function replayIntro($: $, id: FeatureId): Promise<void> {
  await mutate($, save => ({ ...save, calendar: { ...save.calendar, seen: save.calendar.seen.filter(other => other !== id) } }))
}

/** 称号を付ける（null で外す）。持っていない称号は付けない */
export async function wearTitle($: $, id: string | null): Promise<void> {
  await mutate($, save => (id !== null && !save.titles.owned.includes(id) ? save : { ...save, titles: { ...save.titles, current: id } }))
}

// ---- 商店 ----

/** 変えられなかった（お金が足りない・上限など）ときは false */
async function tryChange($: $, change: (save: SaveData, now: number, day: string) => SaveData | undefined): Promise<boolean> {
  let isDone = false
  await mutate($, (save, now, day) => {
    const next = change(save, now, day)
    isDone = next !== undefined
    // 図鑑: 手に入れた装備・鉱石・金色の作物・料理の印をつける
    return next === undefined ? save : syncCodex(next)
  })

  return isDone
}

export function learnPsychicNode($: $, id: string): Promise<boolean> {
  return tryChange($, save => learnPsychicPure(save, id))
}

export function resetPsychicTree($: $): Promise<boolean> {
  return tryChange($, save => resetPsychicPure(save))
}

export async function activateMidasTouch($: $): Promise<boolean> {
  let activatedAt = 0
  const done = await tryChange($, (save, now, day) => {
    if (!hasPsychicNode(save, 'fortune-10') || save.psychic.midasDay === day) return undefined
    const buffed = addBuff(save, 'midas', 4, { seconds: 10 * 60 })
    if (buffed === undefined) return undefined
    activatedAt = now
    return recordPsychicProc({ ...buffed, psychic: { ...buffed.psychic, midasDay: day } }, 'fortune-10', now)
  })
  if (done) note(activatedAt, 'psychic', T.psychicProc(T.psychicNodeName['fortune-10'] ?? 'fortune-10', 1))
  return done
}

export async function buyGood($: $, id: string, count: number): Promise<boolean> {
  const isDone = await tryChange($, (save, _now, day) => {
    const bought = buy(greet(save, day), day, id, count)
    // 買った回数（まとめ買いも 1 回）を数える
    return bought === undefined ? undefined : countUp(bought, 'shopBuys', 1, day)
  })
  if (isDone) {
    const save = await load($)
    if (save !== undefined) {
      background(playEffect($, 'drop-common', save.settings))
    }
  }

  return isDone
}

export function refreshShop($: $): Promise<boolean> {
  return tryChange($, (save, _now, day) => refresh(save, day))
}

/** 街タブを開いたとき: その日はじめてなら店主にあいさつ（好感度 +2） */
export function greetShop($: $): Promise<boolean> {
  return tryChange($, (save, _now, day) => (save.shop.greetDay === day ? undefined : greet(save, day)))
}

export function sellGood($: $, id: string, count: number): Promise<boolean> {
  return tryChange($, save => sellItem(save, id, count))
}

/** 持ち物を使う（宝箱チケット・薬・伝説箱・神話箱）。箱から出た装備はドロップと同じように知らせる */
export async function useBagItem($: $, id: string): Promise<boolean> {
  const before = await load($)
  const isDone = await tryChange($, (save, now, day) => {
    const used = useItem(save, id, now)
    // 薬を使った回数を数える
    return used === undefined || !id.startsWith('potion-') ? used : countUp(used, 'potions', 1, day)
  })
  const after = await load($)
  if (isDone) logPsychicProcs(before, after)
  if (isDone && after !== undefined && after.lastDrop !== null && after.lastDrop.item.id !== before?.lastDrop?.item.id) {
    announce($, [after.lastDrop], after.settings)
  } else if (!isDone && after !== undefined) {
    $.ui.toast(T.useFailed)
  }

  return isDone
}

export function takeShopAmulet($: $): Promise<boolean> {
  return tryChange($, (save, now, day) => takeAmulet(save, day, now))
}

export function takeShopLuckyBag($: $): Promise<boolean> {
  return tryChange($, (save, _now, day) => takeLuckyBag(save, day))
}

export function buyPremiumGood($: $, id: string): Promise<boolean> {
  return tryChange($, (save, now, day) => buyPremium(save, day, now, id))
}

export function visitNightMarket($: $): Promise<boolean> {
  return tryChange($, (save, now) => visitBlackMarket(save, now))
}

export function buyNightMarketGood($: $, id: BlackMarketItemId): Promise<boolean> {
  return tryChange($, (save, now) => buyBlackMarket(save, now, id))
}

export function finishNightMarketIntro($: $): Promise<boolean> {
  return tryChange($, save => {
    const next = finishBlackMarketIntro(save)
    return next === save ? undefined : next
  })
}

// ---- 鍛冶屋 ----

export async function enhanceGear($: $, id: number, useGuardStone: boolean): Promise<boolean> {
  let result = undefined as EnhanceResult | undefined
  const done = await tryChange($, (save, _now, day) => {
    result = enhanceSmithGear(save, id, useGuardStone)
    if (result === undefined) return undefined
    result = { ...result, save: weeklyGuardGift(result.save, day) ?? result.save }
    return countUp(result.save, 'enhances', 1, day)
  })
  if (done && result !== undefined) {
    $.ui.toast(T.smithAttempt(result.success, result.plus, result.protected))
  }
  return done
}

export function inheritGearPlus($: $, fromId: number, toId: number): Promise<boolean> {
  return tryChange($, save => inheritPlus(save, fromId, toId))
}

export function combineGear($: $, ids: readonly number[]): Promise<boolean> {
  return tryChange($, save => combineSmithGear(save, ids))
}

export function craftSetGear($: $, setId: string, slot: SlotId): Promise<boolean> {
  return tryChange($, save => craftSet(save, setId, slot))
}

export function craftBossGearAction($: $, uniqueId: string): Promise<boolean> {
  return tryChange($, save => craftBossGear(save, uniqueId))
}

export function equipStashGear($: $, id: number): Promise<boolean> {
  return tryChange($, save => equipStashed(save, id))
}

export function sellStashGear($: $, id: number): Promise<boolean> {
  return tryChange($, save => {
    const item = save.stash.find(candidate => candidate.id === id)
    const sold = sellStashed(save, id)
    if (item === undefined || sold === undefined) return sold
    return { ...sold, gold: sold.gold + sellValue(item, save) - sellValue(item) }
  })
}

export function disassembleGear($: $, id: number): Promise<boolean> {
  return tryChange($, save => disassembleSmithGear(save, id))
}

export function reforgeGear($: $, id: number): Promise<boolean> {
  return tryChange($, save => reforgeSmithGear(save, id))
}

// ---- 仲間 ----

export function choosePetEgg($: $, species: PetSpecies): Promise<boolean> {
  return tryChange($, save => chooseEgg(save, species))
}

export function namePet($: $, id: string, name: string): Promise<boolean> {
  return tryChange($, save => renamePet(save, id, name))
}

export function activatePet($: $, id: string): Promise<boolean> {
  return tryChange($, save => setActivePet(save, id))
}

export function patPet($: $, id: string): Promise<boolean> {
  return tryChange($, (save, _now, day) => patCompanionPure(save, id, day))
}

export function feedCompanion($: $, petId: string, item: 'treat' | 'pet-meal'): Promise<boolean> {
  return tryChange($, save => feedCompanionPure(save, item, petId))
}

export function evolveCompanion($: $, id: string): Promise<boolean> {
  return tryChange($, save => evolveCompanionPure(save, id))
}

export function equipPetCollar($: $, petId: string, collar: string): Promise<boolean> {
  return tryChange($, save => equipCollar(save, petId, collar))
}

export function removePetCollar($: $, petId: string): Promise<boolean> {
  return tryChange($, save => removeCollar(save, petId))
}

// ---- 遠征 ----

export function sendExpedition($: $, id: AdventurerId, setup: ExpeditionSetup): Promise<boolean> {
  return tryChange($, (save, now) => startExpeditionTrip(save, id, setup, now))
}

export async function collectExpedition($: $, id: AdventurerId): Promise<boolean> {
  let result = undefined as ReturnType<typeof claimExpeditionTrip>
  const done = await tryChange($, (save, now, day) => {
    result = claimExpeditionTrip(save, id, now)
    return result === undefined ? undefined : countUp(result.save, 'expeditions', 1, day)
  })
  if (done && result !== undefined) {
    const current = await load($)
    const summary = Object.entries(result.items).map(([item, amount]) => T.reward.item(T.bagItem[item] ?? item, amount)).join('・')
    $.ui.toast(T.expClaimToast(T.adventurerName[id] ?? id, T.expOutcomeName[result.outcome] ?? result.outcome, summary, result.gold, result.stars))
    if (result.drop !== undefined && current !== undefined) announce($, [result.drop], current.settings)
  }

  return done
}

// ---- 鉱山 ----

/** 採集タブ（鉱山）を開いたとき: 日付が変わっていれば今日の分に切り替え（星鉄のつるはしの毎日のつるはし）、階を作っておく */
export function visitMine($: $): Promise<boolean> {
  return tryChange($, (save, _now, day) => {
    const next = ensureFloor(rollMine(save, day))

    return next === save || !isMineOpen(save) ? undefined : next
  })
}

/** マスを押した結果: dug = 掘って開けた（賞品はマスに出る）、collected = 賞品をもらった、far = 閉じていてまだ掘れない、nopick = つるはしが無い、none = 何も起きない */
export type DigStatus = 'dug' | 'collected' | 'far' | 'nopick' | 'none'

/** 入れ直すときも、操作した階・周回でだけ行う。別の階にいれば、そちらのマスと行き先は保つ。 */
function mineAction(change: (save: SaveData, now: number, day: string) => SaveData | undefined): (save: SaveData, now: number, day: string) => SaveData | undefined {
  let origin: { floor: number; round: number } | undefined
  return (save, now, day) => {
    origin ??= { floor: save.mine.floor, round: save.mine.round }
    if (save.mine.round !== origin.round) return undefined
    const active = save.mine.floor
    const target = active === origin.floor ? save : goToFloor(save, origin.floor, now)
    if (target === undefined) return undefined
    const next = change(target, now, day)
    return next === undefined || active === origin.floor ? next : goToFloor(next, active, now)
  }
}

/**
 * マスを押す。閉じたマスは掘る（爆弾モードで爆弾があれば、3×3 を爆弾で開ける。爆弾はすぐもらう）、
 * 賞品のある開いたマスはもらう、開いた階段は何も起きない（降りるのは moveMineFloor）。叩いた回数は日課・週課に数える。全部の階を掘り終えて鉱山が新しくなったら、お知らせを出す
 */
export async function digCell($: $, index: number, floor?: number, round?: number): Promise<DigStatus> {
  const before = await load($)
  const result: { status: DigStatus } = { status: 'none' }
  let intent: 'dig' | 'fight' | 'collect' | undefined
  let tool: 'bomb' | 'pick' | undefined
  await tryChange($, mineAction((save, now, day) => {
    result.status = 'none'
    const rolled = rollMine(save, day)
    if (!isMineOpen(rolled)) {
      return undefined
    }
    const floored = ensureFloor(rolled)
    // 画面を出したあとに、ほかのセッションが階や周回を変えていたら押し直してもらう。
    if ((floor !== undefined && floored.mine.floor !== floor) || (round !== undefined && floored.mine.round !== round)) return undefined
    const cell = floored.mine.grid[index]
    if (cell === undefined) {
      return undefined
    }
    const action = !cell.open ? 'dig' : cell.alive === true ? 'fight' : 'collect'
    intent ??= action
    // ほかのセッションが開けたマスで、掘る操作を「取る」や「戦う」に変えない。
    if (action !== intent) return undefined
    if (cell.open && cell.alive !== true) {
      if (cell.prize !== undefined) {
        const next = collectCell(floored, index, now)
        result.status = next === undefined ? 'none' : 'collected'

        return next
      }
      return undefined
    }
    if (!canDig(floored.mine.grid, index)) {
      result.status = 'far'

      return undefined
    }
    tool ??= floored.mine.bomb && (floored.bag.bomb ?? 0) > 0 ? 'bomb' : 'pick'
    if (tool === 'bomb') {
      const next = useBomb(floored, index, now)
      result.status = next === undefined ? 'none' : 'dug'

      return next
    }
    if (picksOf(floored) < 1) {
      result.status = 'nopick'

      return undefined
    }
    const done = swing(floored, index, now, true)
    result.status = done === undefined ? 'none' : 'dug'

    return done === undefined ? undefined : countUp(done.save, 'mineHits', done.hits, day)
  }))
  const { status } = result
  if (status === 'far') $.ui.toast(T.mineFarToast)
  else if (status === 'nopick') $.ui.toast(T.mineNoPickToast)
  else if (status !== 'none') {
    const after = await load($)
    logPsychicProcs(before, after)
    if (before !== undefined && after !== undefined && after.mine.round > before.mine.round) $.ui.toast(T.mineResetToast)
  }

  return status
}

/** 階 floor へ移る（行ったことのある階はどこへでも。deepest + 1 は降りられるときだけ）。新しい階（deepest + 1）に初めて降りたときだけ、降りた回数を数える */
export function moveMineFloor($: $, floor: number): Promise<boolean> {
  let round: number | undefined
  return tryChange($, (save, now, day) => {
    round ??= save.mine.round
    if (save.mine.round !== round) return undefined
    const rolled = rollMine(save, day)
    const next = goToFloor(rolled, floor, now)
    if (next === undefined) {
      return undefined
    }

    return next.mine.deepest > rolled.mine.deepest ? countUp(next, 'stairs', 1, day) : next
  })
}

/** 階段を降りる（次の階。moveMineFloor と同じ動き） */
export function descendMine($: $): Promise<boolean> {
  let floor: number | undefined
  let round: number | undefined
  return tryChange($, (save, now, day) => {
    floor ??= save.mine.floor + 1
    round ??= save.mine.round
    if (save.mine.round !== round) return undefined
    const rolled = rollMine(save, day)
    const next = goToFloor(rolled, floor, now)
    if (next === undefined) {
      return undefined
    }

    return next.mine.deepest > rolled.mine.deepest ? countUp(next, 'stairs', 1, day) : next
  })
}

/** ボスに挑む。勝てば 1、負ければ 0、挑めなければ -1 */
export async function challengeMineBoss($: $): Promise<number> {
  let result = -1
  let floor = 0
  await tryChange($, mineAction((save, now, day) => {
    const rolled = rollMine(save, day)
    const fought = fightBoss(rolled, now)
    result = fought === undefined ? -1 : fought.isWin ? 1 : 0
    floor = rolled.mine.floor

    return fought?.save
  }))
  const save = await load($)
  if (result === 1 && save !== undefined) {
    background(playEffect($, 'victory', save.settings))
    $.ui.toast(T.mineBossWinToast(floor))
  } else if (result === 0 && save !== undefined) {
    background(playEffect($, 'hit', save.settings))
  }

  return result
}

export function toggleBomb($: $): Promise<boolean> {
  return tryChange($, save => toggleBombMode(save))
}

export function toggleAutoMine($: $): Promise<boolean> {
  return tryChange($, (save, now) => toggleAuto(save, now))
}

export async function upgradeMinePickaxe($: $): Promise<boolean> {
  const isDone = await tryChange($, save => upgradePickaxe(save))
  if (isDone) {
    const save = await load($)
    if (save !== undefined) {
      background(playEffect($, 'levelup', save.settings))
    }
  }

  return isDone
}

// ---- 農場・台所 ----

/** 種をまく */
export function plantCrop($: $, index: number, crop: string): Promise<boolean> {
  return tryChange($, (save, now) => plantFarmCrop(save, index, crop, now))
}

/** 肥料をまく */
export function fertilizePlot($: $, index: number): Promise<boolean> {
  return tryChange($, (save, now) => fertilizeFarmPlot(save, index, now))
}

/** 実った作物を収穫し、日課にも数える */
export async function harvestPlot($: $, index: number): Promise<boolean> {
  let leveledUp = false
  const isDone = await tryChange($, (save, now, day) => {
    const result = harvestFarmPlot(save, index, now)
    leveledUp = result?.isLevelUp ?? false

    return result === undefined ? undefined : countUp(result.save, 'harvests', 1, day)
  })
  if (isDone && leveledUp) {
    const save = await load($)
    if (save !== undefined) {
      $.ui.toast(T.farmLevelUp(farmLevel(save)))
    }
  }

  return isDone
}

/** 区画の害虫を駆除し、日課にも数える */
export function clearFarmPest($: $, index: number): Promise<boolean> {
  return tryChange($, (save, now, day) => {
    const next = killPest(save, index, now)

    return next === undefined ? undefined : countUp(next, 'pests', 1, day)
  })
}

/** 料理を作り、日課にも数える */
export function cookRecipe($: $, id: string): Promise<boolean> {
  return tryChange($, (save, _now, day) => {
    const next = cookFood(save, id)

    return next === undefined ? undefined : countUp(recordDish(next, id), 'cooks', 1, day)
  })
}

// ---- 日課・週課・実績 ----

/** 日課・週課のごほうびを受け取る（まだ達成していなければ false） */
export async function claimMissionReward($: $, scope: Scope, index: number): Promise<boolean> {
  const isDone = await tryChange($, (save, _now, day) => claimMission(save, day, scope, index))
  await playClaimSound($, isDone)

  return isDone
}

/** 今日の日課を 1 つ入れ替える（1 日 1 回） */
export function swapDailyMission($: $, index: number): Promise<boolean> {
  return tryChange($, (save, _now, day) => swapDaily(save, day, index))
}

/** 実績のごほうびを受け取る */
export async function claimAchievementReward($: $, id: string): Promise<boolean> {
  const isDone = await tryChange($, save => claimAchievement(save, id))
  await playClaimSound($, isDone)

  return isDone
}

async function playClaimSound($: $, isDone: boolean): Promise<void> {
  if (isDone) {
    const save = await load($)
    if (save !== undefined) {
      background(playEffect($, 'drop-common', save.settings))
    }
  }
}

/** オフライン報酬のお知らせを閉じる */
export async function dismissAway($: $): Promise<void> {
  await mutate($, save => ({ ...save, away: null }))
}

// ---- 金山・銀山 ----

/** 回収する（金鉱・銀鉱が持ち物に入る） */
export async function collectGoldMineOre($: $): Promise<boolean> {
  const isDone = await tryChange($, (save, now) => collectGoldMine(save, now))
  if (isDone) {
    const save = await load($)
    if (save !== undefined) {
      background(playEffect($, 'drop-common', save.settings))
    }
  }

  return isDone
}

export function fixGoldMineDerail($: $): Promise<boolean> {
  return tryChange($, (save, now) => fixDerail(save, now))
}

/** 金の塊を拾う（星のかけら） */
export async function pickGoldNugget($: $): Promise<boolean> {
  const isDone = await tryChange($, (save, now) => pickNugget(save, now))
  if (isDone) {
    $.ui.toast(T.goldNuggetToast)
  }

  return isDone
}

/** 金のトロッコを使う（1 日だけ生産 2 倍） */
export function useGoldCartItem($: $): Promise<boolean> {
  return tryChange($, (save, now) => useGoldCart(save, now))
}

export async function upgradeGoldMineStep($: $, kind: GoldMineUpgrade): Promise<boolean> {
  const isDone = await tryChange($, (save, now) => upgradeGoldMine(save, kind, now))
  if (isDone) {
    const save = await load($)
    if (save !== undefined) {
      background(playEffect($, 'levelup', save.settings))
    }
  }

  return isDone
}

export function smeltIngot($: $): Promise<boolean> {
  return tryChange($, save => smeltGoldIngot(save))
}

/** 銀鉱 100 個を星のかけら 10 に換える（週の上限あり） */
export function exchangeSilverForStars($: $): Promise<boolean> {
  return tryChange($, (save, _now, day) => exchangeSilver(save, day))
}

/** 金鉱で装備に金の装飾を付ける */
export function trimGear($: $, id: number): Promise<boolean> {
  return tryChange($, save => applyGoldTrim(save, id))
}

// ---- 大農場 ----

export function expandFarmPlots($: $): Promise<boolean> {
  return tryChange($, save => expandFarm(save, priceUnit(save)))
}

export function buildFarmGreenhouse($: $): Promise<boolean> {
  return tryChange($, save => buildGreenhouse(save, priceUnit(save)))
}

export function buyGreenhouseFlowerSeed($: $): Promise<boolean> {
  return tryChange($, save => buyFlowerSeed(save, priceUnit(save)))
}

export function installFarmSprinkler($: $): Promise<boolean> {
  return tryChange($, (save, now) => installSprinkler(save, now))
}

export function buildFarmDecor($: $, id: string): Promise<boolean> {
  return tryChange($, save => buildDecor(save, id, priceUnit(save)))
}

export function chooseFarmSign($: $, index: number): Promise<boolean> {
  return tryChange($, save => chooseSignName(save, index))
}

export function buyRanchAnimal($: $, id: string): Promise<boolean> {
  return tryChange($, save => buyAnimal(save, id, priceUnit(save)))
}

export function feedRanchAnimal($: $, id: string, boost = false): Promise<boolean> {
  return tryChange($, (save, now) => feedAnimal(save, id, now, boost))
}

export function patRanchAnimal($: $, id: string): Promise<boolean> {
  return tryChange($, (save, _now, day) => patAnimal(save, id, day))
}

/** 家畜の産物をとり、日課の「収穫」にも数える */
export function collectRanchProduct($: $, id: string): Promise<boolean> {
  return tryChange($, (save, now, day) => {
    const result = collectAnimal(save, id, now)

    return result === undefined ? undefined : countUp(result.save, 'harvests', 1, day)
  })
}

// ---- ペット 2 匹目 ----

export function choosePairPetEgg($: $, species: PetSpecies): Promise<boolean> {
  return tryChange($, save => choosePairEgg(save, species))
}

export function toggleCompanion($: $, id: string): Promise<boolean> {
  return tryChange($, save => toggleActivePet(save, id))
}

// ---- 図鑑・封印の魔法陣 ----

/** 図鑑のごほうびを受け取る */
export async function claimCodexReward($: $, id: string): Promise<boolean> {
  const isDone = await tryChange($, save => claimCodex(save, id))
  await playClaimSound($, isDone)

  return isDone
}

/** 台座に魂を捧げる */
export async function offerSealSoul($: $, chapter: number): Promise<boolean> {
  const isDone = await tryChange($, save => offerSoul(save, chapter))
  if (isDone) {
    const save = await load($)
    if (save !== undefined) {
      background(playEffect($, 'levelup', save.settings))
    }
  }

  return isDone
}

/** 魂の試練に挑む。結果（勝ち負け・時間）を返す。挑めなければ undefined */
export async function challengeSoulTrial($: $, chapter: number): Promise<TrialResult | undefined> {
  let result: TrialResult | undefined
  await tryChange($, (save, now) => {
    // ほかのプロセスに消されて入れ直すときにも呼ばれるので、結果は毎回作り直す
    result = runTrial(save, chapter, now)

    return result?.save
  })
  const save = await load($)
  if (result !== undefined && save !== undefined) {
    background(playEffect($, result.outcome.isWin ? 'victory' : 'hit', save.settings))
    $.ui.toast(result.outcome.isWin ? T.trialWinToast(chapter, result.outcome.killTime) : T.trialLoseToast(chapter))
  }

  return result
}

/** 真のラスボス「オリジン・モス」に挑む */
export async function challengeOriginMoth($: $): Promise<TrueBossRun | undefined> {
  let run: TrueBossRun | undefined
  await tryChange($, (save, now) => {
    run = challengeTrueBoss(save, now)

    return run?.save
  })
  const save = await load($)
  if (run !== undefined && save !== undefined) {
    background(playEffect($, run.result.isWin ? 'victory' : 'hit', save.settings))
    $.ui.toast(run.result.isWin ? T.trueBossWinToast : T.trueBossLoseToast)
  }

  return run
}

/** 「ハードで第 1 章から」 */
export async function beginHardLoop($: $): Promise<boolean> {
  const isDone = await tryChange($, save => startHardLoop(save))
  await syncBgm($)

  return isDone
}
