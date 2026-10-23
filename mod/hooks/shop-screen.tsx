import { atom, read, update } from 'claude-code'
import type { RenderElement } from 'claude-code'

import type { AdventurerId, ExpeditionLunch, SaveData } from '../types'
import { buyGood, collectExpedition, visitNightMarket, refreshShop, sellGood, sendExpedition, takeShopAmulet, takeShopLuckyBag, useBagItem } from './actions'
import { buffLeft, buffRate } from './buffs'
import { READY, featureDay, isNew, isUnlocked, priceUnit } from './calendar'
import { introBox } from './daily-screens'
import { facilityHeader, itemIcon } from './visual-parts'
import type { $ } from './persist'
import { background, today } from './persist'
import { dayKey } from './fuel'
import type { Slot } from './shop'
import { AFFINITY_POINTS, RANK_SPENT, USES, VETERAN, affinityLevel, rankOf, refreshPrice, sellPrice, stock, weekKey } from './shop'
import { T } from './texts'
import { clearedChapter, hireCost, tripReady, tripRemainingMs } from './expedition'
import { isPetAway } from './pets'
import { smithView } from './smith-screen'
import { blackMarketView, premiumView } from './premium-screen'
import { isBlackMarketOpen } from './premium'

// 街タブ（2 日目の商店。あとで上級商店・闇市・鍛冶屋・遠征ギルドが並ぶ）。

type Els = ReturnType<$['ui']['resolve']>

/** 街タブで開いている施設 */
const townView = atom({ plugin: 'debug-legend', key: 'townView' } as const, 'shop')
const expeditionChapter = atom({ plugin: 'debug-legend', key: 'expeditionChapter' } as const, 1)
const expeditionHours = atom({ plugin: 'debug-legend', key: 'expeditionHours' } as const, 1)
const expeditionPet = atom({ plugin: 'debug-legend', key: 'expeditionPet' } as const, null)
const expeditionLunch = atom({ plugin: 'debug-legend', key: 'expeditionLunch' } as const, 'none')

/** 街タブを出すか（商店が開いていて、遊べる） */
export const hasTown = (save: SaveData): boolean => READY.has('shop') && isUnlocked(save, 'shop')

export async function townTab($: $, els: Els, save: SaveData): Promise<RenderElement> {
  const view = await read($, townView)
  const expeditionOpen = READY.has('expedition') && isUnlocked(save, 'expedition')
  const smithOpen = READY.has('smith') && isUnlocked(save, 'smith')
  const premiumOpen = READY.has('premium') && isUnlocked(save, 'premium')
  const now = await $.clock.now()
  const day = dayKey(now, new Date(now).getTimezoneOffset())
  const nightOpen = isBlackMarketOpen(save, now)
  const current = view === 'smith' && smithOpen ? 'smith' : view === 'expedition' && expeditionOpen ? 'expedition' : view === 'premium' && premiumOpen ? 'premium' : view === 'blackMarket' && nightOpen ? 'blackMarket' : 'shop'
  const { Box, Button } = els

  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="row" gap={1}>
        <Button key="town-view-shop" label={T.townViews.shop ?? '商店'} variant={current === 'shop' ? 'primary' : 'secondary'} onPress={() => update($, townView, () => 'shop')} />
        <Box flexDirection="row">
          {expeditionOpen ? <Button key="town-view-expedition" label={T.townViews.expedition ?? '遠征ギルド'} variant={current === 'expedition' ? 'primary' : 'secondary'} onPress={() => update($, townView, () => 'expedition')} /> : <Box />}
        </Box>
        <Box flexDirection="row">
          {smithOpen ? <Button key="town-view-smith" label={T.townViews.smith ?? '鍛冶屋'} variant={current === 'smith' ? 'primary' : 'secondary'} onPress={() => update($, townView, () => 'smith')} /> : <Box />}
        </Box>
        <Box flexDirection="row">
          {premiumOpen ? <Button key="town-view-premium" label={T.townViews.premium ?? '上級商店'} variant={current === 'premium' ? 'primary' : 'secondary'} onPress={() => update($, townView, () => 'premium')} /> : <Box />}
        </Box>
        <Box flexDirection="row">
          {nightOpen ? <Button key="town-view-black-market" label={T.townViews.blackMarket ?? '闇市 🌙'} variant={current === 'blackMarket' ? 'primary' : 'secondary'} onPress={async () => {
            await update($, townView, () => 'blackMarket')
            // 来店の印（一晩に 1 回）は押したときに書く。描くあいだにセーブを書くと、エンジンがサイド画面ごと描かなくなる
            background(visitNightMarket($))
          }} /> : <Box />}
        </Box>
      </Box>
      {facilityHeader(els, current === 'blackMarket' ? 'blackmarket' : current) ?? <Box />}
      <Box flexDirection="column">
        {current === 'smith' ? await smithView($, els, save) : current === 'expedition' ? await expeditionView($, els, save) : current === 'premium' ? await premiumView($, els, save, day, now) : current === 'blackMarket' ? await blackMarketView($, els, save, now) : await shopView($, els, save)}
      </Box>
    </Box>
  )
}

