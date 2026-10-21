// Preenchimento automático: completa as escolhas que faltam com opções razoáveis, sem alterar as que o jogador já fez.
// Serve de atalho para fichas rápidas e como teste de estresse das regras (toda combinação deve poder ficar completa).

import type { Ability, Catalog } from '../api/types'
import { addClass, selectBackground, selectClass, selectSpecies, setClassLevel, suggestedStandardArray } from './actions'
import { picksOf, withPicks, type Character, type FeatPick } from './character'
import { isWeaponProficient, skillProficiencies, weaponRuleForPlan } from './derive'
import { ELEMENTAL_AFFINITY_TYPES } from './effects'
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
  /** Classes adicionais (multiclasse) e o nível em cada uma, aplicadas só se a ficha ainda não tiver nenhuma. */
  extraClasses?: { slug: string; level: number }[]
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

  if (c.multiclass.length === 0 && defaults.extraClasses?.length) {
    for (const extra of defaults.extraClasses) {
      step((x) => addClass(x, extra.slug))
      const index = c.multiclass.findIndex((m) => m.slug === extra.slug) + 1
      if (index > 0) step((x) => setClassLevel(x, index, extra.level))
    }
  }

  // Subclasse e espécie
  step((x) => {
    let y = x
    for (const cp of buildPlan(x, catalog).classes) {
      if (cp.needsSubclass && !cp.subclass) y = withPicks(y, cp.index, { subclassSlug: cp.subclassOptions[0]!.slug })
    }
    return y
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
    const primary = p.classes.flatMap((cp) => cp.cls.primary_abilities)
    const ordered = [...bg.ability_scores.filter((a) => primary.includes(a)), ...bg.ability_scores.filter((a) => !primary.includes(a))]
    const asi = x.backgroundAsi
    return {
      ...x,
      backgroundAsi: { mode: 'two-one', plus2: asi.plus2 ?? ordered[0]!, plus1: asi.plus1 ?? ordered.find((a) => a !== (asi.plus2 ?? ordered[0])) ?? null },
      backgroundTool: x.backgroundTool ?? bg.tool_choose_from[0] ?? null,
    }
  })
  step((x) => {
    if (!ABILITIES.some((a) => x.baseScores[a] === null)) return x
    const primary = [...new Set(plan().classes.flatMap((cp) => cp.cls.primary_abilities))]
    // Mais de três atributos primários não cabem na Matriz Padrão com 13 ou mais: usa valores manuais.
    if (primary.length > 3) return { ...x, abilityMethod: 'manual', baseScores: Object.fromEntries(ABILITIES.map((a) => [a, primary.includes(a) ? 14 : 10])) as Character['baseScores'] }
    return { ...x, abilityMethod: 'standard', baseScores: suggestedStandardArray(primary) }
  })

  // Ordem, perícias e ferramentas de cada classe
  step((x) => {
    let y = x
    for (const cp of buildPlan(x, catalog).classes) y = withPicks(y, cp.index, { classOrder: picksOf(y, cp.index).classOrder ?? cp.orderOptions[0]?.slug ?? null })
    return y
  })
  step((x) => {
    const p = buildPlan(x, catalog)
    const taken = [...(p.background?.skill_proficiencies ?? []), ...(x.speciesChoice.skill ? [x.speciesChoice.skill] : [])]
    let y = x
    for (const cp of p.classes) {
      const picks = picksOf(y, cp.index)
      const options = SKILLS.map((s) => s.name).filter((s) => cp.skillOptions.includes(s) && !taken.includes(s))
      const skills = take(options, cp.skillCount, picks.classSkills)
      taken.push(...skills)
      const toolCount = cp.toolChoices.reduce((sum, t) => sum + t.count, 0)
      y = withPicks(y, cp.index, { classSkills: skills, classTools: take(cp.toolChoices[0]?.choose_from ?? [], toolCount, picks.classTools) })
    }
    return { ...y, languages: take(STANDARD_LANGUAGES, p.languageCount, y.languages) }
  })

  // Talentos
  step((x) => {
    const p = buildPlan(x, catalog)
    const primary = p.cls?.primary_abilities[0] ?? 'STR'
    const casting: Ability = p.classes.find((cp) => cp.casting.ability)?.casting.ability ?? 'INT'
    const feats: Record<string, FeatPick> = { ...x.feats }
    const used = new Set(Object.values(feats).map((f) => f.slug))
    const proficient = skillProficiencies(x, p)

    for (const slot of p.featSlots) {
      const owner = p.classes.find((cp) => cp.slug === (slot.classSlug ?? p.classes[0]?.slug))
      const isAltStyle = slot.base === 'fighting-style' && owner?.styleAlternative && owner.picks.styleOption === owner.styleAlternative
      if (isAltStyle) continue
      let pick = feats[slot.key]
      if (!pick?.slug) {
        let slug = slot.fixedSlug
        if (!slug) {
          const eligible = featsForSlot(slot, catalog.feats, p.level)
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
    const used: string[] = []
    let y = x
    for (const cp of p.classes) {
      const picks = picksOf(y, cp.index)
      const eligible = SKILLS.map((s) => s.name).filter((s) => known.has(s) && !used.includes(s) && (!cp.expertise.restrictTo || cp.expertise.restrictTo.includes(s)))
      const expertise = take(eligible, cp.expertise.count, picks.expertise)
      used.push(...expertise)
      y = withPicks(y, cp.index, { expertise })
    }
    return y
  })

  // Maestrias, invocações, metamagia e Afinidade Elemental
  step((x) => {
    const p = buildPlan(x, catalog)
    const rule = weaponRuleForPlan(p)
    let y = x
    for (const cp of p.classes) {
      const picks = picksOf(y, cp.index)
      const weapons = catalog.weapons.filter((w) => (cp.slug === 'barbarian' ? w.range_type === 'Melee' : true) && isWeaponProficient(w, rule)).map((w) => w.slug)
      const options = (category: string) => catalog.featureOptions.filter((o) => o.parent_class_slug === cp.slug && o.category === category && o.level_prerequisite <= cp.level).map((o) => o.slug)
      y = withPicks(y, cp.index, {
        masteries: take(weapons, cp.masteryCount, picks.masteries),
        invocations: take(options('Eldritch Invocation'), cp.invocationCount, picks.invocations),
        metamagic: take(options('Metamagic'), cp.metamagicCount, picks.metamagic),
      })
    }
    return { ...y, elementalAffinity: y.elementalAffinity ?? ELEMENTAL_AFFINITY_TYPES[0]! }
  })

  // Magias de cada classe
  step((x) => {
    const p = buildPlan(x, catalog)
    const slugs = (list: { slug: string }[]) => list.map((s) => s.slug)
    let y = x
    for (const cp of p.classes) {
      const picks = picksOf(y, cp.index)
      const pools = spellPools(picks, cp, catalog)
      const spellbook = take(slugs(pools.spellbook), cp.casting.spellbook, picks.spells.spellbook)
      const prepPool = slugs(spellPools({ ...picks, spells: { ...picks.spells, spellbook } }, cp, catalog).prepared)
      y = withPicks(y, cp.index, {
        styleCantrips: take(slugs(pools.style), cp.casting.styleCantrips, picks.styleCantrips),
        spells: {
          cantrips: take(slugs(pools.cantrips), cp.casting.cantrips, picks.spells.cantrips),
          spellbook,
          prepared: take(prepPool, cp.casting.prepared, picks.spells.prepared),
          arcanum: Object.fromEntries(cp.casting.arcanumLevels.map((lvl) => [String(lvl), picks.spells.arcanum[String(lvl)] || (pools.arcanum[lvl]?.[0]?.slug ?? '')])),
        },
      })
    }
    return y
  })

  // Equipamento
  if (c.classEquipment === null) step((x) => applyEquipmentOption(x, catalog, 'class', plan().cls?.starting_equipment_options[0]?.option_label ?? null))
  if (c.backgroundEquipment === null) step((x) => applyEquipmentOption(x, catalog, 'background', plan().background?.equipment_options[0]?.option_label ?? null))
  for (const item of c.inventory.filter((i) => i.choices.length > 0)) step((x) => resolveChoice(x, item.id, item.choices[0]!, catalog))

  return c
}
