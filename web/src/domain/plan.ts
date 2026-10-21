// O "plano" descreve tudo que o personagem ainda precisa escolher, dado a classe, o nível, a espécie
// e o antecedente já selecionados. É a fonte única para o assistente (UI), a validação e a ficha.

import type { Ability, BackgroundData, ClassData, ClassLevelRow, FeatData, SpeciesData, SubclassData, ToolChoice } from '../api/types'
import type { Character } from './character'
import { lookup, parseBoldOptions } from './lookup'
import { SKILLS } from './srd'
import type { Catalog } from '../api/types'

export interface FeatSlot {
  key: string
  label: string
  category: FeatData['category']
  fixedSlug: string | null
  level: number | null
}

export interface CastingPlan {
  ability: Ability | null
  cantrips: number
  prepared: number
  slots: Record<number, number>
  pact: { count: number; level: number } | null
  maxSpellLevel: number
  spellbook: number
  arcanumLevels: number[]
  styleCantrips: number
  styleCantripClass: 'cleric' | 'druid' | null
}

export interface SpeciesNeeds {
  lineage: boolean
  size: boolean
  skill: string[] | null
  spellAbility: boolean
}

export interface Plan {
  level: number
  cls: ClassData | null
  subclass: SubclassData | null
  species: SpeciesData | null
  background: BackgroundData | null
  row: ClassLevelRow | null
  proficiencyBonus: number
  needsSubclass: boolean
  subclassOptions: SubclassData[]
  classSkillCount: number
  classSkillOptions: string[]
  expertise: { count: number; restrictTo: string[] | null }
  languageCount: number
  featSlots: FeatSlot[]
  styleAlternative: 'blessed-warrior' | 'druidic-warrior' | null
  orderFeature: string | null
  orderOptions: { slug: string; name: string; text: string }[]
  masteryCount: number
  invocationCount: number
  metamagicCount: number
  toolChoices: ToolChoice[]
  speciesNeeds: SpeciesNeeds
  casting: CastingPlan
}

export function proficiencyBonusFor(level: number): number {
  return Math.ceil(level / 4) + 1
}

function levelRows(cls: ClassData | null, level: number): ClassLevelRow[] {
  return cls ? cls.level_table.filter((row) => row.level <= level) : []
}

/** Níveis (≤ nível atual) em que a classe recebe a característica `name`. */
export function featureLevels(cls: ClassData | null, level: number, name: string): number[] {
  return levelRows(cls, level)
    .filter((row) => row.feature_names.includes(name))
    .map((row) => row.level)
}

const SPECIES_SKILL_CHOICES: Record<string, string[]> = {
  Skillful: SKILLS.map((s) => s.name),
  'Keen Senses': ['Insight', 'Perception', 'Survival'],
}

function speciesNeeds(species: SpeciesData | null): SpeciesNeeds {
  if (!species) return { lineage: false, size: false, skill: null, spellAbility: false }
  const skillTrait = species.traits.find((t) => t.name in SPECIES_SKILL_CHOICES)
  return {
    lineage: species.lineages.length > 0,
    size: species.sizes.length > 1,
    skill: skillTrait ? SPECIES_SKILL_CHOICES[skillTrait.name]! : null,
    spellAbility: species.traits.some((t) => /Intelligence, Wisdom, or Charisma is your spellcasting ability/.test(t.description)),
  }
}

