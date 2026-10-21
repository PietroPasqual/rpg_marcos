// Mudanças de alto nível na ficha. Cada função devolve um novo personagem; o app aplica `prune` em seguida.

import type { Ability, Catalog } from '../api/types'
import { emptyPicks, featKey, totalLevel, type Character, type FeatPick } from './character'
import { applyEquipmentOption } from './equipment'
import { lookup } from './lookup'
import { MAX_LEVEL } from './srd'

const CLASS_SLOT_BASES = ['fighting-style', 'asi-', 'epic-']

/** Remove os talentos de classe do dono indicado (null = classe inicial). */
function withoutClassFeats(feats: Character['feats'], owner: string | null): Character['feats'] {
  return Object.fromEntries(
    Object.entries(feats).filter(([key]) => {
      if (owner === null) return !CLASS_SLOT_BASES.some((base) => key.startsWith(base))
      return !CLASS_SLOT_BASES.some((base) => key.startsWith(featKey(owner, base)))
    }),
  )
}

/** Troca a classe inicial. Se a nova já era uma classe adicional, ela deixa de ser adicional. */
export function selectClass(character: Character, slug: string, catalog: Catalog): Character {
  if (character.classSlug === slug) return character
  const multiclass = character.multiclass.filter((c) => c.slug !== slug)
  const next: Character = {
    ...character,
    classSlug: slug,
    multiclass,
    feats: withoutClassFeats(character.feats, null),
    ...emptyPicks(),
    hpRolls: {},
    elementalAffinity: null,
  }
  return applyEquipmentOption(next, catalog, 'class', null)
}

/** Define o nível na classe de índice `index`, mantendo o nível total entre 1 e 20. */
export function setClassLevel(character: Character, index: number, level: number): Character {
  const others = totalLevel(character) - (index === 0 ? character.level : (character.multiclass[index - 1]?.level ?? 0))
  const clamped = Math.min(MAX_LEVEL - others, Math.max(1, Math.round(level) || 1))
  if (index === 0) return { ...character, level: clamped }
  return { ...character, multiclass: character.multiclass.map((c, i) => (i === index - 1 ? { ...c, level: clamped } : c)) }
}

export const setLevel = (character: Character, level: number): Character => setClassLevel(character, 0, level)

/** Adiciona uma classe (multiclasse) no nível 1, se couber no limite de 20 níveis. */
export function addClass(character: Character, slug: string): Character {
  if (!character.classSlug || character.classSlug === slug || character.multiclass.some((c) => c.slug === slug)) return character
  if (totalLevel(character) >= MAX_LEVEL) return character
  return { ...character, multiclass: [...character.multiclass, { slug, level: 1, ...emptyPicks() }] }
}

export function removeClass(character: Character, index: number): Character {
  const removed = character.multiclass[index - 1]
  if (index < 1 || !removed) return character
  const hpRolls = Object.fromEntries(Object.entries(character.hpRolls).filter(([key]) => !key.startsWith(`${removed.slug}:`)))
  return {
    ...character,
    multiclass: character.multiclass.filter((_, i) => i !== index - 1),
    feats: withoutClassFeats(character.feats, removed.slug),
    hpRolls,
  }
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
