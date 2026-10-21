// Mudanças de alto nível na ficha. Cada função devolve um novo personagem; o app aplica `prune` em seguida.

import type { Ability, Catalog } from '../api/types'
import type { Character, FeatPick } from './character'
import { applyEquipmentOption } from './equipment'
import { lookup } from './lookup'
import { MAX_LEVEL } from './srd'

const CLASS_SLOT_PREFIXES = ['fighting-style', 'asi-', 'epic-']

export function selectClass(character: Character, slug: string, catalog: Catalog): Character {
  if (character.classSlug === slug) return character
  const feats = Object.fromEntries(Object.entries(character.feats).filter(([key]) => !CLASS_SLOT_PREFIXES.some((p) => key.startsWith(p))))
  const next: Character = {
    ...character,
    classSlug: slug,
    subclassSlug: null,
    classSkills: [],
    classTools: [],
    expertise: [],
    classOrder: null,
    styleOption: 'feat',
    styleCantrips: [],
    masteries: [],
    invocations: [],
    metamagic: [],
    feats,
    spells: { cantrips: [], spellbook: [], prepared: [], arcanum: {} },
  }
  return applyEquipmentOption(next, catalog, 'class', null)
}

export function setLevel(character: Character, level: number): Character {
  return { ...character, level: Math.min(MAX_LEVEL, Math.max(1, Math.round(level) || 1)) }
}

export function selectSpecies(character: Character, slug: string, catalog: Catalog): Character {
  if (character.speciesSlug === slug) return character
  const species = lookup(catalog).species.get(slug)
  const size = species && species.sizes.length === 1 ? species.sizes[0]! : null
  return { ...character, speciesSlug: slug, speciesChoice: { lineage: null, size, skill: null, spellAbility: null } }
}

export function selectBackground(character: Character, slug: string, catalog: Catalog): Character {
  if (character.backgroundSlug === slug) return character
  const feats = { ...character.feats }
  delete feats.origin
  const next: Character = {
    ...character,
    backgroundSlug: slug,
    backgroundAsi: { mode: 'two-one', plus2: null, plus1: null },
    backgroundTool: null,
    feats,
  }
  return applyEquipmentOption(next, catalog, 'background', null)
}

export function setFeat(character: Character, key: string, pick: FeatPick | null): Character {
  const feats = { ...character.feats }
  if (pick) feats[key] = pick
  else delete feats[key]
  return { ...character, feats }
}

export function patchFeat(character: Character, key: string, patch: Partial<FeatPick>): Character {
  const current = character.feats[key]
  if (!current) return character
  return { ...character, feats: { ...character.feats, [key]: { ...current, ...patch } } }
}

/** Ordem sugerida de atributos para a Matriz Padrão: primários da classe primeiro. */
export function suggestedStandardArray(primary: Ability[]): Record<Ability, number> {
  const order: Ability[] = [...primary, 'CON', 'DEX', 'WIS', 'INT', 'CHA', 'STR'].filter((a, i, all) => all.indexOf(a as Ability) === i) as Ability[]
  const values = [15, 14, 13, 12, 10, 8]
  return Object.fromEntries(order.map((a, i) => [a, values[i]!])) as Record<Ability, number>
}

export function toggle(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value]
}
