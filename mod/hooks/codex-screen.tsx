import { atom, read, update } from 'claude-code'
import type { RenderElement } from 'claude-code'

import type { SaveData } from '../types'
import { claimCodexReward } from './actions'
import type { Reward } from './calendar'
import type { CategoryId } from './codex'
import { CHAPTERS, CHAPTER_COUNT } from './world'
import { BOSS_IDS, CATEGORIES, DISH_IDS, ORE_IDS, READ_COUNTS, categoryCount, categoryEntries, claimable, codexRate, mobStars } from './codex'
import { BOSS_GEAR_IDS, NAME_VARIANTS, RARITY_COUNT, SET_IDS, SLOTS, codexPowerRate } from './gear'
import { CROPS } from './farm'
import type { $ } from './persist'
import { T } from './texts'
import { facilityHeader, itemIcon } from './visual-parts'

// 図鑑のサブ画面（暦タブ →「図鑑」）。文字とボタンだけ（絵は Opus が後で）。

type Els = ReturnType<$['ui']['resolve']>

/** 図鑑で開いている欄と、読んでいる読み物 */
const codexSection = atom({ plugin: 'debug-legend', key: 'codexSection' } as const, 'mobs')
const codexRead = atom({ plugin: 'debug-legend', key: 'codexRead' } as const, '')
/** 雑魚の欄で開いている章（空 = いまの章） */
const codexMobChapter = atom({ plugin: 'debug-legend', key: 'codexMobChapter' } as const, '')

/** daily-screens.tsx から渡す部品（ごほうびの文・案内役の説明の吹き出し） */
export type CodexTools = { rewardText: (save: SaveData, rewards: readonly Reward[]) => string; intro: RenderElement | null }

const mark = (got: boolean): string => (got ? '●' : '○')

/** 読み物の本文 */
function readText(kind: string, index: number): string {
  if (kind === 'mine') return T.mineDiary[index] ?? ''
  if (kind === 'master') return T.codexMaster[index] ?? ''
  if (kind === 'nox') return T.noxStories[index] ?? ''
  if (kind === 'scholar') return T.codexScholar[index] ?? ''
  return T.sealedStories[index] ?? ''
}

const READ_KINDS = ['mine', 'master', 'nox', 'scholar', 'sealed'] as const

