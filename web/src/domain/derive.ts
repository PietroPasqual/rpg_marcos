// Cálculo de todos os valores da ficha (atributos, PV, CA, perícias, ataques, magias...) a partir
// das escolhas do personagem e do catálogo do SRD. Funções puras, sem dependência de interface.

import type { Ability, ArmorData, Catalog, SpellData, WeaponData } from '../api/types'
import type { Character, FeatPick } from './character'
import { attackExtras, classLevel, extraResources, featureUses, type EffectContext } from './effects'
import { featureLevels, buildPlan, type Plan } from './plan'
import { lookup, slugify, type Lookup } from './lookup'
import { ABILITIES, SKILLS, SKILL_BY_NAME } from './srd'

export const abilityMod = (score: number): number => Math.floor((score - 10) / 2)
export const formatBonus = (n: number): string => (n >= 0 ? `+${n}` : `${n}`)

export interface ScoreInfo {
  base: number
  bonus: number
  total: number
  mod: number
}

export interface SkillRow {
  name: string
  label: string
  ability: Ability
  mod: number
  level: 'none' | 'half' | 'proficient' | 'expertise'
}

export interface AttackRow {
  id: string
  name: string
  quantity: number
  bonus: number
  damage: string
  damageType: string
  properties: string[]
  mastery: string | null
  note: string | null
  /** Dano extra e regras que dependem de classe e talentos (Fúria, Ataque Furtivo...). */
  extras: string[]
}

export interface SpellEntry {
  spell: SpellData
  sources: string[]
  ability: Ability | null
  prepared: boolean
  /** Bônus que se aplica a esta magia (ex.: Afinidade Elemental). */
  note: string | null
}

export interface CasterInfo {
  slug: string
  name: string
  ability: Ability
  dc: number
  attack: number
}

export interface SpellcastingInfo {
  /** Conjurador principal (o primeiro da lista), para fichas de uma classe só. */
  ability: Ability | null
  dc: number | null
  attack: number | null
  casters: CasterInfo[]
  slots: Record<number, number>
  pact: { count: number; level: number } | null
}

export interface FeatureEntry {
  source: string
  name: string
  level: number | null
  text: string
  /** Usos por descanso, quando o texto da característica os define. */
  uses: string | null
}

export interface Derived {
  plan: Plan
  proficiencyBonus: number
  scores: Record<Ability, ScoreInfo>
  saves: { ability: Ability; mod: number; proficient: boolean }[]
  skills: SkillRow[]
  hp: number
  hitDie: number
  hitDice: string
  defenses: string[]
  ac: { value: number; formula: string }
  initiative: number
  speed: number
  darkvision: number | null
  passivePerception: number
  attacks: AttackRow[]
  spellcasting: SpellcastingInfo | null
  spells: SpellEntry[]
  proficiencies: { armor: string[]; weapons: string[]; tools: string[] }
  languages: string[]
  features: FeatureEntry[]
  resources: { label: string; value: string }[]
  carryCapacity: number
  weightCarried: number
  gold: number
  warnings: string[]
}

// ---------------------------------------------------------------------------------------------
// Atributos
// ---------------------------------------------------------------------------------------------

