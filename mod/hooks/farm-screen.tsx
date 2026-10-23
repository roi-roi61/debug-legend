import { atom, read, update } from 'claude-code'
import type { RenderElement } from 'claude-code'

import type { Buff, SaveData } from '../types'
import {
  buildFarmDecor,
  buildFarmGreenhouse,
  buyGreenhouseFlowerSeed,
  buyRanchAnimal,
  chooseFarmSign,
  collectRanchProduct,
  cookRecipe,
  clearFarmPest,
  expandFarmPlots,
  feedRanchAnimal,
  fertilizePlot,
  harvestPlot,
  installFarmSprinkler,
  patRanchAnimal,
  plantCrop,
  replayIntro,
} from './actions'
import { foodBuffs } from './buffs'
import { introBox } from './daily-screens'
import { fieldSvg, ranchSvg } from './farm-art'
import { isNew, priceUnit } from './calendar'
import {
  ANIMALS,
  DECOR,
  GREENHOUSE_BASE,
  GREENHOUSE_COST,
  GREENHOUSE_PLOTS,
  FLOWER_SEED_PRICE,
  RICH_AFFINITY,
  SIGN_NAMES,
  animalStatus,
  cookStatus,
  dishRate,
  farmLevel,
  growable,
  ingredientRate,
  isBigFarmOpen,
  isGreenhouseIndex,
  knownRecipes,
  levelCap,
  nextExpansion,
  plotAt,
  plotView,
  xpForLevel,
  weatherOn,
} from './farm'
import type { Recipe } from './farm'
import type { $ } from './persist'
import { today } from './persist'
import { T } from './texts'

type Els = ReturnType<$['ui']['resolve']>
type KitchenView = 'farm' | 'kitchen' | 'ranch'

/** 1 ページに並べる区画の数と、畑のページ（0〜2 = 畑 1〜3、3 = 温室） */
const PAGE_SIZE = 12
const GREENHOUSE_PAGE = 3
const farmPage = atom({ plugin: 'debug-legend', key: 'farmPage' } as const, 0)

const cropName = (id: string): string => T.farmCropName[id] ?? id

function duration(ms: number): string {
  const minutes = Math.max(0, Math.ceil(ms / 60_000))

  return T.farmTime(Math.floor(minutes / 60), minutes % 60)
}

function recipeName(id: string): string {
  return T.farmRecipeName[id] ?? id
}

function ingredientText(recipe: Recipe): string {
  return Object.entries(recipe.needs)
    .map(([item, count]) => `${T.farmCropName[item] ?? T.bagItem[item] ?? item} ×${count}`)
    .join('・') || '—'
}

function recipeEffect(save: SaveData, recipe: Recipe): string {
  if (recipe.stored !== undefined) {
    return T.farmRecipeStored(T.bagItem[recipe.stored] ?? recipe.stored)
  }
  if (recipe.buff === undefined) {
    return T.farmRecipeFuture
  }
  const rate = dishRate(recipe.buff.rate, ingredientRate(save, recipe))
  const name = T.buffName[recipe.buff.kind] ?? recipe.buff.kind
  if (recipe.buff.charges !== undefined) {
    return T.farmRecipeCharges(name, Math.round(rate * 100), recipe.buff.charges)
  }

  return T.farmRecipeEffect(name, Math.round(rate * 100), Math.ceil((recipe.buff.seconds ?? 0) / 60))
}

function activeFoodLine(save: SaveData, buff: Buff): string {
  const name = recipeName(buff.dish ?? '')
  const effect = `${T.buffName[buff.kind] ?? buff.kind} +${Math.round(buff.rate * 100)}%`
  const left = buff.charges !== undefined
    ? T.farmUseCount(buff.charges)
    : duration(Math.max(0, (buff.until ?? save.battleSeconds) - save.battleSeconds) * 1_000)

  return T.farmActiveFood(name, effect, left)
}

