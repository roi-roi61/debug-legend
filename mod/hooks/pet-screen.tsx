import type { RenderElement } from 'claude-code'

import type { Pet, SaveData } from '../types'
import { activatePet, choosePairPetEgg, choosePetEgg, evolveCompanion, equipPetCollar, feedCompanion, namePet, patPet, removePetCollar, toggleCompanion } from './actions'
import { READY, isNew, isUnlocked } from './calendar'
import { introBox } from './daily-screens'
import { petPortrait } from './visual-parts'
import { PAIR_SPECIES, activePair, activePets, STARTER_SPECIES, effectsForPet, isPetAway, petExpToNext } from './pets'
import type { $ } from './persist'
import { today } from './persist'
import { T } from './texts'

type Els = ReturnType<$['ui']['resolve']>

export const hasPets = (save: SaveData): boolean => READY.has('pet') && isUnlocked(save, 'pet')

function flowerCount(save: SaveData): number {
  return ['gold', 'q3', 'q2', 'q1'].reduce((sum, quality) => sum + (save.bag[`crop-flower-${quality}`] ?? 0), 0)
}

function petAssistLine(pet: Pet, save: SaveData): string {
  const effect = effectsForPet(pet, save.job)
  const text = T.petAssist as Record<string, (a: number, b: number) => string>
  switch (pet.species) {
    case 'duck': return text.duck?.(Math.round(effect.protectRate * 100), Math.round(effect.hpRate * 100)) ?? ''
    case 'drake': return text.drake?.(Math.round(effect.attackRate * 100), pet.form === 3 ? 5 : 0) ?? ''
    case 'fox': return text.fox?.(Math.round(effect.critRate * 100), Math.round(effect.attackRate * 100)) ?? ''
    case 'owl': return text.owl?.(Math.round(effect.bossSeconds), Math.round(effect.expRate * 100)) ?? ''
    case 'golem': return text.golem?.(Math.round(effect.attackRate * 100), Math.round(effect.mineRate * 100)) ?? ''
    case 'whale': return text.whale?.(Math.round(effect.luckRate * 100), 0) ?? ''
  }
}

function petCard($: $, els: Els, save: SaveData, pet: Pet, day: string) {
  const { Box, Button, Text } = els
  const away = isPetAway(save, pet.id)
  const active = save.pets.active.includes(pet.id) && !away
  const form = T.petFormNames[pet.species]?.[pet.form - 1] ?? T.petSpeciesName[pet.species] ?? pet.species
  const names = T.petNames[pet.species] ?? []
  const pats = save.pets.pats.day === day ? save.pets.pats.count : 0
  const flowers = flowerCount(save)
  const collars = Object.entries(save.bag).filter(([id, count]) => count > 0 && /^collar-(speed|greed|luck|guard|exp|crit)-r[1-5]$/.test(id))

  return (
    <Box key={`pet-card-${pet.id}`} flexDirection="column" borderStyle="round" paddingX={1} gap={1}>
      <Box flexDirection="row" gap={1} alignItems="center">
        {petPortrait(els, pet.species, pet.form, pet.affinity) ?? <Box />}
        <Box flexDirection="column">
          <Text bold>{pet.name}　{T.petSpeciesName[pet.species] ?? pet.species}</Text>
          <Text>{T.petLevelLine(pet.level, pet.exp, petExpToNext(pet.level), form)}</Text>
          <Text>{T.petAffinity(pet.affinity)}</Text>
          <Text dimColor>{away ? T.petAway : active ? T.petActive : ''}</Text>
        </Box>
      </Box>
      <Box flexDirection="row" flexWrap="wrap" gap={1}>
        {!away && !active ? <Button key={`pet-active-${pet.id}`} label={T.petMakeActive} onPress={() => activatePet($, pet.id)} /> : <Box />}
        {!away && active && save.pets.active.length > 1 ? <Button key={`pet-rest-${pet.id}`} label={T.petRest} onPress={() => toggleCompanion($, pet.id)} /> : <Box />}
        {!away && pats < 3 ? <Button key={`pet-pat-${pet.id}`} label={`${T.petPat} (${T.petPatCount(pats)})`} onPress={() => patPet($, pet.id)} /> : <Text dimColor>{T.petPatCount(pats)}</Text>}
        {(save.bag.treat ?? 0) > 0 && !away ? <Button key={`pet-treat-${pet.id}`} label={`${T.petFeed} ×${save.bag.treat}`} onPress={() => feedCompanion($, pet.id, 'treat')} /> : <Box />}
        {(save.bag['pet-meal'] ?? 0) > 0 && !away ? <Button key={`pet-meal-${pet.id}`} label={`${T.petMeal} ×${save.bag['pet-meal']}`} onPress={() => feedCompanion($, pet.id, 'pet-meal')} /> : <Box />}
      </Box>
      <Box flexDirection="column">
        <Text>{T.petNamesTitle}</Text>
        <Box flexDirection="row" flexWrap="wrap" gap={1}>
          {names.map((name, index) => <Button key={`pet-name-${pet.id}-${index}`} label={name} variant={pet.name === name ? 'primary' : 'secondary'} onPress={() => namePet($, pet.id, name)} />)}
        </Box>
      </Box>
      {pet.level >= 45 && pet.form < 3 ? (
        <Box flexDirection="row" gap={1}>
          {flowers > 0 ? <Button key={`pet-evolve-${pet.id}`} label={`${T.petEvolve} (${T.petNeedFlower(flowers)})`} onPress={() => evolveCompanion($, pet.id)} /> : <Text dimColor>{T.petNeedFlower(flowers)}</Text>}
        </Box>
      ) : <Box />}
      <Box flexDirection="column">
        <Text>{T.petCollarTitle}: {pet.collar === null ? T.petNoCollar : (T.bagItem[pet.collar] ?? pet.collar)}</Text>
        <Box flexDirection="row" flexWrap="wrap" gap={1}>
          {pet.collar !== null && !away ? <Button key={`pet-collar-remove-${pet.id}`} label={T.petCollarRemove} onPress={() => removePetCollar($, pet.id)} /> : <Box />}
          {collars.map(([id, count]) => <Button key={`pet-collar-${pet.id}-${id}`} label={`${T.bagItem[id] ?? id} ×${count}`} onPress={() => equipPetCollar($, pet.id, id)} />)}
        </Box>
      </Box>
      <Box flexDirection="column">
        <Text bold>{T.petHelpTitle}</Text>
        <Text>{petAssistLine(pet, save)}</Text>
      </Box>
    </Box>
  )
}