export function computeScores(character: Character, plan: Plan, look: Lookup): Record<Ability, ScoreInfo> {
  const base = Object.fromEntries(ABILITIES.map((a) => [a, character.baseScores[a] ?? 8])) as Record<Ability, number>
  const total = { ...base }
  const bump = (ability: Ability, amount: number, cap: number) => {
    total[ability] = Math.min(cap, total[ability] + amount)
  }

  const bg = plan.background
  if (bg) {
    const asi = character.backgroundAsi
    if (asi.mode === 'one-one-one') {
      for (const a of bg.ability_scores) bump(a, 1, 20)
    } else {
      if (asi.plus2 && bg.ability_scores.includes(asi.plus2)) bump(asi.plus2, 2, 20)
      if (asi.plus1 && asi.plus1 !== asi.plus2 && bg.ability_scores.includes(asi.plus1)) bump(asi.plus1, 1, 20)
    }
  }

  for (const slot of plan.featSlots) {
    const pick = character.feats[slot.key]
    if (!pick?.slug) continue
    const cap = slot.category === 'Epic Boon' ? 30 : 20
    if (pick.slug === 'ability-score-improvement' && pick.asi) {
      if (pick.asi.mode === 'plus2' && pick.asi.first) bump(pick.asi.first, 2, cap)
      if (pick.asi.mode === 'plus1x2') {
        if (pick.asi.first) bump(pick.asi.first, 1, cap)
        if (pick.asi.second && pick.asi.second !== pick.asi.first) bump(pick.asi.second, 1, cap)
      }
      continue
    }
    const feat = look.feats.get(pick.slug)
    if (feat && feat.ability_score_increase_options.length > 0 && pick.ability && feat.ability_score_increase_options.includes(pick.ability)) {
      bump(pick.ability, 1, cap)
    }
  }

  return Object.fromEntries(
    ABILITIES.map((a) => [a, { base: base[a], bonus: total[a] - base[a], total: total[a], mod: abilityMod(total[a]) }]),
  ) as Record<Ability, ScoreInfo>
}

// ---------------------------------------------------------------------------------------------
// Proficiências
// ---------------------------------------------------------------------------------------------

export interface WeaponRule {
  simple: boolean
  martial: 'all' | 'properties' | 'none'
  martialProperties: string[]
}

export function weaponRuleFor(texts: string[], order: string | null): WeaponRule {
  const text = texts.join(' ')
  const hasSimple = /simple/i.test(text)
  let martial: WeaponRule['martial'] = 'none'
  let martialProperties: string[] = []
  const restricted = text.match(/Martial weapons that have the ([\w\s]+?) propert/i)
  if (/Simple and Martial weapons/i.test(text) || order === 'protector' || order === 'warden') {
    martial = 'all'
  } else if (restricted) {
    martial = 'properties'
    martialProperties = restricted[1]!.split(/\s+or\s+/i).map((p) => p.trim())
  }
  return { simple: hasSimple, martial, martialProperties }
}

export const propertyNames = (weapon: WeaponData): string[] => weapon.properties.map((p) => p.split(' (')[0]!.trim())

export function isWeaponProficient(weapon: WeaponData, rule: WeaponRule): boolean {
  if (weapon.category.startsWith('Simple')) return rule.simple
  if (rule.martial === 'all') return true
  if (rule.martial === 'properties') return propertyNames(weapon).some((p) => rule.martialProperties.includes(p))
  return false
}

/** Proficiência com armas somando todas as classes (a da classe inicial e as ganhas por multiclasse). */
export function weaponRuleForPlan(plan: Plan): WeaponRule {
  const rules = plan.classes.map((c) => {
    const base: WeaponRule = c.gains
      ? { simple: false, martial: c.gains.martial ? 'all' : 'none', martialProperties: [] }
      : weaponRuleFor(c.cls.weapon_proficiencies, null)
    const order = weaponRuleFor([], c.picks.classOrder)
    return order.martial === 'all' ? { ...base, martial: 'all' as const } : base
  })
  const properties = rules.flatMap((r) => (r.martial === 'properties' ? r.martialProperties : []))
  return {
    simple: rules.some((r) => r.simple),
    martial: rules.some((r) => r.martial === 'all') ? 'all' : properties.length > 0 ? 'properties' : 'none',
    martialProperties: [...new Set(properties)],
  }
}

export type ArmorTier = 'Light' | 'Medium' | 'Heavy' | 'Shield'

/** Treinamento com armaduras somando todas as classes. */
export function armorTrainingForPlan(plan: Plan): Set<ArmorTier> {
  const trained = new Set<ArmorTier>()
  for (const c of plan.classes) {
    const own = c.gains ? new Set(c.gains.armor) : armorTrainingFor(c.cls.armor_training, null)
    own.forEach((t) => trained.add(t))
    armorTrainingFor([], c.picks.classOrder).forEach((t) => trained.add(t))
  }
  return trained
}