function plotSection($: $, els: Els, save: SaveData, index: number, now: number) {
  const { Box, Button, Text } = els
  const plot = plotAt(save, index)
  const view = plot == null ? undefined : plotView(save, index, now)
  // ユニコードの花は温室でだけ育つ
  const seeds = growable(save).filter(crop => (save.bag[`seed-${crop.id}`] ?? 0) > 0 && (crop.id !== 'flower' || isGreenhouseIndex(index)))

  return (
    <Box key={`farm-plot-${index}`} flexDirection="column" borderStyle="round" paddingX={1}>
      <Text bold>{isGreenhouseIndex(index) ? T.bfGreenhousePlot(index - GREENHOUSE_BASE + 1) : T.farmPlotTitle(index + 1)}</Text>
      {plot == null ? (
        <>
          <Text dimColor>{T.farmEmptyPlot}</Text>
          {seeds.length === 0 ? (
            <Text dimColor>{T.farmNoSeeds}</Text>
          ) : (
            <Box flexDirection="row" flexWrap="wrap" gap={1}>
              {seeds.map(crop => (
                <Button
                  key={`farm-plant-${index}-${crop.id}`}
                  label={T.farmPlant(cropName(crop.id))}
                  onPress={() => plantCrop($, index, crop.id)}
                />
              ))}
            </Box>
          )}
        </>
      ) : view === undefined ? (
        <Text dimColor>{T.farmEmptyPlot}</Text>
      ) : (
        <Box flexDirection="column">
          <Text>{T.farmPlotStatus(cropName(plot.crop), T.farmStageNames[view.stage] ?? '', Math.floor((view.grown / Math.max(1, view.need)) * 100), view.isRipe ? T.farmRipe : duration(view.leftMs))}</Text>
          {view.isOverripe ? <Text color="#d4a373">{T.farmOverripe}</Text> : null}
          {plot.fert ? <Text dimColor>{T.farmFertilized}</Text> : null}
          {view.hasBug ? (
            <Box flexDirection="row" gap={1}>
              <Text color="#ff6b6b">{T.farmHasPest}</Text>
              <Button key={`farm-pest-${index}`} label={T.farmKillPest} variant="primary" onPress={() => clearFarmPest($, index)} />
            </Box>
          ) : view.isRipe ? (
            <Button key={`farm-harvest-${index}`} label={T.farmHarvest} variant="primary" onPress={() => harvestPlot($, index)} />
          ) : (save.bag.fertilizer ?? 0) > 0 && !plot.fert ? (
            <Button key={`farm-fertilize-${index}`} label={T.farmFertilize} onPress={() => fertilizePlot($, index)} />
          ) : null}
        </Box>
      )}
    </Box>
  )
}

function kitchenSection($: $, els: Els, save: SaveData) {
  const { Box, Button, Text } = els
  const recipes = knownRecipes(save)
  const foods = foodBuffs(save)

  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="column">
        <Text bold>{T.farmKitchenTitle}</Text>
        <Text>{T.farmFoodSlotCount(foods.length)}</Text>
        {foods.length === 0 ? <Text dimColor>{T.farmActiveFoodNone}</Text> : foods.map(buff => <Text key={`food-${buff.dish}`}>{activeFoodLine(save, buff)}</Text>)}
      </Box>
      <Box flexDirection="column">
        <Text bold>{T.farmRecipesTitle}</Text>
        {recipes.length === 0 ? <Text dimColor>{T.farmNoRecipes}</Text> : null}
        {recipes.map(recipe => {
          const name = recipeName(recipe.id)
          const status = cookStatus(save, recipe.id)
          let statusLine: string | null = null
          if (status === 'locked') statusLine = T.farmLockedRecipe
          else if (status === 'short') statusLine = T.farmMissingMaterials
          else if (status === 'slots') statusLine = T.farmFoodSlotsFull
          else if (status === 'weaker') statusLine = T.farmFoodWeaker

          return (
            <Box key={`farm-recipe-${recipe.id}`} flexDirection="column" borderStyle="round" paddingX={1}>
              <Text bold>{name}</Text>
              <Text dimColor>{T.farmMaterials(ingredientText(recipe))}</Text>
              <Text>{recipeEffect(save, recipe)}</Text>
              {status === 'ok' ? <Button key={`farm-cook-${recipe.id}`} label={`${T.farmCook}: ${name}`} variant="primary" onPress={() => cookRecipe($, recipe.id)} /> : <Text dimColor>{statusLine}</Text>}
            </Box>
          )
        })}
      </Box>
    </Box>
  )
}