/** 欄の中身 */
async function sectionBody($: $, els: Els, save: SaveData, category: CategoryId): Promise<RenderElement> {
  const { Box, Button, Text } = els
  const entries = categoryEntries(save, category)
  const gotOf = (id: string): boolean => entries.find(entry => entry.id === id)?.got === true

  if (category === 'mobs') {
    // 雑魚は章ごとに見る（1 章 30 種）。初めはいまの章
    const stored = Number(await read($, codexMobChapter))
    const chapter = Number.isInteger(stored) && stored >= 1 && stored <= CHAPTER_COUNT ? stored : Math.min(CHAPTER_COUNT, Math.max(1, save.stage.chapter))
    const ids = CHAPTERS[chapter - 1]?.enemies ?? []
    const gotIn = (ids_: readonly string[]): number => ids_.filter(id => (save.codex.kills[id] ?? 0) >= 1).length

    return (
      <Box flexDirection="column">
        <Text dimColor>{T.codexMobHint}</Text>
        <Box flexDirection="row" flexWrap="wrap" gap={1}>
          {CHAPTERS.map((data, i) => (
            <Button
              key={`codex-mob-chapter-${i + 1}`}
              label={T.codexMobChapter(i + 1, gotIn(data.enemies), data.enemies.length)}
              variant={i + 1 === chapter ? 'primary' : 'secondary'}
              onPress={() => update($, codexMobChapter, () => String(i + 1))}
            />
          ))}
        </Box>
        <Text bold>{T.codexMobChapterLine(chapter, gotIn(ids), ids.length)}</Text>
        {ids.map(id => {
          const kills = save.codex.kills[id] ?? 0
          return <Text key={`codex-mob-${id}`}>{T.codexMob(kills > 0 ? (T.enemy[id] ?? id) : T.codexUnknown, kills, mobStars(kills))}</Text>
        })}
      </Box>
    )
  }
  if (category === 'bosses') {
    return (
      <Box flexDirection="column">
        {BOSS_IDS.map((id, i) => {
          const got = gotOf(id)
          const times = [save.codex.bossBest[i + 1] ?? 0, save.seal.trials[i + 1]?.best ?? 0].filter(time => time > 0)
          const best = times.length > 0 ? T.codexBest(Math.min(...times)) : ''
          return <Text key={`codex-boss-${id}`}>{T.codexBoss(got ? (T.enemy[id] ?? id) : T.codexUnknown, save.codex.bossWins[i + 1] ?? 0, got ? best : '')}</Text>
        })}
        <Text key="codex-boss-origin" color="#c8a2ff">
          {T.codexBoss(gotOf('origin-moth') ? T.originMoth : T.codexUnknown, save.seal.trueBoss.beaten, gotOf('origin-moth') && save.seal.trueBoss.best > 0 ? T.codexBest(save.seal.trueBoss.best) : '')}
        </Text>
      </Box>
    )
  }
  if (category === 'gear') {
    return (
      <Box flexDirection="column">
        <Text dimColor>{T.codexGearHint}</Text>
        {SLOTS.flatMap(slot =>
          Array.from({ length: NAME_VARIANTS }, (_, name) => {
            const marks = Array.from({ length: RARITY_COUNT }, (_, rarity) => mark(gotOf(`gear:${slot}:${name}:${rarity}`))).join(' ')
            return <Text key={`codex-gear-${slot}-${name}`}>{T.codexGearRow(T.slot[slot], T.itemBase[slot][name] ?? '', marks)}</Text>
          }),
        )}
        <Text dimColor>{T.codexSetHint}</Text>
        {SET_IDS.map(set => (
          <Text key={`codex-set-${set}`}>{T.codexSetRow(T.setName[set] ?? set, SLOTS.map(slot => mark(gotOf(`set:${set}:${slot}`))).join(' '))}</Text>
        ))}
        <Text dimColor>{T.codexBossGearHint}</Text>
        <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
          {BOSS_GEAR_IDS.map(id => (
            <Text key={`codex-bossgear-${id}`}>{T.codexItem(T.bossGearName[id] ?? id, gotOf(`boss:${id}`))}</Text>
          ))}
        </Box>
      </Box>
    )
  }
  if (category === 'crops') {
    return (
      <Box flexDirection="column">
        {CROPS.map(crop => (
          <Text key={`codex-crop-${crop.id}`}>{T.codexCrop(T.farmCropName[crop.id] ?? crop.id, gotOf(`crop:${crop.id}`), gotOf(`gold:${crop.id}`))}</Text>
        ))}
      </Box>
    )
  }
  if (category === 'dishes') {
    return (
      <Box flexDirection="column">
        {DISH_IDS.map(id => (
          <Text key={`codex-dish-${id}`}>{T.codexItem(T.farmRecipeName[id] ?? id, gotOf(`dish:${id}`))}</Text>
        ))}
      </Box>
    )
  }
  if (category === 'ores') {
    return (
      <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
        {ORE_IDS.map(id => (
          <Box key={`codex-ore-${id}`} flexDirection="row" gap={1} alignItems="center">
            {gotOf(`ore:${id}`) ? (itemIcon(els, id, 20) ?? <Box />) : <Box />}
            <Text>{T.codexItem(T.bagItem[id] ?? id, gotOf(`ore:${id}`))}</Text>
          </Box>
        ))}
      </Box>
    )
  }
  if (category === 'fossils') {
    return (
      <Box flexDirection="column">
        {Array.from({ length: entries.length }, (_, i) => (
          <Text key={`codex-fossil-${i}`}>{T.codexItem(T.mineFossilName[i] ?? '', gotOf(`fossil:${i + 1}`))}</Text>
        ))}
      </Box>
    )
  }
  if (category === 'pets') {
    return (
      <Box flexDirection="column">
        <Text dimColor>{T.codexPetHint}</Text>
        {[0, 1].map(slot => {
          const pet = save.pets.owned[slot]
          return (
            <Text key={`codex-pet-${slot}`}>{T.codexPet(T.codexPetSlot(slot + 1, pet === undefined ? undefined : (T.petSpeciesName[pet.species] ?? pet.species)), [1, 2, 3].map(form => mark(gotOf(`pet:${slot}:${form}`))).join(' '))}</Text>
          )
        })}
      </Box>
    )
  }
  // 読み物
  const opened = await read($, codexRead)
  const [openedKind = '', openedIndex = '-1'] = opened.split(':')

  return (
    <Box flexDirection="column" gap={1}>
      {READ_KINDS.map(kind => {
        const total = READ_COUNTS[kind]
        const got = Array.from({ length: total }, (_, i) => i).filter(i => gotOf(`read:${kind}:${i}`))
        const name = T.codexReadName[kind] ?? kind
        return (
          <Box key={`codex-read-${kind}`} flexDirection="column">
            <Text>{T.codexReadLine(name, got.length, total)}</Text>
            <Box flexDirection="row" flexWrap="wrap" gap={1}>
              {got.map(i => (
                <Button key={`codex-read-open-${kind}-${i}`} label={T.codexReadOpen(name, i + 1)} onPress={() => update($, codexRead, () => `${kind}:${i}`)} />
              ))}
            </Box>
          </Box>
        )
      })}
      {opened !== '' && gotOf(`read:${openedKind}:${openedIndex}`) ? (
        <Box flexDirection="column" borderStyle="round" paddingX={1}>
          <Text bold>{T.codexReadOpen(T.codexReadName[openedKind] ?? openedKind, Number(openedIndex) + 1)}</Text>
          <Text>{readText(openedKind, Number(openedIndex))}</Text>
          <Button key="codex-read-close" label={T.codexReadClose} onPress={() => update($, codexRead, () => '')} />
        </Box>
      ) : (
        <Box />
      )}
    </Box>
  )
}