export function armorTrainingFor(texts: string[], order: string | null): Set<ArmorTier> {
  const text = texts.join(' ')
  const trained = new Set<ArmorTier>()
  if (/light/i.test(text)) trained.add('Light')
  if (/medium/i.test(text)) trained.add('Medium')
  if (/heavy/i.test(text)) trained.add('Heavy')
  if (/shield/i.test(text)) trained.add('Shield')
  if (order === 'protector') trained.add('Heavy')
  if (order === 'warden') trained.add('Medium')
  return trained
}

const armorTier = (armor: ArmorData): ArmorTier => armor.category.replace(' Armor', '') as ArmorTier

export function skillProficiencies(character: Character, plan: Plan): Set<string> {
  const skills = new Set<string>()
  plan.background?.skill_proficiencies.forEach((s) => skills.add(s))
  plan.classes.forEach((c) => c.picks.classSkills.forEach((s) => skills.add(s)))
  if (character.speciesChoice.skill) skills.add(character.speciesChoice.skill)
  for (const pick of Object.values(character.feats)) {
    if (pick.slug === 'skilled') pick.skilled?.filter((s) => s in SKILL_BY_NAME).forEach((s) => skills.add(s))
  }
  return skills
}

export const hasFeat = (character: Character, slug: string): boolean => Object.values(character.feats).some((p: FeatPick) => p.slug === slug)

// ---------------------------------------------------------------------------------------------
// Equipamento, CA, velocidade
// ---------------------------------------------------------------------------------------------

function equippedArmor(character: Character, look: Lookup): { body: ArmorData | null; shield: ArmorData | null } {
  let body: ArmorData | null = null
  let shield: ArmorData | null = null
  for (const item of character.inventory) {
    if (!item.equipped || item.type !== 'armor' || !item.slug) continue
    const armor = look.armor.get(item.slug)
    if (!armor) continue
    if (armor.category === 'Shield') shield ??= armor
    else body ??= armor
  }
  return { body, shield }
}

/** Feiticeiro Dracônico com Resiliência Dracônica (subclasse no nível 3 da classe). */
const isDraconic = (plan: Plan): boolean => plan.classes.some((c) => c.subclass?.slug === 'draconic-sorcery' && c.level >= 3)

function computeAc(character: Character, plan: Plan, scores: Record<Ability, ScoreInfo>, look: Lookup) {
  const { body, shield } = equippedArmor(character, look)
  const dex = scores.DEX.mod
  const options: { value: number; formula: string }[] = []

  if (body) {
    const dexPart = body.adds_dex_modifier ? Math.min(dex, body.max_dex_modifier ?? Infinity) : 0
    options.push({ value: body.base_ac + dexPart, formula: `${body.name}${body.adds_dex_modifier ? ' + Destreza' : ''}` })
  } else {
    options.push({ value: 10 + dex, formula: '10 + Destreza' })
    if (classLevel(plan, 'barbarian') > 0) options.push({ value: 10 + dex + scores.CON.mod, formula: 'Defesa sem Armadura (10 + Des + Con)' })
    if (classLevel(plan, 'monk') > 0 && !shield) options.push({ value: 10 + dex + scores.WIS.mod, formula: 'Defesa sem Armadura (10 + Des + Sab)' })
    if (isDraconic(plan)) options.push({ value: 10 + dex + scores.CHA.mod, formula: 'Resiliência Dracônica (10 + Des + Car)' })
  }

  const best = options.reduce((a, b) => (b.value > a.value ? b : a))
  let value = best.value
  let formula = best.formula
  if (shield) {
    value += shield.base_ac
    formula += ` + ${shield.name}`
  }
  if (body && hasFeat(character, 'defense')) {
    value += 1
    formula += ' + Defense'
  }
  return { value, formula }
}