function costText(save: SaveData, gold: number, wood: number, iron: number): string {
  void save
  return [T.gold(gold), wood > 0 ? T.reward.item(T.bagItem.wood ?? '', wood) : '', iron > 0 ? T.reward.item(T.bagItem['ore-iron'] ?? '', iron) : ''].filter(text => text !== '').join('・')
}

/** 大農場の設備: 区画の拡張・温室・スプリンクラー・飾り */
function bigFarmSection($: $, els: Els, save: SaveData) {
  const { Box, Button, Text } = els
  const p = priceUnit(save)
  const level = farmLevel(save)
  const expansion = nextExpansion(save)
  const maxSprinklers = Math.floor(save.farm.plots.length / 6)
  const woodHave = save.bag.wood ?? 0
  const ironHave = save.bag['ore-iron'] ?? 0
  const canAfford = (gold: number, wood: number, iron: number): boolean => save.gold >= gold && woodHave >= wood && ironHave >= iron
  const sign = save.farm.signName > 0 && save.farm.decor.includes('sign') ? T.bfSignNames[save.farm.signName - 1] : undefined

  return (
    <Box flexDirection="column" gap={1} borderStyle="round" paddingX={1}>
      <Text bold>{sign === undefined ? T.bfTitle : T.bfTitleNamed(sign)}</Text>
      <Text dimColor>{T.bfMaterials(woodHave, ironHave)}</Text>
      {expansion === undefined ? (
        <Text dimColor>{T.bfExpandMax}</Text>
      ) : level >= expansion.lv && canAfford(Math.round(p * expansion.gold), expansion.wood, expansion.iron) ? (
        <Button key="bf-expand" label={T.bfExpand(expansion.to, costText(save, Math.round(p * expansion.gold), expansion.wood, expansion.iron))} onPress={() => expandFarmPlots($)} />
      ) : (
        <Text dimColor>{T.bfExpandShort(expansion.to, expansion.lv, costText(save, Math.round(p * expansion.gold), expansion.wood, expansion.iron))}</Text>
      )}
      {save.farm.greenhouse.length > 0 ? (
        <Box flexDirection="row" flexWrap="wrap" gap={1}>
          <Text dimColor>{T.bfGreenhouseBuilt(GREENHOUSE_PLOTS)}</Text>
          {save.gold >= Math.round(p * FLOWER_SEED_PRICE) ? (
            <Button key="bf-flower-seed" label={T.bfFlowerSeed(T.gold(Math.round(p * FLOWER_SEED_PRICE)), save.bag['seed-flower'] ?? 0)} onPress={() => buyGreenhouseFlowerSeed($)} />
          ) : (
            <Text dimColor>{T.bfFlowerSeed(T.gold(Math.round(p * FLOWER_SEED_PRICE)), save.bag['seed-flower'] ?? 0)}</Text>
          )}
        </Box>
      ) : level >= GREENHOUSE_COST.lv && canAfford(Math.round(p * GREENHOUSE_COST.gold), GREENHOUSE_COST.wood, GREENHOUSE_COST.iron) ? (
        <Button key="bf-greenhouse" label={T.bfGreenhouse(costText(save, Math.round(p * GREENHOUSE_COST.gold), GREENHOUSE_COST.wood, GREENHOUSE_COST.iron))} onPress={() => buildFarmGreenhouse($)} />
      ) : (
        <Text dimColor>{T.bfGreenhouseShort(GREENHOUSE_COST.lv, costText(save, Math.round(p * GREENHOUSE_COST.gold), GREENHOUSE_COST.wood, GREENHOUSE_COST.iron))}</Text>
      )}
      <Box flexDirection="row" flexWrap="wrap" gap={1}>
        <Text>{T.bfSprinklers(save.farm.sprinklers, maxSprinklers)}</Text>
        {(save.bag.sprinkler ?? 0) > 0 && save.farm.sprinklers < maxSprinklers ? (
          <Button key="bf-sprinkler" label={T.bfInstallSprinkler(save.bag.sprinkler ?? 0)} onPress={() => installFarmSprinkler($)} />
        ) : (
          <Text dimColor>{T.bfSprinklerHint}</Text>
        )}
      </Box>
      <Text bold>{T.bfDecorTitle}</Text>
      {DECOR.map(item => {
        const owned = save.farm.decor.includes(item.id)
        const gold = Math.round(p * item.gold)
        return owned ? (
          <Text key={`bf-decor-${item.id}`}>✓ {T.bfDecorName[item.id] ?? item.id} — {T.bfDecorNote[item.id] ?? ''}</Text>
        ) : canAfford(gold, item.wood, 0) ? (
          <Button key={`bf-decor-${item.id}`} label={T.bfDecorBuild(T.bfDecorName[item.id] ?? item.id, T.bfDecorNote[item.id] ?? '', costText(save, gold, item.wood, 0))} onPress={() => buildFarmDecor($, item.id)} />
        ) : (
          <Text key={`bf-decor-${item.id}`} dimColor>{T.bfDecorBuild(T.bfDecorName[item.id] ?? item.id, T.bfDecorNote[item.id] ?? '', costText(save, gold, item.wood, 0))}</Text>
        )
      })}
      {save.farm.decor.includes('sign') ? (
        <Box flexDirection="column">
          <Text>{T.bfSignTitle}</Text>
          <Box flexDirection="row" flexWrap="wrap" gap={1}>
            {Array.from({ length: SIGN_NAMES }, (_, i) => i + 1).map(n => (
              <Button key={`bf-sign-${n}`} label={T.bfSignNames[n - 1] ?? ''} variant={save.farm.signName === n ? 'primary' : 'secondary'} onPress={() => chooseFarmSign($, n)} />
            ))}
          </Box>
        </Box>
      ) : <Box />}
    </Box>
  )
}

