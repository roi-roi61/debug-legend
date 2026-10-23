import type { Pet, PetSpecies } from '../types'
import type { Figure } from './art'
import { ART } from './art.generated'

// ペットの絵（art/export/pet-<種>-<形態>.json、48 / 56 / 64 ドット）と、戦闘画面での大きさ。
// 主人公（96〜128）の足元に並ぶので、形態が上がるほど少し大きく（36 → 42 → 48 ドットに縮めて描く）。

/** 戦闘画面での高さ（ドット）。形態 1〜3 */
const HEIGHT = [36, 42, 48]

export function petFigure(species: PetSpecies, form: number): Figure | undefined {
  const stage = Math.min(3, Math.max(1, Math.floor(form)))
  const art = ART[`pet-${species}-${stage}`] ?? ART[`pet-${species}-1`]
  if (art === undefined) {
    return undefined
  }
  const scale = (HEIGHT[stage - 1] ?? 40) / Math.max(art.w, art.h)

  return { id: art.id, name: art.name, sprite: art, w: art.w, h: art.h, scale, hue: 0 }
}

/** 一緒に戦っているペットの絵（1 匹目・2 匹目。絵が無いペットは出さない） */
export const petFigures = (pets: readonly Pet[]): Figure[] => pets.map(pet => petFigure(pet.species, pet.form)).filter((f): f is Figure => f !== undefined)