function computeSpeed(character: Character, plan: Plan, scores: Record<Ability, ScoreInfo>, look: Lookup): number {
  let speed = plan.species?.speed_ft ?? 30
  const lineage = plan.species?.lineages.find((l) => l.slug === character.speciesChoice.lineage)
  const override = lineage?.description.match(/Speed increases to (\d+) feet/)
  if (override) speed = Math.max(speed, Number(override[1]))

  const { body, shield } = equippedArmor(character, look)
  const heavy = body ? armorTier(body) === 'Heavy' : false
  if (classLevel(plan, 'barbarian') >= 5 && !heavy) speed += 10
  const monk = plan.classes.find((c) => c.slug === 'monk')
  if (monk && !body && !shield) {
    const bonus = String(monk.row?.class_specific_columns.unarmored_movement ?? '').match(/\d+/)
    if (bonus) speed += Number(bonus[0])
  }
  if (body?.strength_requirement && scores.STR.total < body.strength_requirement) speed -= 10
  return speed
}

// ---------------------------------------------------------------------------------------------
// Ataques
// ---------------------------------------------------------------------------------------------

function computeAttacks(character: Character, plan: Plan, scores: Record<Ability, ScoreInfo>, look: Lookup, ctx: EffectContext): AttackRow[] {
  const pb = plan.proficiencyBonus
  const rule = weaponRuleForPlan(plan)
  const monk = plan.classes.find((c) => c.slug === 'monk')
  const isMonk = !!monk
  const masteries = new Set(plan.classes.flatMap((c) => c.picks.masteries))
  const strMod = scores.STR.mod
  const dexMod = scores.DEX.mod
  const rows: AttackRow[] = []

  // Ataque desarmado (Monk usa Artes Marciais)
  const martialArts = monk ? String(monk.row?.class_specific_columns.martial_arts ?? '1d6') : null
  const unarmedMod = isMonk ? Math.max(strMod, dexMod) : strMod
  const unarmedAbility: Ability = unarmedMod === dexMod && isMonk && dexMod > strMod ? 'DEX' : 'STR'
  rows.push({
    id: 'unarmed',
    name: 'Unarmed Strike',
    quantity: 1,
    bonus: unarmedMod + pb,
    damage: martialArts ? withMod(martialArts, unarmedMod) : String(Math.max(0, 1 + strMod)),
    damageType: 'Bludgeoning',
    properties: [],
    mastery: null,
    note: null,
    extras: attackExtras(ctx, { melee: true, ranged: false, properties: [], ability: unarmedAbility, unarmed: true }),
  })

  for (const item of character.inventory) {
    if (!item.equipped || item.type !== 'weapon' || !item.slug) continue
    const weapon = look.weapons.get(item.slug)
    if (!weapon) continue
    const props = propertyNames(weapon)
    const monkWeapon = isMonk && weapon.range_type === 'Melee' && (weapon.category.startsWith('Simple') || props.includes('Light'))
    let mod: number
    let ability: Ability
    if (props.includes('Finesse') || monkWeapon) {
      mod = Math.max(strMod, dexMod)
      ability = dexMod > strMod ? 'DEX' : 'STR'
    } else if (weapon.range_type === 'Ranged') {
      mod = dexMod
      ability = 'DEX'
    } else {
      mod = strMod
      ability = 'STR'
    }
    const proficient = isWeaponProficient(weapon, rule)
    const archery = weapon.range_type === 'Ranged' && hasFeat(character, 'archery') ? 2 : 0
    const dice = monkWeapon && martialArts && compareDice(martialArts, weapon.damage_dice) > 0 ? martialArts : weapon.damage_dice
    const versatile = weapon.versatile_damage_dice && weapon.versatile_damage_dice !== dice ? ` (${withMod(weapon.versatile_damage_dice, mod)} a duas mãos)` : ''
    const same = rows.find((row) => row.name === weapon.name)
    if (same) {
      same.quantity += item.quantity // a mesma arma em itens diferentes (classe + antecedente) vira uma linha só
      continue
    }
    rows.push({
      id: item.id,
      name: weapon.name,
      quantity: item.quantity,
      bonus: mod + (proficient ? pb : 0) + archery,
      damage: withMod(dice, mod) + versatile,
      damageType: weapon.damage_type,
      properties: weapon.properties,
      mastery: masteries.has(weapon.slug) ? weapon.mastery_name : null,
      note: proficient ? null : 'Sem proficiência',
      extras: attackExtras(ctx, { melee: weapon.range_type === 'Melee', ranged: weapon.range_type === 'Ranged', properties: props, ability, unarmed: false }),
    })
  }
  return rows
}

