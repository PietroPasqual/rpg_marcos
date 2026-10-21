// O "plano" descreve tudo que o personagem ainda precisa escolher, dado a classe, o nível, a espécie
// e o antecedente já selecionados. É a fonte única para o assistente (UI), a validação e a ficha.

import type { Ability, BackgroundData, ClassData, ClassLevelRow, FeatData, SpeciesData, SubclassData, ToolChoice } from '../api/types'
import { featKey, picksOf, totalLevel, type Character, type ClassPicks } from './character'
import { lookup, parseBoldOptions } from './lookup'
import { FULL_CASTERS, HALF_CASTERS, multiclassGains, type MulticlassGains } from './multiclass'
import { SKILLS } from './srd'
import type { Catalog } from '../api/types'

export interface FeatSlot {
  key: string
  label: string
  category: FeatData['category']
  fixedSlug: string | null
  level: number | null
  /** Classe dona do slot (null para origem/espécie) e a chave base ("asi-4"), sem o prefixo da classe. */
  classSlug: string | null
  base: string
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

/** Tudo que uma classe do personagem (a inicial ou uma de multiclasse) pede, dado o nível nela. */
export interface ClassPlan {
  /** 0 = classe inicial; 1.. = `character.multiclass[index - 1]`. */
  index: number
  slug: string
  cls: ClassData
  /** Nível nesta classe. */
  level: number
  /** Tamanho do dado de vida (8 para d8). */
  hitDie: number
  picks: ClassPicks
  subclass: SubclassData | null
  subclassOptions: SubclassData[]
  needsSubclass: boolean
  row: ClassLevelRow | null
  skillCount: number
  skillOptions: string[]
  toolChoices: ToolChoice[]
  expertise: { count: number; restrictTo: string[] | null }
  orderFeature: string | null
  orderOptions: { slug: string; name: string; text: string }[]
  styleAlternative: 'blessed-warrior' | 'druidic-warrior' | null
  masteryCount: number
  invocationCount: number
  metamagicCount: number
  casting: CastingPlan
  /** Proficiências recebidas por não ser a classe inicial (null na classe inicial). */
  gains: MulticlassGains | null
  extraLanguages: number
}

export interface Plan {
  /** Nível do personagem (soma dos níveis das classes). */
  level: number
  classes: ClassPlan[]
  species: SpeciesData | null
  background: BackgroundData | null
  proficiencyBonus: number
  languageCount: number
  featSlots: FeatSlot[]
  speciesNeeds: SpeciesNeeds
  /** Espaços de magia combinados (tabela de Conjurador Multiclasse quando há mais de uma classe conjuradora). */
  spellSlots: Record<number, number>
  pactSlots: { count: number; level: number } | null
  maxSpellLevel: number
  hitDice: { slug: string; name: string; die: number; count: number }[]