/** 図鑑のサブ画面 */
export async function codexView($: $, els: Els, save: SaveData, tools: CodexTools): Promise<RenderElement> {
  const { Box, Button, Text } = els
  const stored = await read($, codexSection)
  const current: CategoryId = (CATEGORIES as readonly string[]).includes(stored) ? (stored as CategoryId) : 'mobs'
  const rate = codexRate(save)
  const claims = claimable(save)
  const power = Math.round(codexPowerRate(save) * 100)

  return (
    <Box flexDirection="column" gap={1}>
      {facilityHeader(els, 'codex') ?? <Box />}
      {tools.intro}
      <Box flexDirection="column">
        <Text bold>{T.codexTitle}</Text>
        <Text color="#ffd60a">{T.codexRate(rate.got, rate.total, rate.pct.toFixed(1))}</Text>
        {power > 0 ? <Text dimColor>{T.codexPowerNow(power)}</Text> : <Text dimColor>{T.codexMobHint}</Text>}
      </Box>
      <Box flexDirection="column">
        <Text bold>{T.codexClaimTitle}</Text>
        {claims.length === 0 ? <Text dimColor>{T.codexClaimNone}</Text> : <Box />}
        {claims.map(claim => {
          const pct = /^tier:(\d+)$/.exec(claim.id)
          const text =
            pct !== null
              ? T.codexTierLine(Number(pct[1]), tools.rewardText(save, claim.rewards), claim.power > 0 ? T.codexTierPower(Math.round(claim.power * 100)) : '')
              : T.codexCatLine(T.codexCat[claim.id.replace('cat:', '')] ?? claim.id, tools.rewardText(save, claim.rewards))
          return (
            <Box key={`codex-claim-${claim.id}`} flexDirection="row" flexWrap="wrap" columnGap={1}>
              <Text color="#ffd60a">★ {text}</Text>
              <Button key={`codex-claim-btn-${claim.id}`} label={T.codexClaim} variant="primary" onPress={() => claimCodexReward($, claim.id)} />
            </Box>
          )
        })}
      </Box>
      <Box flexDirection="row" flexWrap="wrap" gap={1}>
        {CATEGORIES.map(category => {
          const count = categoryCount(save, category)
          return (
            <Button
              key={`codex-cat-${category}`}
              label={T.codexCatButton(T.codexCat[category] ?? category, count.got, count.total)}
              variant={category === current ? 'primary' : 'secondary'}
              onPress={() => update($, codexSection, () => category)}
            />
          )
        })}
      </Box>
      <Box flexDirection="column">{await sectionBody($, els, save, current)}</Box>
    </Box>
  )
}