function withMod(dice: string, mod: number): string {
  if (mod === 0) return dice
  return `${dice}${mod > 0 ? '+' : ''}${mod}`
}

/** Compara o valor médio de duas expressões "NdM". */
function compareDice(a: string, b: string): number {
  const avg = (d: string) => {
    const m = d.match(/(\d+)d(\d+)/)
    return m ? Number(m[1]) * (Number(m[2]) + 1) : 0
  }
  return avg(a) - avg(b)
}

// ---------------------------------------------------------------------------------------------
// Magias
// ---------------------------------------------------------------------------------------------

function collectSpells(character: Character, plan: Plan, look: Lookup, scores: Record<Ability, ScoreInfo>): SpellEntry[] {
  const entries = new Map<string, SpellEntry>()
  const add = (slug: string, source: string, ability: Ability | null, prepared: boolean) => {
    const spell = look.spells.get(slug)
    if (!spell) return
    const existing = entries.get(slug)
    if (existing) {
      if (!existing.sources.includes(source)) existing.sources.push(source)
      existing.prepared ||= prepared
      return
    }
    entries.set(slug, { spell, sources: [source], ability, prepared, note: null })
  }

  const multi = plan.classes.length > 1
  for (const c of plan.classes) {
    const ability = c.casting.ability
    const own = (label: string) => (multi ? `${label} (${c.cls.name})` : label)
    const spells = c.picks.spells
    spells.cantrips.forEach((s) => add(s, own('Classe'), ability, true))
    c.picks.styleCantrips.forEach((s) => add(s, c.styleAlternative === 'blessed-warrior' ? 'Guerreiro Abençoado' : 'Guerreiro Druídico', ability, true))
    spells.prepared.forEach((s) => add(s, own('Preparada'), ability, true))
    spells.spellbook.filter((s) => !spells.prepared.includes(s)).forEach((s) => add(s, 'Grimório', ability, false))
    Object.values(spells.arcanum).forEach((s) => add(s, 'Arcana Mística', ability, true))
    for (const row of c.subclass?.always_prepared_spells ?? []) {
      if (row.class_level <= c.level) row.spell_slugs.forEach((s) => add(s, `Sempre preparada (${c.subclass!.name})`, ability, true))
    }
    if (c.slug === 'ranger') add('hunters-mark', 'Sempre preparada (Favored Enemy)', ability, true)
  }

  const lineage = plan.species?.lineages.find((l) => l.slug === character.speciesChoice.lineage)
  for (const benefit of lineage?.benefits_by_level ?? []) {
    if (benefit.character_level <= plan.level) benefit.granted_spells.forEach((s) => add(s, `Espécie (${lineage!.name})`, character.speciesChoice.spellAbility, true))
  }

  for (const pick of Object.values(character.feats)) {
    if (pick.slug !== 'magic-initiate' || !pick.magicInitiate) continue
    const { cantrips, spell, ability } = pick.magicInitiate
    cantrips.forEach((s) => add(s, 'Magic Initiate', ability, true))
    if (spell) add(spell, 'Magic Initiate', ability, true)
  }

  // Afinidade Elemental: soma o modificador de Carisma ao dano de uma rolagem de magias do tipo escolhido.
  const affinity = character.elementalAffinity
  if (affinity && plan.classes.some((c) => c.slug === 'sorcerer' && c.subclass?.slug === 'draconic-sorcery' && c.level >= 6)) {
    const bonus = Math.max(0, scores.CHA.mod)
    for (const entry of entries.values()) {
      if (new RegExp(`\\b${affinity}\\b damage`, 'i').test(entry.spell.description)) entry.note = `Afinidade Elemental: +${bonus} em uma rolagem de dano (${affinity})`
    }
  }

  return [...entries.values()].sort((a, b) => a.spell.level - b.spell.level || a.spell.name.localeCompare(b.spell.name))
}

// ---------------------------------------------------------------------------------------------
// Características e recursos
// ---------------------------------------------------------------------------------------------

