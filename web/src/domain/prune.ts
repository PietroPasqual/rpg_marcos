// Remove escolhas que deixaram de valer depois de uma mudança (outra classe, nível menor, outro antecedente...),
// para que a ficha nunca guarde, por exemplo, magias de um nível que o personagem não alcançou.

import type { Catalog } from '../api/types'
import type { Character, FeatPick } from './character'
import { fixedMagicInitiateList } from './feats'
import { buildPlan } from './plan'
import { skillProficiencies } from './derive'
import { spellPools } from './spells'

const keepFirst = <T>(items: T[], count: number): T[] => items.slice(0, Math.max(0, count))

export function prune(character: Character, catalog: Catalog): Character {
  const plan = buildPlan(character, catalog)
  const next: Character = { ...character }

  // Classe
  if (!plan.needsSubclass || !plan.subclass) next.subclassSlug = plan.subclass?.slug ?? null
  if (!plan.needsSubclass) next.subclassSlug = null

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

  // Perícias: nunca repetir uma perícia já concedida por antecedente ou espécie
  const granted = new Set<string>([...(background?.skill_proficiencies ?? []), ...(next.speciesChoice.skill ? [next.speciesChoice.skill] : [])])
  next.classSkills = keepFirst(
    character.classSkills.filter((s) => plan.classSkillOptions.includes(s) && !granted.has(s)),
    plan.classSkillCount,
  )
  const toolOptions = new Set(plan.toolChoices.flatMap((c) => c.choose_from))
  next.classTools = keepFirst(
    character.classTools.filter((t) => toolOptions.has(t)),
    plan.toolChoices.reduce((sum, c) => sum + c.count, 0),
  )
  next.languages = keepFirst(character.languages, plan.languageCount)
  if (!plan.orderOptions.some((o) => o.slug === character.classOrder)) next.classOrder = null
  if (!plan.styleAlternative) next.styleOption = 'feat'
  const proficient = skillProficiencies(next, buildPlan(next, catalog))
  next.expertise = keepFirst(
    character.expertise.filter((s) => proficient.has(s) && (!plan.expertise.restrictTo || plan.expertise.restrictTo.includes(s))),
    plan.expertise.count,
  )

  next.masteries = keepFirst(character.masteries, plan.masteryCount)
  next.invocations = keepFirst(character.invocations, plan.invocationCount)
  next.metamagic = keepFirst(character.metamagic, plan.metamagicCount)

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

  // Conjuração (usa a classe/nível já podados)
  const planAfter = buildPlan(next, catalog)
  const casting = planAfter.casting
  const draft: Character = { ...next, spells: { ...character.spells, spellbook: character.spells.spellbook } }
  const pools = spellPools(draft, planAfter, catalog)
  const inPool = (slugs: string[], pool: { slug: string }[]) => slugs.filter((s) => pool.some((p) => p.slug === s))
  const spellbook = keepFirst(inPool(character.spells.spellbook, pools.spellbook), casting.spellbook)
  const poolsFinal = spellPools({ ...next, spells: { ...character.spells, spellbook } }, planAfter, catalog)
  next.spells = {
    cantrips: keepFirst(inPool(character.spells.cantrips, pools.cantrips), casting.cantrips),
    spellbook,
    prepared: keepFirst(inPool(character.spells.prepared, poolsFinal.prepared), casting.prepared),
    arcanum: Object.fromEntries(
      casting.arcanumLevels
        .map((lvl) => [String(lvl), character.spells.arcanum[String(lvl)]] as const)
        .filter(([lvl, slug]) => slug && pools.arcanum[Number(lvl)]?.some((s) => s.slug === slug)),
    ) as Record<string, string>,
  }
  next.styleCantrips = keepFirst(inPool(character.styleCantrips, pools.style), casting.styleCantrips)

  return next
}