/** 牧場: 家畜を買う・エサをあげる・なでる・産物をとる */
function ranchSection($: $, els: Els, save: SaveData, now: number, day: string) {
  const { Box, Button, Text } = els
  const p = priceUnit(save)

  return (
    <Box flexDirection="column" gap={1}>
      <Text bold>{T.ranchTitle}</Text>
      {isBigFarmOpen(save) ? <Text dimColor>{T.ranchHint(RICH_AFFINITY)}</Text> : <Text dimColor>{T.ranchLocked}</Text>}
      {ANIMALS.map(kind => {
        const animal = save.farm.animals[kind.id]
        const name = T.ranchAnimalName[kind.id] ?? kind.id
        const product = T.bagItem[kind.product] ?? kind.product
        if (animal === undefined) {
          const price = Math.round(p * kind.price)
          return (
            <Box key={`ranch-${kind.id}`} flexDirection="column" borderStyle="round" paddingX={1}>
              <Text bold>{name}</Text>
              <Text dimColor>{T.ranchInfo(product, kind.hours, kind.feed === null ? T.ranchNoFeed : T.farmCropName[kind.feed] ?? kind.feed)}</Text>
              {save.gold >= price ? <Button key={`ranch-buy-${kind.id}`} label={T.ranchBuy(name, T.gold(price))} onPress={() => buyRanchAnimal($, kind.id)} /> : <Text dimColor>{T.ranchBuy(name, T.gold(price))}</Text>}
            </Box>
          )
        }
        const status = animalStatus(save, kind.id, now)
        const minutes = Math.max(0, Math.ceil((status?.leftMs ?? 0) / 60_000))
        const hasFeed = kind.feed === null || ['q1', 'q2', 'q3', 'gold'].some(q => (save.bag[`crop-${kind.feed}-${q}`] ?? 0) > 0)
        const hasFlower = ['q1', 'q2', 'q3', 'gold'].some(q => (save.bag[`crop-flower-${q}`] ?? 0) > 0)
        return (
          <Box key={`ranch-${kind.id}`} flexDirection="column" borderStyle="round" paddingX={1}>
            <Text bold>{name}　{T.ranchAffinity(animal.affinity)}{status?.isRich ? ` ${T.ranchRich}` : ''}</Text>
            <Text>{status?.state === 'ready' ? T.ranchReady(product) : status?.state === 'working' ? T.ranchWorking(product, T.farmTime(Math.floor(minutes / 60), minutes % 60)) : T.ranchHungry(kind.feed === null ? T.ranchNoFeed : T.farmCropName[kind.feed] ?? kind.feed)}</Text>
            <Box flexDirection="row" flexWrap="wrap" gap={1}>
              {status?.state === 'ready' ? <Button key={`ranch-collect-${kind.id}`} label={T.ranchCollect(product)} variant="primary" onPress={() => collectRanchProduct($, kind.id)} /> : <Box />}
              {status?.state === 'hungry' && hasFeed ? <Button key={`ranch-feed-${kind.id}`} label={T.ranchFeed} variant="primary" onPress={() => feedRanchAnimal($, kind.id)} /> : <Box />}
              {status?.state === 'hungry' && kind.id === 'bee' && hasFlower ? <Button key={`ranch-feed-flower-${kind.id}`} label={T.ranchFeedFlower} onPress={() => feedRanchAnimal($, kind.id, true)} /> : <Box />}
              {animal.patDay !== day ? <Button key={`ranch-pat-${kind.id}`} label={T.ranchPat} onPress={() => patRanchAnimal($, kind.id)} /> : <Text dimColor>{T.ranchPatDone}</Text>}
            </Box>
          </Box>
        )
      })}
    </Box>
  )
}