function collectFeatures(character: Character, plan: Plan, look: Lookup, ctx: EffectContext): FeatureEntry[] {
  const features: FeatureEntry[] = []
  const push = (source: string, name: string, level: number | null, text: string) => features.push({ source, name, level, text, uses: featureUses(text, ctx) })

  for (const c of plan.classes) {
    for (const f of c.cls.features) if (f.level <= c.level) push(c.cls.name, f.name, f.level, f.description)
    for (const f of c.subclass?.features ?? []) if (f.level <= c.level) push(c.subclass!.name, f.name, f.level, f.description)
    const order = c.orderOptions.find((o) => o.slug === c.picks.classOrder)
    if (order && c.orderFeature) push(c.cls.name, `${c.orderFeature}: ${order.name}`, 1, order.text)
  }
  if (plan.species) {
    const lineage = plan.species.lineages.find((l) => l.slug === character.speciesChoice.lineage)
    // Traço com tabela de opções (ex.: Giant Ancestry): os usos por descanso valem para a opção escolhida.
    const parentTitle = plan.species.lineage_table_title
    const parent = lineage ? plan.species.traits.find((t) => t.name === parentTitle) : undefined
    for (const t of plan.species.traits) {
      if (t === parent) features.push({ source: plan.species.name, name: t.name, level: null, text: t.description, uses: null })
      else push(plan.species.name, t.name, null, t.description)
    }
    if (lineage) {
      features.push({
        source: plan.species.name,
        name: `${parentTitle ?? 'Linhagem'}: ${lineage.name}`,
        level: null,
        text: lineage.description,
        uses: parent ? featureUses(parent.description, ctx) : featureUses(lineage.description, ctx),
      })
    }
  }
  for (const slot of plan.featSlots) {
    const pick = character.feats[slot.key]
    const feat = pick?.slug ? look.feats.get(pick.slug) : null
    if (!feat) continue
    const text = [feat.description, ...feat.benefits.map((b) => `**${b.name}.** ${b.description}`)].filter(Boolean).join('\n\n')
    push(`Talento (${feat.category})`, feat.name, slot.level, text)
  }
  return features
}

const prettify = (key: string): string => key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

// ---------------------------------------------------------------------------------------------
// Pontos de vida
// ---------------------------------------------------------------------------------------------

export const hitDieAverage = (die: number): number => Math.floor(die / 2) + 1
export const hpRollKey = (classSlug: string, level: number): string => `${classSlug}:${level}`

/** Pontos de vida das classes: dado máximo no 1º nível, depois a média ou o resultado registrado, mais Constituição. */
export function classHitPoints(character: Character, plan: Plan, conMod: number): number {
  let hp = 0
  plan.classes.forEach((c, classIndex) => {
    const die = Number(c.cls.hit_point_die.replace('d', ''))
    for (let level = 1; level <= c.level; level++) {
      const rolled = character.hpRolls[hpRollKey(c.slug, level)]
      const usesRoll = character.hpMode === 'manual' && Number.isInteger(rolled) && rolled! >= 1 && rolled! <= die
      const gained = classIndex === 0 && level === 1 ? die : usesRoll ? rolled! : hitDieAverage(die)
      hp += Math.max(1, gained + conMod)
    }
  })
  return hp
}

// ---------------------------------------------------------------------------------------------
// Derivação completa
// ---------------------------------------------------------------------------------------------

