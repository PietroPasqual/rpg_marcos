// Remove escolhas que deixaram de valer depois de uma mudança (outra classe, nível menor, outro antecedente...),
// para que a ficha nunca guarde, por exemplo, magias de um nível que o personagem não alcançou.

import type { Catalog } from '../api/types'
import { picksOf, withPicks, type Character, type FeatPick } from './character'
import { ELEMENTAL_AFFINITY_TYPES } from './effects'
import { fixedMagicInitiateList } from './feats'
import { buildPlan } from './plan'
import { hpRollKey, skillProficiencies } from './derive'
import { lookup } from './lookup'
import { spellPools } from './spells'
import { MAX_LEVEL } from './srd'

const keepFirst = <T>(items: T[], count: number): T[] => items.slice(0, Math.max(0, count))

/** Garante classes adicionais válidas: sem repetir, existentes no catálogo e somando no máximo 20 níveis. */
function sanitizeClasses(character: Character, catalog: Catalog): Character {
  const look = lookup(catalog)
  if (!character.classSlug) return character.multiclass.length > 0 ? { ...character, multiclass: [] } : character
  const seen = new Set([character.classSlug])
  let budget = MAX_LEVEL - Math.max(1, character.level)
  const multiclass = []
  for (const extra of character.multiclass) {
    if (!look.classes.has(extra.slug) || seen.has(extra.slug) || budget < 1) continue
    seen.add(extra.slug)
    const level = Math.min(budget, Math.max(1, Math.round(extra.level) || 1))
    budget -= level
    multiclass.push({ ...extra, level })
  }
  const unchanged = multiclass.length === character.multiclass.length && multiclass.every((c, i) => c.level === character.multiclass[i]!.level)
  return unchanged ? character : { ...character, multiclass }
}

