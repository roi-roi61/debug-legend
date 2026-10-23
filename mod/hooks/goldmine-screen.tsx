import type { RenderElement } from 'claude-code'

import type { SaveData } from '../types'
import {
  collectGoldMineOre,
  exchangeSilverForStars,
  fixGoldMineDerail,
  pickGoldNugget,
  replayIntro,
  smeltIngot,
  trimGear,
  upgradeGoldMineStep,
  useGoldCartItem,
} from './actions'
import { itemName } from './art'
import { isNew } from './calendar'
import { introBox } from './daily-screens'
import { GOLD_TRIM_ORE, goldTrimTargets } from './smith'
import { INGOT_ORE, NUGGET_STARS, activeEvents, capacityHours, goldMineView, upgradeCost } from './goldmine'
import type { Upgrade, UpgradeCost } from './goldmine'
import type { $ } from './persist'
import { today } from './persist'
import { SILVER_EXCHANGE, silverExchangeLeft } from './premium'
import { T } from './texts'
import { facilityHeader } from './visual-parts'

// 採集タブの「金山銀山」（11 日目）。文字とボタンだけの作り（トロッコの絵・アニメはあとで）。

type Els = ReturnType<$['ui']['resolve']>

const UPGRADES: readonly Upgrade[] = ['speed', 'capacity', 'cart', 'goldLine', 'silverLine']

/** 費用の文（ゴールド・星のかけら・鉱石） */
function costText(cost: UpgradeCost): string {
  const parts: string[] = []
  if (cost.gold > 0) parts.push(T.gold(cost.gold))
  if (cost.stars > 0) parts.push(`✦${cost.stars}`)
  if (cost.ore !== '') parts.push(T.reward.item(T.bagItem[cost.ore] ?? cost.ore, cost.amount))
  return parts.join('・')
}

function canPay(save: SaveData, cost: UpgradeCost): boolean {
  return save.gold >= cost.gold && save.wallet.stars >= cost.stars && (cost.ore === '' || (save.bag[cost.ore] ?? 0) >= cost.amount)
}

/** たまり具合の棒（10 マス） */
function bar(amount: number, cap: number): string {
  const filled = cap > 0 ? Math.min(10, Math.round((amount / cap) * 10)) : 0
  return `${'■'.repeat(filled)}${'□'.repeat(10 - filled)}`
}