async function expeditionView($: $, els: Els, save: SaveData): Promise<RenderElement> {
  const { Box, Button, Text } = els
  const now = await $.clock.now()
  const intro = isNew(save, 'expedition') ? await introBox($, els, 'expedition') : undefined
  const maxChapter = clearedChapter(save)
  const chapterChoice = await read($, expeditionChapter)
  const chapter = maxChapter > 0 ? Math.max(1, Math.min(maxChapter, chapterChoice)) : 0
  const hours = (await read($, expeditionHours)) as 1 | 4 | 8
  const petChoice = await read($, expeditionPet)
  const petChoices = save.pets.owned.filter(pet => !isPetAway(save, pet.id))
  const pet = typeof petChoice === 'string' && petChoices.some(item => item.id === petChoice) ? petChoice : null
  const lunchChoice = await read($, expeditionLunch)
  const lunch: ExpeditionLunch = (lunchChoice === 'lunchbox' || lunchChoice === 'dish-onigiri') && (save.bag[lunchChoice] ?? 0) > 0 ? lunchChoice : 'none'
  const foodAvailable = lunch === 'none' || (save.bag[lunch] ?? 0) > 0
  const setup = { chapter, hours, pet, lunch }
  const cost = hireCost(save, hours)
  const canSend = maxChapter > 0 && save.gold >= cost && foodAvailable
  const minuteLeft = (ms: number): [number, number] => {
    const minutes = Math.max(0, Math.ceil(ms / 60_000))
    return [Math.floor(minutes / 60), minutes % 60]
  }

  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="column">{intro ?? <Box />}</Box>
      <Box flexDirection="column">
        <Text bold>{T.expTitle}</Text>
        {maxChapter === 0 ? <Text dimColor>{T.expClearedNone}</Text> : <Text>{T.expChapterTitle}</Text>}
        <Box flexDirection="row" flexWrap="wrap" gap={1}>
          {Array.from({ length: maxChapter }, (_, index) => index + 1).map(value => (
            <Button key={`exp-chapter-${value}`} label={T.expChapter(value)} variant={chapter === value ? 'primary' : 'secondary'} onPress={() => update($, expeditionChapter, () => value)} />
          ))}
        </Box>
      </Box>
      <Box flexDirection="column">
        <Text>{T.expHoursTitle}</Text>
        <Box flexDirection="row" gap={1}>
          {([1, 4, 8] as const).map(value => <Button key={`exp-hours-${value}`} label={T.expHours(value)} variant={hours === value ? 'primary' : 'secondary'} onPress={() => update($, expeditionHours, () => value)} />)}
        </Box>
      </Box>
      <Box flexDirection="column">
        <Text>{T.expPetTitle}</Text>
        <Box flexDirection="row" flexWrap="wrap" gap={1}>
          <Button key="exp-pet-none" label={T.expNoPet} variant={pet === null ? 'primary' : 'secondary'} onPress={() => update($, expeditionPet, () => null)} />
          {petChoices.map(item => <Button key={`exp-pet-${item.id}`} label={item.name} variant={pet === item.id ? 'primary' : 'secondary'} onPress={() => update($, expeditionPet, () => item.id)} />)}
        </Box>
      </Box>
      <Box flexDirection="column">
        <Text>{T.expLunchTitle}</Text>
        <Box flexDirection="row" flexWrap="wrap" gap={1}>
          <Button key="exp-lunch-none" label={T.expNoLunch} variant={lunch === 'none' ? 'primary' : 'secondary'} onPress={() => update($, expeditionLunch, () => 'none')} />
          {(['lunchbox', 'dish-onigiri'] as const).map(id => (
            <Box key={`exp-lunch-row-${id}`} flexDirection="row">
              {(save.bag[id] ?? 0) > 0 ? <Button key={`exp-lunch-${id}`} label={`${T.expLunchName[id]} ×${save.bag[id]}`} variant={lunch === id ? 'primary' : 'secondary'} onPress={() => update($, expeditionLunch, () => id)} /> : <Box />}
            </Box>
          ))}
        </Box>
      </Box>
      <Text>{T.expHireCost(cost)}　{T.gold(save.gold)}</Text>
      <Box flexDirection="column">
        {save.expedition.adventurers.map(adventurer => {
          const name = T.adventurerName[adventurer.id] ?? adventurer.id
          const trip = adventurer.trip
          if (trip === undefined) {
            return (
              <Box key={`adventurer-${adventurer.id}`} flexDirection="column" borderStyle="round" paddingX={1}>
                <Text bold>{name}　Lv.{adventurer.level}</Text>
                <Text dimColor>{T.adventurerRole[adventurer.id] ?? ''}</Text>
                {canSend ? <Button key={`exp-send-${adventurer.id}`} label={`${T.expStart} → ${T.expChapter(chapter)} · ${T.expHours(hours)}`} onPress={() => sendExpedition($, adventurer.id as AdventurerId, setup)} /> : <Text dimColor>{maxChapter === 0 ? T.expClearedNone : save.gold < cost ? T.noGold : T.expStart}</Text>}
              </Box>
            )
          }
          const left = tripRemainingMs(trip, now)
          const [leftHours, leftMinutes] = minuteLeft(left)
          return (
            <Box key={`adventurer-${adventurer.id}`} flexDirection="column" borderStyle="round" paddingX={1}>
              <Text bold>{name}　Lv.{adventurer.level}　{T.expChapter(trip.chapter)}</Text>
              {tripReady(trip, now) ? <Text color="#ffd60a">{T.expReady}</Text> : <Text>{T.expReturnIn(leftHours, leftMinutes)}</Text>}
              <Box flexDirection="row">
                {tripReady(trip, now) ? <Button key={`exp-claim-${adventurer.id}`} label={T.expClaim} variant="primary" onPress={() => collectExpedition($, adventurer.id)} /> : <Text dimColor>{trip.pet === undefined ? '' : T.petAway}</Text>}
              </Box>
            </Box>
          )
        })}
      </Box>
    </Box>
  )
}

