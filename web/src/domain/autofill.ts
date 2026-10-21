// Preenchimento automático: completa as escolhas que faltam com opções razoáveis, sem alterar as que o jogador já fez.
// Serve de atalho para fichas rápidas e como teste de estresse das regras (toda combinação deve poder ficar completa).

import type { Ability, Catalog } from '../api/types'
import { selectBackground, selectClass, selectSpecies, suggestedStandardArray } from './actions'
import type { Character, FeatPick } from './character'
import { isWeaponProficient, skillProficiencies, weaponRuleFor } from './derive'
import { applyEquipmentOption, resolveChoice } from './equipment'
import { fixedMagicInitiateList, featsForSlot } from './feats'
import { lookup } from './lookup'
import { buildPlan } from './plan'
import { prune } from './prune'
import { classSpells, spellPools } from './spells'
import { ABILITIES, SKILLS, STANDARD_LANGUAGES } from './srd'

const take = <T>(items: T[], count: number, already: T[] = []): T[] => [...already, ...items.filter((i) => !already.includes(i))].slice(0, count)

export interface AutofillDefaults {
  classSlug?: string
  speciesSlug?: string
  backgroundSlug?: string
}

export function autofill(input: Character, catalog: Catalog, defaults: AutofillDefaults = {}): Character {
  const look = lookup(catalog)
  let c = input
  const step = (fn: (c: Character) => Character) => {
    c = prune(fn(c), catalog)
  }
  const plan = () => buildPlan(c, catalog)

  if (!c.classSlug) step((x) => selectClass(x, defaults.classSlug ?? 'fighter', catalog))
  if (!c.speciesSlug) step((x) => selectSpecies(x, defaults.speciesSlug ?? 'human', catalog))
  if (!c.backgroundSlug) step((x) => selectBackground(x, defaults.backgroundSlug ?? 'soldier', catalog))

  // Subclasse e espécie
  step((x) => {
    const p = buildPlan(x, catalog)
    return p.needsSubclass && !p.subclass ? { ...x, subclassSlug: p.subclassOptions[0]!.slug } : x
  })
  step((x) => {
    const p = buildPlan(x, catalog)
    const choice = { ...x.speciesChoice }
    if (p.speciesNeeds.lineage && !choice.lineage) choice.lineage = p.species!.lineages[0]!.slug
    if (p.speciesNeeds.size && !choice.size) choice.size = p.species!.sizes[0]!
    if (p.speciesNeeds.skill && !choice.skill) choice.skill = p.speciesNeeds.skill.find((s) => !p.background?.skill_proficiencies.includes(s)) ?? null
    if (p.speciesNeeds.spellAbility && choice.lineage && !choice.spellAbility) choice.spellAbility = 'INT'
    return { ...x, speciesChoice: choice }
  })

  // Antecedente e atributos
  step((x) => {
    const p = buildPlan(x, catalog)
    const bg = p.background!
    const primary = p.cls?.primary_abilities ?? []
    const ordered = [...bg.ability_scores.filter((a) => primary.includes(a)), ...bg.ability_scores.filter((a) => !primary.includes(a))]
    const asi = x.backgroundAsi
    return {
      ...x,
      backgroundAsi: { mode: 'two-one', plus2: asi.plus2 ?? ordered[0]!, plus1: asi.plus1 ?? ordered.find((a) => a !== (asi.plus2 ?? ordered[0])) ?? null },
      backgroundTool: x.backgroundTool ?? bg.tool_choose_from[0] ?? null,
    }
  })
  step((x) => (ABILITIES.some((a) => x.baseScores[a] === null) ? { ...x, abilityMethod: 'standard', baseScores: suggestedStandardArray(plan().cls?.primary_abilities ?? []) } : x))

  // Ordem e perícias de classe
  step((x) => ({ ...x, classOrder: x.classOrder ?? plan().orderOptions[0]?.slug ?? null }))
  step((x) => {
    const p = buildPlan(x, catalog)
    const granted = [...(p.background?.skill_proficiencies ?? []), ...(x.speciesChoice.skill ? [x.speciesChoice.skill] : [])]
    const options = SKILLS.map((s) => s.name).filter((s) => p.classSkillOptions.includes(s) && !granted.includes(s))
    const toolCount = p.toolChoices.reduce((sum, t) => sum + t.count, 0)
    return {
      ...x,
      classSkills: take(options, p.classSkillCount, x.classSkills),
      classTools: take(p.toolChoices[0]?.choose_from ?? [], toolCount, x.classTools),
      languages: take(STANDARD_LANGUAGES, p.languageCount, x.languages),
    }
  })

  // Talentos
  step((x) => {
    const p = buildPlan(x, catalog)
    const primary = p.cls?.primary_abilities[0] ?? 'STR'
    const casting: Ability = p.casting.ability ?? 'INT'
    const feats: Record<string, FeatPick> = { ...x.feats }
    const used = new Set(Object.values(feats).map((f) => f.slug))
    const proficient = skillProficiencies(x, p)

    for (const slot of p.featSlots) {
      const isAltStyle = slot.key === 'fighting-style' && p.styleAlternative && x.styleOption === p.styleAlternative
      if (isAltStyle) continue
      let pick = feats[slot.key]
      if (!pick?.slug) {
        let slug = slot.fixedSlug
        if (!slug) {
          const eligible = featsForSlot(slot, catalog.feats, x.level)
          const preferred = slot.category === 'General' ? eligible.find((f) => f.slug === 'ability-score-improvement') : undefined
          slug = (preferred ?? eligible.find((f) => !used.has(f.slug) || f.repeatable) ?? eligible[0])!.slug
        }
        pick = { slug }
      }
      const feat = look.feats.get(pick.slug!)!
      if (pick.slug === 'ability-score-improvement' && !pick.asi?.first) pick = { ...pick, asi: { mode: 'plus2', first: primary, second: null } }
      else if (pick.slug !== 'ability-score-improvement' && feat.ability_score_increase_options.length > 0 && !pick.ability) pick = { ...pick, ability: feat.ability_score_increase_options.includes(primary) ? primary : feat.ability_score_increase_options[0]! }
      if (pick.slug === 'magic-initiate') {
        const mi = pick.magicInitiate ?? { list: null, ability: null, cantrips: [], spell: null }
        const list = fixedMagicInitiateList(slot, p.background) ?? mi.list ?? 'wizard'
        const spells = classSpells(catalog, list)
        pick = {
          ...pick,
          magicInitiate: {
            list,
            ability: mi.ability ?? (['INT', 'WIS', 'CHA'].includes(casting) ? casting : 'INT'),
            cantrips: take(spells.filter((s) => s.level === 0).map((s) => s.slug), 2, mi.cantrips),
            spell: mi.spell ?? spells.find((s) => s.level === 1)?.slug ?? null,
          },
        }
      }
      if (pick.slug === 'skilled') {
        const free = SKILLS.map((s) => s.name).filter((s) => !proficient.has(s))
        pick = { ...pick, skilled: take(free, 3, pick.skilled ?? []) }
        pick.skilled!.forEach((s) => proficient.add(s))
      }
      used.add(pick.slug)
      feats[slot.key] = pick
    }
    return { ...x, feats }
  })
  step((x) => {
    const p = buildPlan(x, catalog)
    const known = skillProficiencies(x, p)
    const proficient = SKILLS.map((s) => s.name).filter((s) => known.has(s) && (!p.expertise.restrictTo || p.expertise.restrictTo.includes(s)))
    return { ...x, expertise: take(proficient, p.expertise.count, x.expertise) }
  })

  // Estilo de luta alternativo, maestrias, invocações, metamagia
  step((x) => {
    const p = buildPlan(x, catalog)
    const rule = weaponRuleFor(p.cls?.weapon_proficiencies ?? [], x.classOrder)
    const weapons = catalog.weapons.filter((w) => (p.cls?.slug === 'barbarian' ? w.range_type === 'Melee' : true) && isWeaponProficient(w, rule)).map((w) => w.slug)
    const options = (category: string) => catalog.featureOptions.filter((o) => o.parent_class_slug === p.cls?.slug && o.category === category && o.level_prerequisite <= x.level).map((o) => o.slug)
    return {
      ...x,
      masteries: take(weapons, p.masteryCount, x.masteries),
      invocations: take(options('Eldritch Invocation'), p.invocationCount, x.invocations),
      metamagic: take(options('Metamagic'), p.metamagicCount, x.metamagic),
    }
  })

  // Magias
  step((x) => {
    const p = buildPlan(x, catalog)
    const pools = spellPools(x, p, catalog)
    const slugs = (list: { slug: string }[]) => list.map((s) => s.slug)
    const spellbook = take(slugs(pools.spellbook), p.casting.spellbook, x.spells.spellbook)
    const draft = { ...x, spells: { ...x.spells, spellbook } }
    const prepPool = slugs(spellPools(draft, p, catalog).prepared)
    return {
      ...x,
      styleCantrips: take(slugs(pools.style), p.casting.styleCantrips, x.styleCantrips),
      spells: {
        cantrips: take(slugs(pools.cantrips), p.casting.cantrips, x.spells.cantrips),
        spellbook,
        prepared: take(prepPool, p.casting.prepared, x.spells.prepared),
        arcanum: Object.fromEntries(p.casting.arcanumLevels.map((lvl) => [String(lvl), x.spells.arcanum[String(lvl)] || (pools.arcanum[lvl]?.[0]?.slug ?? '')])),
      },
    }
  })

  // Equipamento
  if (c.classEquipment === null) step((x) => applyEquipmentOption(x, catalog, 'class', plan().cls?.starting_equipment_options[0]?.option_label ?? null))
  if (c.backgroundEquipment === null) step((x) => applyEquipmentOption(x, catalog, 'background', plan().background?.equipment_options[0]?.option_label ?? null))
  for (const item of c.inventory.filter((i) => i.choices.length > 0)) step((x) => resolveChoice(x, item.id, item.choices[0]!, catalog))

  return c
}