export function prune(input: Character, catalog: Catalog): Character {
  const character = sanitizeClasses(input, catalog)
  const plan = buildPlan(character, catalog)
  let next: Character = { ...character }

  // Espécie
  const { species, speciesNeeds: needs, background } = plan
  const choice = { ...character.speciesChoice }
  if (!species || !species.lineages.some((l) => l.slug === choice.lineage)) choice.lineage = null
  if (!species || !species.sizes.includes(choice.size ?? '')) choice.size = species && species.sizes.length === 1 ? species.sizes[0]! : null
  if (!needs.skill || !needs.skill.includes(choice.skill ?? '')) choice.skill = null
  if (!needs.spellAbility || !choice.lineage) choice.spellAbility = null
  next.speciesChoice = choice

  // Antecedente
  const allowed = background?.ability_scores ?? []
  const asi = { ...character.backgroundAsi }
  if (!asi.plus2 || !allowed.includes(asi.plus2)) asi.plus2 = null
  if (!asi.plus1 || !allowed.includes(asi.plus1)) asi.plus1 = null
  next.backgroundAsi = asi
  if (!background?.tool_choose_from.includes(character.backgroundTool ?? '')) next.backgroundTool = null

  // Escolhas de cada classe. Uma perícia nunca se repete entre antecedente, espécie e classes.
  const takenSkills = new Set<string>([...(background?.skill_proficiencies ?? []), ...(choice.skill ? [choice.skill] : [])])
  for (const cp of plan.classes) {
    const picks = picksOf(character, cp.index)
    const skills = keepFirst(
      picks.classSkills.filter((s) => cp.skillOptions.includes(s) && !takenSkills.has(s)),
      cp.skillCount,
    )
    skills.forEach((s) => takenSkills.add(s))
    const toolOptions = new Set(cp.toolChoices.flatMap((c) => c.choose_from))
    next = withPicks(next, cp.index, {
      subclassSlug: cp.needsSubclass ? (cp.subclass?.slug ?? null) : null,
      classSkills: skills,
      classTools: keepFirst(
        picks.classTools.filter((t) => toolOptions.has(t)),
        cp.toolChoices.reduce((sum, c) => sum + c.count, 0),
      ),
      classOrder: cp.orderOptions.some((o) => o.slug === picks.classOrder) ? picks.classOrder : null,
      styleOption: cp.styleAlternative ? picks.styleOption : 'feat',
      masteries: keepFirst(picks.masteries, cp.masteryCount),
      invocations: keepFirst(picks.invocations, cp.invocationCount),
      metamagic: keepFirst(picks.metamagic, cp.metamagicCount),
    })
  }
  next.languages = keepFirst(character.languages, plan.languageCount)

  // Especialização: só em perícias com proficiência, sem repetir entre classes
  const planSkills = buildPlan(next, catalog)
  const proficient = skillProficiencies(next, planSkills)
  const expertTaken = new Set<string>()
  for (const cp of planSkills.classes) {
    const picks = picksOf(next, cp.index)
    const expertise = keepFirst(
      picks.expertise.filter((s) => proficient.has(s) && !expertTaken.has(s) && (!cp.expertise.restrictTo || cp.expertise.restrictTo.includes(s))),
      cp.expertise.count,
    )
    expertise.forEach((s) => expertTaken.add(s))
    next = withPicks(next, cp.index, { expertise })
  }

  // Talentos
  const feats: Record<string, FeatPick> = {}
  for (const slot of plan.featSlots) {
    let pick = character.feats[slot.key]
    if (slot.fixedSlug && pick?.slug !== slot.fixedSlug) pick = { slug: slot.fixedSlug }
    if (!pick) continue
    const fixedList = fixedMagicInitiateList(slot, background)
    if (fixedList && pick.magicInitiate) pick = { ...pick, magicInitiate: { ...pick.magicInitiate, list: fixedList } }
    feats[slot.key] = pick
  }
  next.feats = feats

  // Conjuração de cada classe (usa as classes/níveis já podados)
  const planAfter = buildPlan(next, catalog)
  for (const cp of planAfter.classes) {
    const picks = picksOf(next, cp.index)
    const original = picksOf(character, cp.index)
    const casting = cp.casting
    const pools = spellPools({ ...picks, spells: { ...original.spells } }, cp, catalog)
    const inPool = (slugs: string[], pool: { slug: string }[]) => slugs.filter((s) => pool.some((p) => p.slug === s))
    const spellbook = keepFirst(inPool(original.spells.spellbook, pools.spellbook), casting.spellbook)
    const poolsFinal = spellPools({ ...picks, spells: { ...original.spells, spellbook } }, cp, catalog)
    next = withPicks(next, cp.index, {
      styleCantrips: keepFirst(inPool(original.styleCantrips, pools.style), casting.styleCantrips),
      spells: {
        cantrips: keepFirst(inPool(original.spells.cantrips, pools.cantrips), casting.cantrips),
        spellbook,
        prepared: keepFirst(inPool(original.spells.prepared, poolsFinal.prepared), casting.prepared),
        arcanum: Object.fromEntries(
          casting.arcanumLevels
            .map((lvl) => [String(lvl), original.spells.arcanum[String(lvl)]] as const)
            .filter(([lvl, slug]) => slug && pools.arcanum[Number(lvl)]?.some((s) => s.slug === slug)),
        ) as Record<string, string>,
      },
    })
  }

  // PV registrados: só dados que existem (nível ≥ 2 na classe inicial, ≥ 1 nas demais) e dentro do dado de vida
  const hpRolls: Record<string, number> = {}
  planAfter.classes.forEach((cp, index) => {
    const die = Number(cp.cls.hit_point_die.replace('d', ''))
    for (let level = index === 0 ? 2 : 1; level <= cp.level; level++) {
      const rolled = character.hpRolls[hpRollKey(cp.slug, level)]
      if (Number.isInteger(rolled) && rolled! >= 1 && rolled! <= die) hpRolls[hpRollKey(cp.slug, level)] = rolled!
    }
  })
  next.hpRolls = hpRolls

  const affinityOk = planAfter.classes.some((c) => c.slug === 'sorcerer' && c.subclass?.slug === 'draconic-sorcery' && c.level >= 6)
  if (!affinityOk || !ELEMENTAL_AFFINITY_TYPES.includes(character.elementalAffinity ?? '')) next.elementalAffinity = null

  return next
}