/** 今日のミナのひとこと（好感度 1 のうちは最初の 3 つから） */
function minaLine(save: SaveData, day: string): string {
  const lines = T.minaTalk
  const size = affinityLevel(save) >= 2 ? lines.length : Math.min(3, lines.length)
  let hash = 0
  for (const ch of day) {
    hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  }

  return lines[hash % size] ?? ''
}

/** 持ち物で「使う」「売る」ができるもの */
const usable = (save: SaveData): [string, number][] => Object.entries(save.bag).filter(([id, count]) => count > 0 && USES[id] !== undefined)
const sellable = (save: SaveData): [string, number][] => Object.entries(save.bag).filter(([id, count]) => count > 0 && sellPrice(save, id) > 0)

function goodRow($: $, els: Els, save: SaveData, slot: Slot) {
  const { Box, Button, Text } = els
  const name = T.goodName[slot.good.id] ?? slot.good.id
  const many = Math.min(slot.left, 10, Math.floor(save.gold / slot.price))

  return (
    <Box key={`good-${slot.good.id}`} flexDirection="row" gap={1} alignItems="center">
      {itemIcon(els, slot.good.gives.id, 32) ?? <Box />}
      <Box flexDirection="column">
      <Text color={slot.isDeal ? '#ffd60a' : undefined}>
        {slot.isDeal ? `${T.dealMark}　` : ''}
        {T.goodLine(name, slot.price, slot.left)}
      </Text>
      <Box flexDirection="row" gap={1}>
        <Text dimColor>{T.goodNote[slot.good.id] ?? ''}</Text>
        {slot.left <= 0 ? (
          <Text dimColor>{T.soldOut}</Text>
        ) : save.gold < slot.price ? (
          <Text dimColor>{T.noGold}</Text>
        ) : (
          <Box flexDirection="row" gap={1}>
            <Button key={`buy-${slot.good.id}`} label={T.buyOne} onPress={() => buyGood($, slot.good.id, 1)} />
            {many > 1 ? <Button key={`buy-many-${slot.good.id}`} label={T.buyMany(many)} onPress={() => buyGood($, slot.good.id, many)} /> : null}
          </Box>
        )}
      </Box>
      </Box>
    </Box>
  )
}

function buffLines(els: Els, save: SaveData) {
  const { Text } = els
  const buffs = (['power', 'exp', 'gold', 'luck'] as const)
    .map(kind => ({ kind, rate: buffRate(save, kind), left: buffLeft(save, kind) }))
    .filter(b => b.rate > 0 && b.left !== undefined)
  if (buffs.length === 0) {
    return [<Text dimColor>{T.buffNone}</Text>]
  }

  return buffs.map(b => {
    const name = T.buffName[b.kind] ?? b.kind
    const percent = Math.round(b.rate * 100)
    return (
      <Text key={`buff-${b.kind}`}>
        {b.left?.charges !== undefined ? T.buffCharges(name, percent, b.left.charges) : T.buffSeconds(name, percent, Math.ceil((b.left?.seconds ?? 0) / 60))}
      </Text>
    )
  })
}

