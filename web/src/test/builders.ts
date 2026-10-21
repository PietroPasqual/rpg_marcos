import type { Catalog } from '../api/types'
import { newCharacter, type Character } from '../domain/character'
import { applyEquipmentOption } from '../domain/equipment'
import { prune } from '../domain/prune'
import { classSpells } from '../domain/spells'
import fixture from './catalog.fixture.json'

export const catalog = fixture as unknown as Catalog

const STANDARD_ARRAY_ASSIGNMENT = { STR: 8, DEX: 13, CON: 14, INT: 15, WIS: 12, CHA: 10 } as const

/** Cria um personagem aplicando `overrides` e removendo escolhas inválidas, como faz o app. */
export function build(overrides: Partial<Character>): Character {
  return prune({ ...newCharacter(), ...overrides, baseScores: { ...STANDARD_ARRAY_ASSIGNMENT, ...overrides.baseScores } }, catalog)
}

/** Mago humano de nível 1 (antecedente Sage), com todas as escolhas obrigatórias feitas. */
export function completeWizard(level = 1): Character {
  const wizard = classSpells(catalog, 'wizard')
  const cantrips = wizard.filter((s) => s.level === 0).map((s) => s.slug)
  const first = wizard.filter((s) => s.level === 1).map((s) => s.slug)
  let character = build({
    name: 'Mialee',
    alignment: 'Neutral Good',
    languages: ['Elvish', 'Gnomish'],
    level,
    classSlug: 'wizard',
    speciesSlug: 'human',
    speciesChoice: { lineage: null, size: 'Medium', skill: 'Perception', spellAbility: null },
    backgroundSlug: 'sage',
    backgroundAsi: { mode: 'two-one', plus2: 'INT', plus1: 'CON' },
    classSkills: ['Investigation', 'Religion'],
    feats: {
      origin: { slug: 'magic-initiate', magicInitiate: { list: 'wizard', ability: 'INT', cantrips: cantrips.slice(5, 7), spell: first[8]! } },
      versatile: { slug: 'alert' },
    },
    spells: { cantrips: cantrips.slice(0, 3), spellbook: first.slice(0, 6), prepared: first.slice(0, 4), arcanum: {} },
  })
  character = applyEquipmentOption(character, catalog, 'class', 'A')
  return applyEquipmentOption(character, catalog, 'background', 'A')
}