/** 2 匹目の枠が使える（ペット 2 匹目が開いている） */
export const hasPairSlot = (save: SaveData): boolean => READY.has('pet2') && isUnlocked(save, 'pet2')

/** 13 日目の無料の卵を選べる */
const canChooseFreeEgg = (save: SaveData): boolean =>
  hasPairSlot(save) && !save.pets.freeEgg && save.pets.owned.length === 1 && save.pets.egg === null

/** 相性の行（2 匹が戦闘に出ているとき） */
function pairLines($: $, els: Els, save: SaveData) {
  void $
  const { Box, Text } = els
  const pair = activePair(save)
  if (!hasPairSlot(save)) {
    return <Box />
  }

  return (
    <Box flexDirection="column">
      <Text bold>{T.petPairTitle}</Text>
      {pair === undefined ? <Text dimColor>{T.petPairNone}</Text> : <Text color="#ffd60a">{T.petPairName[pair.id] ?? pair.id} — {T.petPairEffect[pair.id] ?? ''}</Text>}
    </Box>
  )
}

export async function petsTab($: $, els: Els, save: SaveData): Promise<RenderElement> {
  const { Box, Button, Text } = els
  const day = await today($)
  const intro = isNew(save, 'pet') ? await introBox($, els, 'pet') : hasPairSlot(save) && isNew(save, 'pet2') ? await introBox($, els, 'pet2') : undefined
  const egg = save.pets.egg
  const active = activePets(save)

  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="column">{intro ?? <Box />}</Box>
      <Text bold>{T.petTitle}</Text>
      {save.pets.owned.length === 0 && egg === null ? (
        <Box flexDirection="column" gap={1}>
          <Text>{T.petEggTitle}</Text>
          <Text dimColor>{T.petNoPet}</Text>
          <Box flexDirection="row" flexWrap="wrap" gap={1}>
            {STARTER_SPECIES.map(species => (
              <Box key={`pet-egg-box-${species}`} flexDirection="column" alignItems="center">
                {petPortrait(els, species, 1, 0, 48) ?? <Box />}
                <Button key={`pet-egg-${species}`} label={`${T.petSpeciesName[species] ?? species} · ${T.petEggChoose}`} onPress={() => choosePetEgg($, species)} />
              </Box>
            ))}
          </Box>
        </Box>
      ) : <Box />}
      {egg === null ? <Box /> : (
        <Box flexDirection="column" borderStyle="round" paddingX={1}>
          <Text bold>{T.petSpeciesName[egg.species] ?? egg.species}</Text>
          <Text>{T.petEggProgress(egg.answers)}</Text>
        </Box>
      )}
      {canChooseFreeEgg(save) ? (
        <Box flexDirection="column" gap={1} borderStyle="round" paddingX={1}>
          <Text bold>{T.petFreeEggTitle}</Text>
          <Text dimColor>{T.petFreeEggHint}</Text>
          <Box flexDirection="row" flexWrap="wrap" gap={1}>
            {PAIR_SPECIES.filter(species => !save.pets.owned.some(pet => pet.species === species)).map(species => (
              <Box key={`pet-pair-egg-box-${species}`} flexDirection="column" alignItems="center">
                {petPortrait(els, species, 1, 0, 48) ?? <Box />}
                <Button key={`pet-pair-egg-${species}`} label={`${T.petSpeciesName[species] ?? species} · ${T.petEggChoose}`} onPress={() => choosePairPetEgg($, species)} />
              </Box>
            ))}
          </Box>
        </Box>
      ) : <Box />}
      {save.pets.owned.map(pet => petCard($, els, save, pet, day))}
      {save.pets.owned.length > 0 && save.pets.owned.length < 2 && !hasPairSlot(save) ? <Text dimColor>{T.petPairLater}</Text> : <Box />}
      {pairLines($, els, save)}
      <Box flexDirection="column">
        <Text bold>{T.petHelpTitle}</Text>
        {active.length === 0 ? <Text dimColor>{T.petNoHelp}</Text> : <Box flexDirection="column">{active.map(pet => <Text key={`pet-help-${pet.id}`}>{pet.name}: {petAssistLine(pet, save)}</Text>)}</Box>}
      </Box>
    </Box>
  )
}