export function buildPlan(character: Character, catalog: Catalog): Plan {
  const look = lookup(catalog)
  const level = character.level
  const cls = (character.classSlug && look.classes.get(character.classSlug)) || null
  const species = (character.speciesSlug && look.species.get(character.speciesSlug)) || null
  const background = (character.backgroundSlug && look.backgrounds.get(character.backgroundSlug)) || null
  const subclassOptions = cls ? catalog.subclasses.filter((s) => s.parent_class_slug === cls.slug) : []
  const subclass = (character.subclassSlug && subclassOptions.find((s) => s.slug === character.subclassSlug)) || null
  const row = cls ? (cls.level_table[level - 1] ?? null) : null
  const needsSubclass = !!cls && level >= cls.subclass_unlock_level && subclassOptions.length > 0

  // ---- Talentos (cada slot é um talento a escolher) ----
  const featSlots: FeatSlot[] = []
  if (background) {
    featSlots.push({ key: 'origin', label: 'Talento de Origem (antecedente)', category: 'Origin', fixedSlug: background.origin_feat_slug, level: null })
  }
  if (species?.traits.some((t) => t.name === 'Versatile')) {
    featSlots.push({ key: 'versatile', label: 'Talento de Origem (Versatile)', category: 'Origin', fixedSlug: null, level: null })
  }
  const styleLevels = featureLevels(cls, level, 'Fighting Style')
  if (styleLevels.length > 0) {
    featSlots.push({ key: 'fighting-style', label: 'Estilo de Luta', category: 'Fighting Style', fixedSlug: null, level: styleLevels[0]! })
  }
  if (subclass?.features.some((f) => f.name === 'Additional Fighting Style' && f.level <= level)) {
    featSlots.push({ key: 'fighting-style-2', label: 'Estilo de Luta adicional', category: 'Fighting Style', fixedSlug: null, level: null })
  }
  for (const lvl of featureLevels(cls, level, 'Ability Score Improvement')) {
    featSlots.push({ key: `asi-${lvl}`, label: `Aumento de Atributo ou Talento (nível ${lvl})`, category: 'General', fixedSlug: null, level: lvl })
  }
  for (const lvl of featureLevels(cls, level, 'Epic Boon')) {
    featSlots.push({ key: `epic-${lvl}`, label: `Dádiva Épica (nível ${lvl})`, category: 'Epic Boon', fixedSlug: null, level: lvl })
  }

  // ---- Perícias, especialização, idiomas ----
  let expertiseCount = 0
  let restrictTo: string[] | null = null
  expertiseCount += 2 * featureLevels(cls, level, 'Expertise').length
  expertiseCount += featureLevels(cls, level, 'Deft Explorer').length
  if (featureLevels(cls, level, 'Scholar').length > 0) {
    expertiseCount += 1
    restrictTo = ['Arcana', 'History', 'Investigation', 'Medicine', 'Nature', 'Religion']
  }
  const languageCount = 2 + (featureLevels(cls, level, 'Deft Explorer').length > 0 ? 2 : 0)

  // ---- Ordem Divina/Primal ----
  const orderFeature = cls?.features.find((f) => f.name === 'Divine Order' || f.name === 'Primal Order') ?? null
  const orderOptions = orderFeature ? parseBoldOptions(orderFeature.description) : []

  // ---- Conjuração ----
  const spellRow = row?.spellcasting ?? null
  const orderSlug = character.classOrder
  const extraCantrip = orderSlug === 'thaumaturge' || orderSlug === 'magician' ? 1 : 0
  const slots: Record<number, number> = {}
  for (const [lvl, count] of Object.entries(spellRow?.slots_by_level ?? {})) if (count > 0) slots[Number(lvl)] = count
  const pact = spellRow?.pact_slots_count && spellRow.pact_slot_level ? { count: spellRow.pact_slots_count, level: spellRow.pact_slot_level } : null
  const maxSpellLevel = pact ? pact.level : Math.max(0, ...Object.keys(slots).map(Number))
  const arcanumByLevel: Record<number, number> = { 11: 6, 13: 7, 15: 8, 17: 9 }
  const arcanumLevels = Object.entries(arcanumByLevel)
    .filter(([lvl]) => Number(lvl) <= level && cls?.slug === 'warlock')
    .map(([, spellLevel]) => spellLevel)
  const styleAlternative = cls?.slug === 'paladin' ? 'blessed-warrior' : cls?.slug === 'ranger' ? 'druidic-warrior' : null
  const usesStyleCantrips = styleAlternative !== null && character.styleOption === styleAlternative && styleLevels.length > 0

  const casting: CastingPlan = {
    ability: cls?.spellcasting_ability ?? null,
    cantrips: spellRow ? (spellRow.cantrips_known ?? 0) + extraCantrip : 0,
    prepared: spellRow?.prepared_spells ?? 0,
    slots,
    pact,
    maxSpellLevel,
    spellbook: cls?.slug === 'wizard' ? 6 + 2 * (level - 1) : 0,
    arcanumLevels,
    styleCantrips: usesStyleCantrips ? 2 : 0,
    styleCantripClass: usesStyleCantrips ? (styleAlternative === 'blessed-warrior' ? 'cleric' : 'druid') : null,
  }

  const columns = row?.class_specific_columns ?? {}
  const metamagicCount = featureLevels(cls, level, 'Metamagic').length > 0 ? 2 + (level >= 10 ? 2 : 0) + (level >= 17 ? 2 : 0) : 0

  return {
    level,
    cls,
    subclass,
    species,
    background,
    row,
    proficiencyBonus: proficiencyBonusFor(level),
    needsSubclass,
    subclassOptions,
    classSkillCount: cls?.skill_choices_count ?? 0,
    classSkillOptions: cls?.skill_options ?? [],
    expertise: { count: expertiseCount, restrictTo },
    languageCount,
    featSlots,
    styleAlternative,
    orderFeature: orderFeature?.name ?? null,
    orderOptions,
    masteryCount: cls?.has_weapon_mastery ? (row?.weapon_masteries_known ?? 0) : 0,
    invocationCount: cls?.slug === 'warlock' ? Number(columns.eldritch_invocations ?? 0) : 0,
    metamagicCount,
    toolChoices: cls?.tool_proficiency_choices ?? [],
    speciesNeeds: speciesNeeds(species),
    casting,
  }
}