/** 農場か台所か牧場のサイド画面。区画の成長や害虫は表示時に計算し、毎秒はセーブしない */
/** 畑の絵（デスクトップ・スマホ）。区画ごとの作物の育ち・バグ・実り、今日の天気 */
function fieldPicture(els: Els, save: SaveData, indexes: readonly number[], now: number, weather: string, isGreenhouse: boolean): RenderElement | null {
  if (!('Svg' in els)) {
    return null
  }
  const { Svg } = els
  const plots = indexes.map(index => {
    const plot = plotAt(save, index)
    const view = plot == null ? undefined : plotView(save, index, now)
    return plot == null || view === undefined ? { stage: 0, hasBug: false, isRipe: false } : { crop: plot.crop, stage: view.stage, hasBug: view.hasBug, isRipe: view.isRipe }
  })
  const key = plots.map(p => `${p.crop ?? '-'}${p.stage}${p.hasBug ? 'b' : ''}${p.isRipe ? 'r' : ''}`).join('.')

  return <Svg key={`field-${key}-${weather}-${isGreenhouse ? 'g' : ''}`} source={fieldSvg(plots, weather, isBigFarmOpen(save), isGreenhouse)} alt={T.gatherView.farm ?? ''} width={340} height={160} isInteractive />
}

/** 牧場の絵（持っている家畜が歩く） */
function ranchPicture(els: Els, save: SaveData): RenderElement | null {
  if (!('Svg' in els)) {
    return null
  }
  const { Svg } = els
  const owned = Object.keys(save.farm.animals ?? {})

  return <Svg key={`ranch-${owned.join('+')}`} source={ranchSvg(owned)} alt={T.ranchTitle} width={340} height={160} isInteractive />
}