  // Atalhos para a classe inicial (a única, na maioria das fichas).
  cls: ClassData | null
  subclass: SubclassData | null
  row: ClassLevelRow | null
  needsSubclass: boolean
  subclassOptions: SubclassData[]
  classSkillCount: number
  classSkillOptions: string[]
  expertise: { count: number; restrictTo: string[] | null }
  styleAlternative: 'blessed-warrior' | 'druidic-warrior' | null
  orderFeature: string | null
  orderOptions: { slug: string; name: string; text: string }[]
  masteryCount: number
  invocationCount: number
  metamagicCount: number
  toolChoices: ToolChoice[]
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

const EMPTY_CASTING: CastingPlan = {
  ability: null,
  cantrips: 0,
  prepared: 0,
  slots: {},
  pact: null,
  maxSpellLevel: 0,
  spellbook: 0,
  arcanumLevels: [],
  styleCantrips: 0,
  styleCantripClass: null,
}


function buildClassPlan(character: Character, catalog: Catalog, index: number, look: ReturnType<typeof lookup>): ClassPlan | null {
  const entry = index === 0 ? { slug: character.classSlug, level: character.level } : character.multiclass[index - 1]
  const cls = (entry?.slug && look.classes.get(entry.slug)) || null
  if (!entry || !cls) return null
  const level = Math.max(1, entry.level)
  const picks = picksOf(character, index)

  const subclassOptions = catalog.subclasses.filter((s) => s.parent_class_slug === cls.slug)
  const subclass = (picks.subclassSlug && subclassOptions.find((s) => s.slug === picks.subclassSlug)) || null
  const row = cls.level_table[level - 1] ?? null
  const needsSubclass = level >= cls.subclass_unlock_level && subclassOptions.length > 0
  const gains = index === 0 ? null : multiclassGains(cls)

  let expertiseCount = 0
  let restrictTo: string[] | null = null
  expertiseCount += 2 * featureLevels(cls, level, 'Expertise').length
  expertiseCount += featureLevels(cls, level, 'Deft Explorer').length
  if (featureLevels(cls, level, 'Scholar').length > 0) {
    expertiseCount += 1
    restrictTo = ['Arcana', 'History', 'Investigation', 'Medicine', 'Nature', 'Religion']
  }

  const orderFeature = cls.features.find((f) => f.name === 'Divine Order' || f.name === 'Primal Order') ?? null
  const orderOptions = orderFeature ? parseBoldOptions(orderFeature.description) : []

  const spellRow = row?.spellcasting ?? null
  const extraCantrip = picks.classOrder === 'thaumaturge' || picks.classOrder === 'magician' ? 1 : 0
  const slots: Record<number, number> = {}
  for (const [lvl, count] of Object.entries(spellRow?.slots_by_level ?? {})) if (count > 0) slots[Number(lvl)] = count
  const pact = spellRow?.pact_slots_count && spellRow.pact_slot_level ? { count: spellRow.pact_slots_count, level: spellRow.pact_slot_level } : null
  const maxSpellLevel = pact ? pact.level : Math.max(0, ...Object.keys(slots).map(Number))
  const arcanumByLevel: Record<number, number> = { 11: 6, 13: 7, 15: 8, 17: 9 }
  const arcanumLevels = Object.entries(arcanumByLevel)
    .filter(([lvl]) => Number(lvl) <= level && cls.slug === 'warlock')
    .map(([, spellLevel]) => spellLevel)
  const styleLevels = featureLevels(cls, level, 'Fighting Style')
  const styleAlternative = cls.slug === 'paladin' ? 'blessed-warrior' : cls.slug === 'ranger' ? 'druidic-warrior' : null
  const usesStyleCantrips = styleAlternative !== null && picks.styleOption === styleAlternative && styleLevels.length > 0

  const casting: CastingPlan = {
    ability: cls.spellcasting_ability ?? null,
    cantrips: spellRow ? (spellRow.cantrips_known ?? 0) + extraCantrip : 0,
    prepared: spellRow?.prepared_spells ?? 0,
    slots,
    pact,
    maxSpellLevel,
    spellbook: cls.slug === 'wizard' ? 6 + 2 * (level - 1) : 0,
    arcanumLevels,
    styleCantrips: usesStyleCantrips ? 2 : 0,
    styleCantripClass: usesStyleCantrips ? (styleAlternative === 'blessed-warrior' ? 'cleric' : 'druid') : null,
  }

  const columns = row?.class_specific_columns ?? {}
  return {
    index,
    slug: cls.slug,
    cls,
    level,
    hitDie: Number(cls.hit_point_die.replace('d', '')),
    picks,
    subclass,
    subclassOptions,
    needsSubclass,
    row,
    skillCount: gains ? gains.skillCount : cls.skill_choices_count,
    skillOptions: gains ? gains.skillOptions : cls.skill_options,
    toolChoices: gains ? (gains.toolChoice ? [gains.toolChoice] : []) : cls.tool_proficiency_choices,
    expertise: { count: expertiseCount, restrictTo },
    orderFeature: orderFeature?.name ?? null,
    orderOptions,
    styleAlternative,
    masteryCount: cls.has_weapon_mastery ? (row?.weapon_masteries_known ?? 0) : 0,
    invocationCount: cls.slug === 'warlock' ? Number(columns.eldritch_invocations ?? 0) : 0,
    metamagicCount: featureLevels(cls, level, 'Metamagic').length > 0 ? 2 + (level >= 10 ? 2 : 0) + (level >= 17 ? 2 : 0) : 0,
    casting,
    gains,
    extraLanguages: featureLevels(cls, level, 'Deft Explorer').length > 0 ? 2 : 0,
  }
}

/** Espaços de magia combinados: tabela de Conjurador Multiclasse se houver mais de uma classe com espaços. */
function combinedSlots(classes: ClassPlan[], catalog: Catalog): { slots: Record<number, number>; pact: Plan['pactSlots'] } {
  const pact = classes.map((c) => c.casting.pact).find((p) => p !== null) ?? null
  const slotClasses = classes.filter((c) => !c.casting.pact && Object.keys(c.casting.slots).length > 0)
  if (slotClasses.length <= 1) return { slots: slotClasses[0]?.casting.slots ?? {}, pact }

  let casterLevel = 0
  for (const c of slotClasses) {
    if (FULL_CASTERS.includes(c.slug)) casterLevel += c.level
    else if (HALF_CASTERS.includes(c.slug)) casterLevel += Math.ceil(c.level / 2)
  }
  const reference = catalog.classes.find((c) => c.slug === 'wizard')?.level_table[Math.min(20, Math.max(1, casterLevel)) - 1]?.spellcasting
  const slots: Record<number, number> = {}
  for (const [lvl, count] of Object.entries(reference?.slots_by_level ?? {})) if (count > 0) slots[Number(lvl)] = count
  return { slots, pact }
}

export function buildPlan(character: Character, catalog: Catalog): Plan {
  const look = lookup(catalog)
  const level = totalLevel(character)
  const species = (character.speciesSlug && look.species.get(character.speciesSlug)) || null
  const background = (character.backgroundSlug && look.backgrounds.get(character.backgroundSlug)) || null

  const classes: ClassPlan[] = []
  if (character.classSlug) {
    for (let index = 0; index <= character.multiclass.length; index++) {
      const classPlan = buildClassPlan(character, catalog, index, look)
      if (classPlan) classes.push(classPlan)
    }
  }
  const primary = classes[0] ?? null

  // ---- Talentos (cada slot é um talento a escolher) ----
  const featSlots: FeatSlot[] = []
  const slot = (classSlug: string | null, base: string, label: string, category: FeatData['category'], fixedSlug: string | null, lvl: number | null): FeatSlot => ({
    key: featKey(classSlug, base),
    label,
    category,
    fixedSlug,
    level: lvl,
    classSlug,
    base,
  })
  if (background) featSlots.push(slot(null, 'origin', 'Talento de Origem (antecedente)', 'Origin', background.origin_feat_slug, null))
  if (species?.traits.some((t) => t.name === 'Versatile')) featSlots.push(slot(null, 'versatile', 'Talento de Origem (Versatile)', 'Origin', null, null))
  for (const c of classes) {
    // A classe inicial usa chaves sem prefixo (compatível com fichas salvas); as demais, "classe:chave".
    const owner = c.index === 0 ? null : c.slug
    const tag = classes.length > 1 ? `${c.cls.name}, ` : ''
    const styleLevels = featureLevels(c.cls, c.level, 'Fighting Style')
    if (styleLevels.length > 0) featSlots.push(slot(owner, 'fighting-style', `Estilo de Luta${classes.length > 1 ? ` (${c.cls.name})` : ''}`, 'Fighting Style', null, styleLevels[0]!))
    if (c.subclass?.features.some((f) => f.name === 'Additional Fighting Style' && f.level <= c.level)) {
      featSlots.push(slot(owner, 'fighting-style-2', `Estilo de Luta adicional${classes.length > 1 ? ` (${c.cls.name})` : ''}`, 'Fighting Style', null, null))
    }
    for (const lvl of featureLevels(c.cls, c.level, 'Ability Score Improvement')) {
      featSlots.push(slot(owner, `asi-${lvl}`, `Aumento de Atributo ou Talento (${tag}nível ${lvl})`, 'General', null, lvl))
    }
    for (const lvl of featureLevels(c.cls, c.level, 'Epic Boon')) {
      featSlots.push(slot(owner, `epic-${lvl}`, `Dádiva Épica (${tag}nível ${lvl})`, 'Epic Boon', null, lvl))
    }
  }

  // ---- Espaços de magia e dados de vida ----
  const { slots, pact } = combinedSlots(classes, catalog)
  const maxSpellLevel = Math.max(0, ...Object.keys(slots).map(Number), pact?.level ?? 0)
  // Cada classe continua preparando magias como se fosse a única (regra de multiclasse): `c.casting.maxSpellLevel` fica
  // com o nível da própria classe; só os espaços são combinados.
  const hitDice = classes.map((c) => ({ slug: c.slug, name: c.cls.name, die: c.hitDie, count: c.level }))

  return {
    level,
    classes,
    species,
    background,
    proficiencyBonus: proficiencyBonusFor(Math.max(1, level)),
    languageCount: 2 + classes.reduce((sum, c) => sum + c.extraLanguages, 0),
    featSlots,
    speciesNeeds: speciesNeeds(species),
    spellSlots: slots,
    pactSlots: pact,
    maxSpellLevel,
    hitDice,

    cls: primary?.cls ?? null,
    subclass: primary?.subclass ?? null,
    row: primary?.row ?? null,
    needsSubclass: primary?.needsSubclass ?? false,
    subclassOptions: primary?.subclassOptions ?? [],
    classSkillCount: primary?.skillCount ?? 0,
    classSkillOptions: primary?.skillOptions ?? [],
    expertise: primary?.expertise ?? { count: 0, restrictTo: null },
    styleAlternative: primary?.styleAlternative ?? null,
    orderFeature: primary?.orderFeature ?? null,
    orderOptions: primary?.orderOptions ?? [],
    masteryCount: primary?.masteryCount ?? 0,
    invocationCount: primary?.invocationCount ?? 0,
    metamagicCount: primary?.metamagicCount ?? 0,
    toolChoices: primary?.toolChoices ?? [],
    casting: primary?.casting ?? EMPTY_CASTING,
  }
}

