import { atom, read, update } from 'claude-code'
import type { RenderElement } from 'claude-code'

import type { Item, SaveData, SlotId } from '../types'
import { combineGear, craftBossGearAction, craftSetGear, disassembleGear, enhanceGear, equipStashGear, inheritGearPlus, reforgeGear, sellStashGear } from './actions'
import { introBox } from './daily-screens'
import { effectiveItemPower, SLOTS } from './gear'
import { priceUnit, isNew } from './calendar'
import { BOSS_RECIPES, SMITH_SETS, STASH_CAP, enhanceChance, oreForPlus, smithAffinity } from './smith'
import type { $ } from './persist'
import { today } from './persist'
import { T } from './texts'
import { itemName, plusColor, rarityName } from './art'

type Els = ReturnType<$['ui']['resolve']>

const setChoice = atom({ plugin: 'debug-legend', key: 'smithSetChoice' } as const, 'copper-miner')
const slotChoice = atom({ plugin: 'debug-legend', key: 'smithSlotChoice' } as const, 'weapon')
const combineChoice = atom({ plugin: 'debug-legend', key: 'smithCombineChoice' } as const, [] as number[])
const inheritSource = atom({ plugin: 'debug-legend', key: 'smithInheritSource' } as const, null as number | null)
const inheritTarget = atom({ plugin: 'debug-legend', key: 'smithInheritTarget' } as const, null as number | null)

function stableIndex(text: string, size: number): number {
  let hash = 0
  for (const char of text) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return size > 0 ? hash % size : 0
}

function allOwned(save: SaveData): Item[] {
  return [...SLOTS.map(slot => save.equipment[slot]).filter((item): item is Item => item !== null), ...save.stash]
}

function selectedItem(save: SaveData, id: number | null): Item | undefined {
  return id === null ? undefined : allOwned(save).find(item => item.id === id)
}

function itemCard($: $, els: Els, save: SaveData, item: Item, stashed: boolean, selected: readonly number[], source: number | null, target: number | null) {
  const { Box, Button, Text } = els
  const plus = item.plus ?? 0
  const nextPlus = plus + 1
  const ore = oreForPlus(nextPlus)
  const oreName = T.bagItem[ore] ?? ore
  const gold = Math.max(1, Math.round(priceUnit(save) * 0.2 * nextPlus))
  const chance = Math.round(enhanceChance(save, item) * 100)
  const canEnhance = plus < 15 && save.gold >= gold && (save.bag[ore] ?? 0) > 0
  const risky = nextPlus >= 11
  const canGuard = risky && (save.bag['guard-stone'] ?? 0) > 0
  const isSelected = selected.includes(item.id)
  const dustCost = 1 + item.rarity
  const canReforge = (save.bag['smith-dust'] ?? 0) >= dustCost
  const inheritAmount = Math.floor(plus * 0.7)

  return (
    <Box key={`smith-item-${item.id}`} flexDirection="column" borderStyle="round" borderColor={plusColor(item)} paddingX={1}>
      <Text color={plusColor(item)} bold>{T.smithItemLine(itemName(item), rarityName(item.rarity), Math.round(effectiveItemPower(item)))}</Text>
      <Box flexDirection="row" flexWrap="wrap" gap={1}>
        {plus < 15 ? (
          <Box flexDirection="row">
            {canEnhance ? <Button key={`smith-enhance-${item.id}`} label={T.smithEnhance(nextPlus, chance, gold, oreName)} onPress={() => enhanceGear($, item.id, false)} /> : <Text dimColor>{T.smithEnhance(nextPlus, chance, gold, oreName)}</Text>}
          </Box>
        ) : <Text dimColor>{T.smithMax}</Text>}
        {risky ? <Text dimColor>{T.smithRisk}</Text> : <Box />}
        {risky && canGuard && canEnhance ? <Button key={`smith-guard-${item.id}`} label={T.smithEnhanceGuard(nextPlus)} onPress={() => enhanceGear($, item.id, true)} /> : <Box />}
        {stashed ? <Button key={`smith-equip-${item.id}`} label={T.smithEquip} onPress={() => equipStashGear($, item.id)} /> : <Box />}
        {stashed ? <Button key={`smith-sell-${item.id}`} label={T.smithSell} onPress={() => sellStashGear($, item.id)} /> : <Box />}
        {stashed ? <Button key={`smith-disassemble-${item.id}`} label={T.smithDisassemble} onPress={() => disassembleGear($, item.id)} /> : <Box />}
        {canReforge ? <Button key={`smith-reforge-${item.id}`} label={T.smithReforge(dustCost)} onPress={() => reforgeGear($, item.id)} /> : <Box />}
        <Button key={`smith-combine-choice-${item.id}`} label={T.smithToggleCombine(isSelected)} variant={isSelected ? 'primary' : 'secondary'} onPress={() => update($, combineChoice, ids => isSelected ? ids.filter(id => id !== item.id) : ids.length < 3 ? [...ids, item.id] : ids)} />
        <Button key={`smith-source-${item.id}`} label={source === item.id ? `✓ ${T.smithPickSource}` : T.smithPickSource} variant={source === item.id ? 'primary' : 'secondary'} onPress={() => update($, inheritSource, () => item.id)} />
        <Button key={`smith-target-${item.id}`} label={target === item.id ? `✓ ${T.smithPickTarget}` : T.smithPickTarget} variant={target === item.id ? 'primary' : 'secondary'} onPress={() => update($, inheritTarget, () => item.id)} />
      </Box>
      <Text dimColor>{plus < 15 ? T.smithEnhance(nextPlus, chance, gold, oreName) : T.smithMax}　{T.reward.item(oreName, save.bag[ore] ?? 0)}　{T.gold(save.gold)}</Text>
      {risky && !canGuard && (save.bag['guard-stone'] ?? 0) === 0 ? <Text dimColor>{T.smithNoGuard}</Text> : <Box />}
      {source === item.id && inheritAmount < 1 ? <Text dimColor>{T.smithPickSource}</Text> : <Box />}
    </Box>
  )
}