async function shopView($: $, els: Els, save: SaveData): Promise<RenderElement> {
  const { Box, Button, Text } = els
  const day = await today($)
  const intro = isNew(save, 'shop') ? await introBox($, els, 'shop') : null
  const level = affinityLevel(save)
  const nextPoints = AFFINITY_POINTS[level]
  const rank = rankOf(save)
  const nextRank = RANK_SPENT[rank]
  const unit = priceUnit(save)
  const refreshCost = refreshPrice(save, day)
  const veteranLeft = save.calendar.isVeteran ? featureDay('shop') + VETERAN.days - save.calendar.playedDays : 0
  const affinityPercent = level >= 9 ? 6 : level >= 6 ? 4 : level >= 3 ? 2 : 0
  const week = weekKey(day)
  const toUse = usable(save)
  const toSell = sellable(save)

  return (
    <Box flexDirection="column" gap={1}>
      {intro}
      <Box flexDirection="column">
        <Text bold>{T.shopHead(level)}</Text>
        <Text color="#ff9ecb">
          {'♥'.repeat(level)}
          {'♡'.repeat(Math.max(0, AFFINITY_POINTS.length - level))}　{nextPoints === undefined ? T.affinityMax : T.affinityNext(save.shop.points, nextPoints)}
        </Text>
        <Text>{T.rankLine(T.rankName[rank] ?? '', nextRank === undefined ? '' : T.rankNext(Math.max(0, Math.ceil((nextRank - save.shop.spent) * unit))))}</Text>
        <Text italic>{T.minaSays(minaLine(save, day))}</Text>
        {veteranLeft > 0 ? <Text color="#7fd1ff">{T.discountVeteran(veteranLeft)}</Text> : null}
        {affinityPercent > 0 ? <Text color="#ff9ecb">{T.discountAffinity(affinityPercent)}</Text> : null}
      </Box>
      <Box flexDirection="column">
        <Text bold>
          {T.goodsTitle}　{T.gold(save.gold)}
        </Text>
        {stock(save, day).map(slot => goodRow($, els, save, slot))}
        {save.gold >= refreshCost ? (
          <Button key="shop-refresh" label={refreshCost === 0 ? T.refreshFree : T.refreshPaid(refreshCost)} onPress={() => refreshShop($)} />
        ) : (
          <Text dimColor>
            {T.refreshPaid(refreshCost)}　{T.noGold}
          </Text>
        )}
        {level >= 7 && save.shop.amuletWeek !== week ? <Button key="shop-amulet" label={T.amuletButton} variant="primary" onPress={() => takeShopAmulet($)} /> : null}
        {rank >= RANK_SPENT.length && save.shop.bagWeek !== week ? (
          <Button key="shop-luckybag" label={T.luckyBagButton} variant="primary" onPress={() => takeShopLuckyBag($)} />
        ) : null}
      </Box>
      <Box flexDirection="column">
        <Text bold>{T.buffsTitle}</Text>
        {buffLines(els, save)}
      </Box>
      <Box flexDirection="column">
        <Text bold>{T.useTitle}</Text>
        {toUse.length === 0 ? <Text dimColor>{T.bagEmpty}</Text> : null}
        {toUse.map(([id, count]) => (
          <Box key={`use-row-${id}`} flexDirection="row" gap={1} alignItems="center">
            {itemIcon(els, id) ?? <Box />}
            <Text>{T.reward.item(T.bagItem[id] ?? id, count)}</Text>
            <Button key={`use-${id}`} label={USES[id]?.kind === 'box' ? T.openButton : T.useButton} onPress={() => useBagItem($, id)} />
          </Box>
        ))}
      </Box>
      <Box flexDirection="column">
        <Text bold>{T.sellTitle}</Text>
        {toSell.length === 0 ? <Text dimColor>{T.sellNothing}</Text> : null}
        {toSell.map(([id, count]) => {
          const price = sellPrice(save, id)
          return (
            <Box key={`sell-row-${id}`} flexDirection="row" gap={1} alignItems="center">
              {itemIcon(els, id) ?? <Box />}
              <Text>{T.reward.item(T.bagItem[id] ?? id, count)}</Text>
              <Button key={`sell-${id}`} label={T.sellOne(price)} onPress={() => sellGood($, id, 1)} />
              {count > 1 ? <Button key={`sell-all-${id}`} label={T.sellAll(count, price * count)} onPress={() => sellGood($, id, count)} /> : null}
            </Box>
          )
        })}
      </Box>
    </Box>
  )
}