export async function farmScreen($: $, els: Els, save: SaveData, view: KitchenView): Promise<RenderElement> {
  const { Box, Button, Text } = els
  const now = await $.clock.now()
  const day = await today($)
  const level = farmLevel(save)
  const nextXp = level < levelCap(save) ? xpForLevel(level + 1) : 0
  const intro = isNew(save, 'farm') ? await introBox($, els, 'farm') : null
  const bigIntro = isNew(save, 'bigfarm') ? await introBox($, els, 'bigfarm') : null
  const weather = T.farmWeatherName[weatherOn(save, day)] ?? weatherOn(save, day)
  const last = save.farm.last
  const pages = Math.max(1, Math.ceil(save.farm.plots.length / PAGE_SIZE))
  const hasGreenhouse = save.farm.greenhouse.length > 0
  const stored = await read($, farmPage)
  const page = stored === GREENHOUSE_PAGE && hasGreenhouse ? GREENHOUSE_PAGE : Math.min(stored, pages - 1)
  const indexes = page === GREENHOUSE_PAGE
    ? save.farm.greenhouse.map((_, i) => GREENHOUSE_BASE + i)
    : save.farm.plots.map((_, i) => i).slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  return (
    <Box flexDirection="column" gap={1}>
      {intro}
      {view === 'ranch' ? null : bigIntro}
      {view === 'farm' ? (
        <Box flexDirection="column" gap={1}>
          <Box flexDirection="column">
            <Text bold>{T.farmLevelLine(level, save.farm.xp, nextXp)}</Text>
            <Text>{T.farmTodayWeather(weather)}</Text>
            <Text dimColor>{T.farmBugsKilled(save.farm.bugsKilled)}</Text>
            {growable(save).some(crop => (save.bag[`seed-${crop.id}`] ?? 0) > 0) ? (
              <Text dimColor>
                {growable(save).filter(crop => (save.bag[`seed-${crop.id}`] ?? 0) > 0).map(crop => T.farmSeedCount(cropName(crop.id), save.bag[`seed-${crop.id}`] ?? 0)).join('　')}
              </Text>
            ) : null}
          </Box>
          {isBigFarmOpen(save) ? bigFarmSection($, els, save) : null}
          {pages > 1 || hasGreenhouse ? (
            <Box flexDirection="row" flexWrap="wrap" gap={1}>
              {Array.from({ length: pages }, (_, i) => i).map(i => (
                <Button key={`farm-page-${i}`} label={T.bfPage(i + 1)} variant={page === i ? 'primary' : 'secondary'} onPress={() => update($, farmPage, () => i)} />
              ))}
              {hasGreenhouse ? <Button key="farm-page-gh" label={T.bfGreenhouseTab} variant={page === GREENHOUSE_PAGE ? 'primary' : 'secondary'} onPress={() => update($, farmPage, () => GREENHOUSE_PAGE)} /> : null}
            </Box>
          ) : null}
          {fieldPicture(els, save, indexes, now, weatherOn(save, day), page === GREENHOUSE_PAGE) ?? <Box />}
          <Box flexDirection="column" gap={1}>
            {indexes.map(index => plotSection($, els, save, index, now))}
          </Box>
        </Box>
      ) : view === 'ranch' ? (
        <Box flexDirection="column" gap={1}>
          {ranchPicture(els, save) ?? <Box />}
          {ranchSection($, els, save, now, day)}
        </Box>
      ) : (
        kitchenSection($, els, save)
      )}
      {view === 'farm' && last !== null ? <Text>{T.farmLastHarvest(cropName(last.crop), T.farmQualityName[last.quality] ?? last.quality, last.amount, last.stars, last.isOverripe)}</Text> : null}
      {intro === null ? <Button key="intro-again-farm" label={T.farmIntroAgain} onPress={() => replayIntro($, 'farm')} /> : null}
    </Box>
  )
}