export async function goldMineScreen($: $, els: Els, save: SaveData): Promise<RenderElement> {
  const { Box, Button, Text } = els
  const now = await $.clock.now()
  const day = await today($)
  const intro = isNew(save, 'goldmine') ? await introBox($, els, 'goldmine') : null
  const view = goldMineView(save, now)
  const g = save.goldMine
  const events = activeEvents(save, now)
  const hasDerail = events.some(event => event.kind === 'derail')
  const hasNugget = events.some(event => event.kind === 'nugget')
  const hasJackpot = events.some(event => event.kind === 'jackpot')
  const header = facilityHeader(els, 'goldmine')
  const trims = goldTrimTargets(save).slice(0, 8)
  const exchangeLeft = silverExchangeLeft(save, day)

  return (
    <Box flexDirection="column" gap={1}>
      {intro}
      {header ?? <Box />}
      <Box flexDirection="column">
        <Text bold>{T.gmTitle}</Text>
        <Text>{T.gmRates(view.goldPerHour, view.silverPerHour)}</Text>
        <Text dimColor>{T.gmUpgradeLine(g.speed, capacityHours(save), T.gmCartName[g.cart] ?? '')}</Text>
        <Text dimColor>{T.gmOreLine(save.bag['ore-gold'] ?? 0, save.bag['ore-silver'] ?? 0)}</Text>
        {view.isRush ? <Text color="#ffd60a">{T.gmRush}</Text> : <Text dimColor>{T.gmRushHint}</Text>}
        {view.isBoosted ? <Text color="#ffd60a">{T.gmBoosted}</Text> : <Box />}
        {hasJackpot ? <Text color="#ff9f1c">{T.gmJackpot}</Text> : <Box />}
      </Box>
      <Box flexDirection="column" borderStyle="round" paddingX={1}>
        {view.lines.map(line => (
          <Text key={`gm-line-${line.kind}-${line.index}`} color={line.isDerailed ? '#ff6b6b' : line.isFull ? '#ffd60a' : undefined}>
            {T.gmLine(line.kind === 'gold' ? T.gmGold : T.gmSilver, line.index + 1, line.amount, line.cap)} {bar(line.amount, line.cap)}
            {line.isDerailed ? ` ${T.gmDerailed}` : line.isFull ? ` ${T.gmFull}` : ''}
          </Text>
        ))}
      </Box>
      <Box flexDirection="row" flexWrap="wrap" gap={1}>
        {view.gold + view.silver >= 1 ? (
          <Button key="gm-collect" label={T.gmCollect(view.gold, view.silver)} variant="primary" onPress={() => collectGoldMineOre($)} />
        ) : (
          <Text dimColor>{T.gmNothing}</Text>
        )}
        {hasDerail ? <Button key="gm-fix" label={T.gmFix} variant="primary" onPress={() => fixGoldMineDerail($)} /> : <Box />}
        {hasNugget ? <Button key="gm-nugget" label={T.gmNugget(NUGGET_STARS)} variant="primary" onPress={() => pickGoldNugget($)} /> : <Box />}
        {(save.bag['gold-cart'] ?? 0) > 0 && !view.isBoosted ? <Button key="gm-cart" label={T.gmUseCart} onPress={() => useGoldCartItem($)} /> : <Box />}
      </Box>
      {g.last === null ? <Box /> : <Text dimColor>{T.gmLast(g.last.gold, g.last.silver, g.last.converted)}</Text>}
      <Box flexDirection="column" gap={1}>
        <Text bold>{T.gmUpgradeTitle}</Text>
        {UPGRADES.map(kind => {
          const cost = upgradeCost(save, kind)
          const name = T.gmUpgradeName[kind] ?? kind
          return cost === undefined ? (
            <Text key={`gm-up-${kind}`} dimColor>{name}: {T.gmMax}</Text>
          ) : canPay(save, cost) ? (
            <Button key={`gm-up-${kind}`} label={T.gmUpgradeButton(name, costText(cost))} onPress={() => upgradeGoldMineStep($, kind)} />
          ) : (
            <Text key={`gm-up-${kind}`} dimColor>{T.gmUpgradeShort(name, costText(cost))}</Text>
          )
        })}
      </Box>
      <Box flexDirection="column" gap={1}>
        <Text bold>{T.gmUsesTitle}</Text>
        <Text dimColor>{T.gmUsesSell}</Text>
        <Box flexDirection="row" flexWrap="wrap" gap={1}>
          {(save.bag['ore-gold'] ?? 0) >= INGOT_ORE ? <Button key="gm-smelt" label={T.gmSmelt(INGOT_ORE)} onPress={() => smeltIngot($)} /> : <Text dimColor>{T.gmSmelt(INGOT_ORE)}（{T.reward.item(T.bagItem['ore-gold'] ?? '', save.bag['ore-gold'] ?? 0)}）</Text>}
          {(save.bag['ore-silver'] ?? 0) >= SILVER_EXCHANGE.ore && exchangeLeft > 0 ? (
            <Button key="gm-exchange" label={T.gmExchange(SILVER_EXCHANGE.ore, SILVER_EXCHANGE.stars, exchangeLeft)} onPress={() => exchangeSilverForStars($)} />
          ) : (
            <Text dimColor>{T.gmExchange(SILVER_EXCHANGE.ore, SILVER_EXCHANGE.stars, exchangeLeft)}</Text>
          )}
        </Box>
        <Text>{T.gmTrimTitle(GOLD_TRIM_ORE)}</Text>
        {trims.length === 0 ? <Text dimColor>{T.gmTrimNone}</Text> : <Box />}
        <Box flexDirection="column">
          {trims.map(item => (
            (save.bag['ore-gold'] ?? 0) >= GOLD_TRIM_ORE ? (
              <Button key={`gm-trim-${item.id}`} label={T.gmTrim(itemName(item))} onPress={() => trimGear($, item.id)} />
            ) : (
              <Text key={`gm-trim-${item.id}`} dimColor>{itemName(item)}</Text>
            )
          ))}
        </Box>
      </Box>
      {intro === null ? <Button key="intro-again-goldmine" label={T.gmIntroAgain} onPress={() => replayIntro($, 'goldmine')} /> : null}
    </Box>
  )
}
