import { atom, read, update } from 'claude-code'
import type { RenderElement } from 'claude-code'

import type { SaveData } from '../types'
import { buyNightMarketGood, buyPremiumGood, finishNightMarketIntro } from './actions'
import { isNew } from './calendar'
import { introBox } from './daily-screens'
import { itemIcon } from './visual-parts'
import type { $ } from './persist'
import { blackMarketNightKey, blackMarketStock, premiumStock } from './premium'
import type { BlackMarketItemId } from './premium'
import { T } from './texts'

type Els = ReturnType<$['ui']['resolve']>

const noxIntroStep = atom({ plugin: 'debug-legend', key: 'noxIntroStep' } as const, 0)

function textHash(text: string): number {
  let value = 0
  for (const char of text) value = (value * 31 + char.charCodeAt(0)) >>> 0
  return value
}

/** 街タブの上級商店。 */
export async function premiumView($: $, els: Els, save: SaveData, day: string, now: number): Promise<RenderElement> {
  const { Box, Button, Text } = els
  const week = save.premium.week || day
  const slots = premiumStock(save, day, now)
  const intro = isNew(save, 'premium') ? await introBox($, els, 'premium') : undefined
  const talk = T.premiumTalk[textHash(`${save.createdAt}:${week}`) % T.premiumTalk.length] ?? ''

  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="column">{intro ?? <Box />}</Box>
      <Box flexDirection="column">
        <Text bold>{T.premiumTitle}</Text>
        <Text>{T.premiumSays(talk)}</Text>
        <Text>{T.premiumStatus(save.wallet.stars)}</Text>
      </Box>
      <Box flexDirection="column" gap={1}>
        {slots.map(slot => {
          const name = T.bagItem[slot.good.id] ?? slot.good.id
          const canBuy = slot.left > 0 && save.wallet.stars >= slot.price
          return (
            <Box key={`premium-row-${slot.good.id}`} flexDirection="row" gap={1} borderStyle="round" paddingX={1} alignItems="center">
              {itemIcon(els, slot.good.id, 40) ?? <Box />}
              <Box flexDirection="column">
              <Text bold>{name}{slot.isSale ? `　${T.premiumSale}` : ''}</Text>
              <Text dimColor>{T.premiumNote[slot.good.id] ?? ''}</Text>
              <Text>{T.premiumLeft(slot.left)}　✦{slot.price}</Text>
              {canBuy ? <Button key={`premium-buy-${slot.good.id}`} label={T.premiumBuy(name, slot.price)} onPress={() => buyPremiumGood($, slot.good.id)} /> : <Text dimColor>{slot.left < 1 ? T.premiumSoldOut : T.premiumNoMoney}</Text>}
              </Box>
            </Box>
          )
        })}
      </Box>
    </Box>
  )
}

/** 夜 22 時から朝 4 時までの闇市。 */
export async function blackMarketView($: $, els: Els, save: SaveData, now: number): Promise<RenderElement> {
  const { Box, Button, Text } = els
  const night = blackMarketNightKey(save, now)
  const slots = blackMarketStock(save, now)
  const introSeen = save.blackMarket.stories.includes('intro')
  const introStep = Math.min(await read($, noxIntroStep), T.blackMarketIntro.length - 1)
  const introLast = introStep >= T.blackMarketIntro.length - 1
  const talk = T.marketTalk[textHash(`${save.createdAt}:${night}`) % T.marketTalk.length] ?? ''
  const storyLines = save.blackMarket.stories
    .filter(id => id !== 'intro')
    .map(id => {
      const nox = id.match(/^nox-([1-5])$/)
      if (nox !== null) return T.noxStories[Number(nox[1]) - 1]
      const sealed = id.match(/^sealed-([1-7])$/)
      return sealed === null ? undefined : T.sealedStories[Number(sealed[1]) - 1]
    })
    .filter((line): line is string => line !== undefined)

  const finishIntro = async () => {
    await update($, noxIntroStep, () => 0)
    await finishNightMarketIntro($)
  }

  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="column" borderStyle="round" paddingX={1}>
        <Text bold>{T.blackMarketTitle}</Text>
        <Text>{T.noxSays(talk)}</Text>
        <Text>{T.blackMarketPoints(save.blackMarket.points)}</Text>
      </Box>
      {!introSeen ? (
        <Box flexDirection="column" borderStyle="round" paddingX={1}>
          <Text>{T.blackMarketIntro[introStep] ?? ''}</Text>
          {introLast
            ? <Button key="nox-intro-done" label={T.blackMarketIntroDone} onPress={finishIntro} />
            : <Button key="nox-intro-next" label={`${T.blackMarketIntroNext}（${introStep + 1}/${T.blackMarketIntro.length}）`} onPress={() => update($, noxIntroStep, n => n + 1)} />}
        </Box>
      ) : <Box />}
      <Box flexDirection="column" gap={1}>
        {slots.map(slot => {
          const name = T.bagItem[slot.id] ?? slot.id
          const price = T.blackMarketPrice(slot.price, slot.currency)
          const affordable = slot.currency === 'gold' ? save.gold >= slot.price : save.wallet.stars >= slot.price
          const canBuy = (slot.left === undefined || slot.left > 0) && affordable
          const limitLine = slot.left === undefined ? '' : `　${T.blackMarketLeft(slot.left)}`
          return (
            <Box key={`night-market-${slot.id}`} flexDirection="column" borderStyle="round" paddingX={1}>
              <Text bold>{name}</Text>
              <Text dimColor>{T.blackMarketNote[slot.id] ?? ''}</Text>
              <Text>{price}{limitLine}</Text>
              {canBuy
                ? <Button key={`market-buy-${slot.id}`} label={T.blackMarketBuy(name, price)} onPress={() => buyNightMarketGood($, slot.id as BlackMarketItemId)} />
                : <Text dimColor>{slot.left !== undefined && slot.left < 1 ? T.blackMarketSoldOut : T.blackMarketNoMoney}</Text>}
            </Box>
          )
        })}
      </Box>
      <Box flexDirection="column">
        <Text bold>{T.blackMarketStoryTitle}</Text>
        {storyLines.length === 0 ? <Text dimColor>{T.bagEmpty}</Text> : storyLines.map((line, index) => <Text key={`nox-story-${index}`}>{line}</Text>)}
      </Box>
    </Box>
  )
}