function smithLine(save: SaveData, day: string): string {
  const lines = T.smithTalk
  return lines[stableIndex(`${save.createdAt}:${day}`, lines.length)] ?? ''
}

export async function smithView($: $, els: Els, save: SaveData): Promise<RenderElement> {
  const { Box, Button, Text } = els
  const created = new Date(save.createdAt)
  const day = save.daily.day || save.calendar.lastPlayedDay || (Number.isFinite(created.getTime()) ? created.toISOString().slice(0, 10) : await today($))
  const intro = isNew(save, 'smith') ? await introBox($, els, 'smith') : <Box />
  const owned = allOwned(save)
  const selected = (await read($, combineChoice)).filter(id => owned.some(item => item.id === id)).slice(0, 3)
  const source = await read($, inheritSource)
  const target = await read($, inheritTarget)
  const fromItem = selectedItem(save, source)
  const toItem = selectedItem(save, target)
  const inherited = fromItem === undefined ? 0 : Math.floor((fromItem.plus ?? 0) * 0.7)
  const inheritGold = priceUnit(save) * 5
  const mergeItems = selected.map(id => owned.find(item => item.id === id)).filter((item): item is Item => item !== undefined)
  const stashIds = new Set(save.stash.map(item => item.id))
  const stashUsed = mergeItems.filter(item => stashIds.has(item.id)).length
  const canCombine = mergeItems.length === 3 && save.stash.length - stashUsed < STASH_CAP && new Set(mergeItems.map(item => item.rarity)).size === 1 && (mergeItems[0]?.rarity ?? 5) < 5
  const chosenSet = (await read($, setChoice))
  const recipe = SMITH_SETS.find(item => item.id === chosenSet) ?? SMITH_SETS[0]!
  const slotValue = await read($, slotChoice)
  const chosenSlot: SlotId = SLOTS.find(slot => slot === slotValue) ?? 'weapon'
  const canCraftSet = save.stash.length < STASH_CAP && (save.bag[recipe.ore] ?? 0) >= 20
  const affinityBonus = smithAffinity(save)
  const allBossGear = BOSS_RECIPES.every(item => owned.some(gear => gear.unique === item.id))

  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="column">{intro}</Box>
      <Box flexDirection="column" borderStyle="round" borderColor="#ffd60a" paddingX={1}>
        <Text bold color="#ffd60a">{T.smithTitle}</Text>
        <Text italic>{T.smithSays(smithLine(save, day))}</Text>
        <Text>{T.smithStatus(save.smith.points, affinityBonus, save.smith.zeal, save.stash.length)}</Text>
        <Text dimColor>{T.smithGuardWeekly}　{T.reward.item(T.bagItem['guard-stone'] ?? 'guard-stone', save.bag['guard-stone'] ?? 0)}</Text>
      </Box>
      <Box flexDirection="column">
        <Text bold>{T.smithEquipmentTitle}</Text>
        {SLOTS.map(slot => {
          const item = save.equipment[slot]
          return <Box key={`smith-equipped-${slot}`} flexDirection="column">{item === null ? <Text dimColor>{T.slot[slot]}: {T.emptySlot}</Text> : itemCard($, els, save, item, false, selected, source, target)}</Box>
        })}
      </Box>
      <Box flexDirection="column">
        <Text bold>{T.smithStashTitle}　{save.stash.length} / {STASH_CAP}</Text>
        {save.stash.length === 0 ? <Text dimColor>{T.smithStashEmpty}</Text> : <Box />}
        {save.stash.length >= STASH_CAP ? <Text color="#ff6d6d">{T.smithStashFull}</Text> : <Box />}
        {save.stash.map(item => itemCard($, els, save, item, true, selected, source, target))}
      </Box>
      <Box flexDirection="column" borderStyle="round" paddingX={1}>
        <Text bold>{T.smithInheritanceTitle}</Text>
        <Text>{fromItem === undefined ? T.smithPickSource : `${T.smithPickSource}: ${itemName(fromItem)}`}</Text>
        <Text>{toItem === undefined ? T.smithPickTarget : `${T.smithPickTarget}: ${itemName(toItem)}`}</Text>
        {fromItem !== undefined && toItem !== undefined && fromItem.id !== toItem.id && inherited > 0 && save.gold >= inheritGold
          ? <Button key="smith-transfer" label={T.smithInheritButton(inherited, inheritGold)} onPress={() => inheritGearPlus($, fromItem.id, toItem.id)} />
          : <Text dimColor>{T.smithInheritButton(inherited, inheritGold)}</Text>}
      </Box>
      <Box flexDirection="column" borderStyle="round" paddingX={1}>
        <Text bold>{T.smithSynthesisTitle}</Text>
        <Text>{T.smithSelected(selected.length)}</Text>
        {canCombine ? <Button key="smith-combine" label={T.smithCombine} variant="primary" onPress={async () => { await combineGear($, selected); await update($, combineChoice, () => []) }} /> : <Text dimColor>{T.smithCombine}</Text>}
        <Text dimColor>{T.reward.item(T.bagItem['smith-dust'] ?? 'smith-dust', save.bag['smith-dust'] ?? 0)}</Text>
      </Box>
      <Box flexDirection="column" borderStyle="round" paddingX={1}>
        <Text bold>{T.smithSetTitle}</Text>
        <Box flexDirection="row" flexWrap="wrap" gap={1}>
          {SMITH_SETS.map(item => <Button key={`smith-set-${item.id}`} label={T.setName[item.id] ?? item.id} variant={chosenSet === item.id ? 'primary' : 'secondary'} onPress={() => update($, setChoice, () => item.id)} />)}
        </Box>
        <Text>{T.smithSetEffects[recipe.id]?.join('　・　') ?? ''}</Text>
        <Box flexDirection="row" flexWrap="wrap" gap={1}>
          {SLOTS.map(slot => <Button key={`smith-slot-${slot}`} label={T.slot[slot]} variant={chosenSlot === slot ? 'primary' : 'secondary'} onPress={() => update($, slotChoice, () => slot)} />)}
        </Box>
        {canCraftSet ? <Button key="smith-craft-set" label={T.smithCraftSet(T.setName[recipe.id] ?? recipe.id, T.slot[chosenSlot])} onPress={() => craftSetGear($, recipe.id, chosenSlot)} /> : <Text dimColor>{T.reward.item(T.bagItem[recipe.ore] ?? recipe.ore, 20)}　{T.smithNeedMore}</Text>}
      </Box>
      <Box flexDirection="column" borderStyle="round" paddingX={1}>
        <Text bold>{T.smithBossTitle}</Text>
        {BOSS_RECIPES.map(item => {
          const name = T.bossGearName[item.id] ?? item.id
          const shard = `boss-shard-${item.chapter}`
          const hasItem = owned.some(gear => gear.unique === item.id)
          const canCraft = !hasItem && save.stash.length < STASH_CAP && (save.bag[shard] ?? 0) > 0 && (save.bag[item.ore] ?? 0) >= 10
          return (
            <Box key={`smith-boss-${item.id}`} flexDirection="column">
              <Text>{name} — {T.smithBossEffects[item.id] ?? ''}</Text>
              <Text dimColor>{T.reward.item(T.bagItem[shard] ?? shard, save.bag[shard] ?? 0)}　{T.reward.item(T.bagItem[item.ore] ?? item.ore, save.bag[item.ore] ?? 0)}</Text>
              {hasItem ? <Text dimColor>{T.smithBossOwned}</Text> : canCraft ? <Button key={`smith-craft-boss-${item.id}`} label={T.smithBossCraft(name)} onPress={() => craftBossGearAction($, item.id)} /> : <Box />}
            </Box>
          )
        })}
        {allBossGear ? <Text color="#ffd60a">{T.titleName['smith-bosskiller'] ?? ''}</Text> : <Box />}
      </Box>
      <Box flexDirection="column" borderStyle="round" paddingX={1}>
        <Text bold>{T.smithGoldTrimTitle}</Text>
        <Text dimColor>{T.smithGoldTrimComing}</Text>
      </Box>
    </Box>
  )
}