export function derive(character: Character, catalog: Catalog): Derived {
  const look = lookup(catalog)
  const plan = buildPlan(character, catalog)
  const pb = plan.proficiencyBonus
  const scores = computeScores(character, plan, look)
  const warnings: string[] = []
  const mods = Object.fromEntries(ABILITIES.map((a) => [a, scores[a].mod])) as Record<Ability, number>
  const ctx: EffectContext = { character, plan, mods, pb }

  // Perícias
  const proficient = skillProficiencies(character, plan)
  const expertise = new Set(plan.classes.flatMap((c) => c.picks.expertise).filter((s) => proficient.has(s)))
  const jack = plan.classes.some((c) => featureLevels(c.cls, c.level, 'Jack of All Trades').length > 0)
  const orderBonus = Math.max(1, scores.WIS.mod)
  const orders = plan.classes.map((c) => c.picks.classOrder)
  const orderSkills = [...(orders.includes('thaumaturge') ? ['Arcana', 'Religion'] : []), ...(orders.includes('magician') ? ['Arcana', 'Nature'] : [])]
  const skills: SkillRow[] = SKILLS.map((s) => {
    const level: SkillRow['level'] = expertise.has(s.name) ? 'expertise' : proficient.has(s.name) ? 'proficient' : jack ? 'half' : 'none'
    const bonus = level === 'expertise' ? pb * 2 : level === 'proficient' ? pb : level === 'half' ? Math.floor(pb / 2) : 0
    return { name: s.name, label: s.label, ability: s.ability, level, mod: scores[s.ability].mod + bonus + (orderSkills.includes(s.name) ? orderBonus : 0) }
  })

  // Salvaguardas: só a classe inicial concede proficiência (regra de multiclasse)
  const saveProfs = new Set<Ability>(plan.cls?.saving_throw_proficiencies ?? [])
  const saves = ABILITIES.map((ability) => ({ ability, proficient: saveProfs.has(ability), mod: scores[ability].mod + (saveProfs.has(ability) ? pb : 0) }))

  // Pontos de vida
  const hitDie = Number(plan.cls?.hit_point_die.replace('d', '') ?? 8)
  const conMod = scores.CON.mod
  let hp = plan.cls ? classHitPoints(character, plan, conMod) : 0
  if (plan.species?.traits.some((t) => t.name === 'Dwarven Toughness')) hp += plan.level
  if (hasFeat(character, 'tough')) hp += 2 * plan.level
  const draconic = plan.classes.find((c) => c.slug === 'sorcerer' && c.subclass?.slug === 'draconic-sorcery' && c.level >= 3)
  if (draconic) hp += draconic.level
  const hitDice = plan.hitDice.map((d) => `${d.count}d${d.die}`).join(' + ')

  // CA, velocidade, iniciativa
  const ac = computeAc(character, plan, scores, look)
  const speed = computeSpeed(character, plan, scores, look)
  let initiative = scores.DEX.mod
  if (hasFeat(character, 'alert')) initiative += pb
  else if (jack) initiative += Math.floor(pb / 2)
  const perception = skills.find((s) => s.name === 'Perception')!.mod

  // Sentidos
  const lineage = plan.species?.lineages.find((l) => l.slug === character.speciesChoice.lineage)
  const lineageDark = lineage?.description.match(/Darkvision increases to (\d+) feet/)
  const darkvision = lineageDark ? Number(lineageDark[1]) : (plan.species?.darkvision_ft ?? null)

  // Proficiências de equipamento
  const trained = armorTrainingForPlan(plan)
  const weaponsText: string[] = []
  const tools: string[] = []
  for (const c of plan.classes) {
    if (c.gains) {
      if (c.gains.martial) weaponsText.push(`Martial weapons (${c.cls.name})`)
      c.gains.toolNames.forEach((name) => tools.push(look.tools.get(slugify(name))?.name ?? name))
    } else {
      weaponsText.push(...c.cls.weapon_proficiencies)
      tools.push(...c.cls.tool_proficiencies.filter((t) => !t.toLowerCase().startsWith('choose')))
    }
    for (const slug of c.picks.classTools) tools.push(look.tools.get(slug)?.name ?? slug)
    if (c.picks.classOrder === 'protector' || c.picks.classOrder === 'warden') weaponsText.push('Martial weapons (Ordem)')
  }
  if (plan.background) {
    const bgTool = plan.background.tool_slug ?? character.backgroundTool
    if (bgTool) tools.push(look.tools.get(bgTool)?.name ?? plan.background.tool_proficiency)
  }
  for (const pick of Object.values(character.feats)) {
    if (pick.slug === 'skilled') pick.skilled?.filter((s) => !(s in SKILL_BY_NAME)).forEach((s) => tools.push(look.tools.get(s)?.name ?? s))
  }
  const armorLabels = [...trained].map((t) => (t === 'Shield' ? 'Shields' : `${t} armor`))

  // Avisos
  const { body, shield } = equippedArmor(character, look)
  if (body && !trained.has(armorTier(body))) warnings.push(`Sem treinamento com ${body.name}: Desvantagem em testes de Força/Destreza e não pode conjurar magias.`)
  if (shield && !trained.has('Shield')) warnings.push('Sem treinamento com Escudos: não recebe o bônus de CA.')
  if (body?.strength_requirement && scores.STR.total < body.strength_requirement) {
    warnings.push(`${body.name} exige Força ${body.strength_requirement}: Velocidade reduzida em 10 ft.`)
  }
  if (body?.stealth_disadvantage) warnings.push(`${body.name} impõe Desvantagem em testes de Furtividade (Stealth).`)
  if (plan.classes.filter((c) => featureLevels(c.cls, c.level, 'Extra Attack').length > 0).length > 1) {
    warnings.push('Ataque Extra de classes diferentes não se acumula: você faz no máximo um ataque extra por ação de Atacar (o de Guerreiro nível 11 e 20 é exceção).')
  }

  // Equipamento: peso e ouro
  let weight = 0
  for (const item of character.inventory) {
    if (!item.slug) continue
    const data = item.type === 'weapon' ? look.weapons.get(item.slug) : item.type === 'armor' ? look.armor.get(item.slug) : item.type === 'tool' ? look.tools.get(item.slug) : look.gear.get(item.slug)
    weight += (data?.weight_lb ?? 0) * item.quantity
  }
  const classGold = plan.cls?.starting_equipment_options.find((o) => o.option_label === character.classEquipment)?.gold_gp ?? 0
  const bgGold = plan.background?.equipment_options.find((o) => o.option_label === character.backgroundEquipment)?.gold_gp ?? 0

  // Conjuração: um conjurador por classe, espaços combinados
  const casters: CasterInfo[] = plan.classes
    .filter((c) => c.row?.spellcasting && c.casting.ability)
    .map((c) => ({ slug: c.slug, name: c.cls.name, ability: c.casting.ability!, dc: 8 + pb + scores[c.casting.ability!].mod, attack: pb + scores[c.casting.ability!].mod }))
  const spellcasting: SpellcastingInfo | null =
    casters.length > 0
      ? { ability: casters[0]!.ability, dc: casters[0]!.dc, attack: casters[0]!.attack, casters, slots: plan.spellSlots, pact: plan.pactSlots }
      : null

  const multi = plan.classes.length > 1
  const resources = [
    ...plan.classes.flatMap((c) =>
      Object.entries(c.row?.class_specific_columns ?? {})
        .filter(([key]) => key !== 'eldritch_invocations')
        .map(([key, value]) => ({ label: multi ? `${prettify(key)} (${c.cls.name})` : prettify(key), value: String(value) })),
    ),
    ...extraResources(ctx),
  ]

  const features = collectFeatures(character, plan, look, ctx)
  for (const f of features) if (f.uses && !resources.some((r) => r.label === f.name)) resources.push({ label: f.name, value: f.uses })

  const defenses: string[] = []
  if (character.elementalAffinity && plan.classes.some((c) => c.slug === 'sorcerer' && c.subclass?.slug === 'draconic-sorcery' && c.level >= 6)) {
    defenses.push(`Resistência a dano ${character.elementalAffinity} (Afinidade Elemental)`)
  }

  return {
    plan,
    proficiencyBonus: pb,
    scores,
    saves,
    skills,
    hp,
    hitDie,
    hitDice,
    defenses,
    ac,
    initiative,
    speed,
    darkvision,
    passivePerception: 10 + perception,
    attacks: computeAttacks(character, plan, scores, look, ctx),
    spellcasting,
    spells: collectSpells(character, plan, look, scores),
    proficiencies: { armor: armorLabels, weapons: weaponsText, tools },
    languages: ['Common', ...character.languages],
    features,
    resources,
    carryCapacity: scores.STR.total * 15,
    weightCarried: Math.round(weight * 10) / 10,
    gold: classGold + bgGold + character.extraGold,
    warnings,
  }
}
