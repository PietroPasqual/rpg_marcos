// Lista o que ainda falta decidir em cada etapa do assistente.

import type { Catalog } from '../api/types'
import { picksOf, type Character } from './character'
import { computeScores, hpRollKey } from './derive'
import { featPickIssues, fixedMagicInitiateList, unmetPrerequisite } from './feats'
import { lookup } from './lookup'
import { meetsPrimary, primaryRequirement } from './multiclass'
import { buildPlan } from './plan'
import { ABILITIES, POINT_BUY_BUDGET, POINT_BUY_COST, STANDARD_ARRAY } from './srd'

export type StepId = 'class' | 'origin' | 'abilities' | 'choices' | 'spells' | 'equipment' | 'details'

export interface Issue {
  step: StepId
  message: string
  /** Avisos não impedem a ficha de estar completa. */
  optional?: boolean
}

export const STEPS: { id: StepId; label: string }[] = [
  { id: 'class', label: 'Classe' },
  { id: 'origin', label: 'Origem' },
  { id: 'abilities', label: 'Atributos' },
  { id: 'choices', label: 'Escolhas' },
  { id: 'spells', label: 'Magias' },
  { id: 'equipment', label: 'Equipamento' },
  { id: 'details', label: 'Detalhes' },
]

export function pointBuyCost(scores: Character['baseScores']): number {
  return ABILITIES.reduce((sum, a) => sum + (POINT_BUY_COST[scores[a] ?? 8] ?? 0), 0)
}

export function validate(character: Character, catalog: Catalog): Issue[] {
  const look = lookup(catalog)
  const plan = buildPlan(character, catalog)
  const issues: Issue[] = []
  const add = (step: StepId, message: string, optional = false) => issues.push({ step, message, optional })

  // ---- Classe ----
  const computed = computeScores(character, plan, look)
  const totals = Object.fromEntries(ABILITIES.map((a) => [a, computed[a].total])) as Record<(typeof ABILITIES)[number], number>
  const multi = plan.classes.length > 1
  if (!plan.cls) add('class', 'Escolha uma classe.')
  for (const cp of plan.classes) {
    const who = multi ? ` de ${cp.cls.name}` : ''
    if (cp.needsSubclass && !cp.subclass) add('class', `Escolha a subclasse${who} (disponível a partir do nível ${cp.cls.subclass_unlock_level}).`)
    // Multiclasse: 13 no atributo primário da classe inicial e das demais
    if (multi && !meetsPrimary(cp.cls, totals)) add('class', `Multiclasse: ${cp.cls.name} exige ${primaryRequirement(cp.cls)} (os atributos primários de todas as suas classes precisam de 13 ou mais).`)
  }
  if (character.hpMode === 'manual') {
    for (const cp of plan.classes) {
      const die = cp.hitDie
      for (let level = cp.index === 0 ? 2 : 1; level <= cp.level; level++) {
        const rolled = character.hpRolls[hpRollKey(cp.slug, level)]
        if (!(Number.isInteger(rolled) && rolled! >= 1 && rolled! <= die)) add('class', `Informe o dado de vida de ${cp.cls.name} no nível ${level} (1 a ${die}) ou use o valor médio.`, true)
      }
    }
  }

  // ---- Origem ----
  const { species, background, speciesNeeds: needs } = plan
  if (!species) add('origin', 'Escolha uma espécie.')
  if (species) {
    if (needs.lineage && !character.speciesChoice.lineage) add('origin', `Escolha a opção de ${species.lineage_table_title ?? 'linhagem'}.`)
    if (needs.size && !character.speciesChoice.size) add('origin', 'Escolha o tamanho do personagem.')
    if (needs.skill && !character.speciesChoice.skill) add('origin', 'Escolha a perícia concedida pela espécie.')
    if (needs.spellAbility && character.speciesChoice.lineage && !character.speciesChoice.spellAbility) {
      add('origin', 'Escolha o atributo de conjuração das magias da espécie.')
    }
  }
  if (!background) add('origin', 'Escolha um antecedente.')
  if (background) {
    const asi = character.backgroundAsi
    if (asi.mode === 'two-one') {
      if (!asi.plus2 || !asi.plus1 || asi.plus2 === asi.plus1) add('origin', 'Distribua +2 e +1 em atributos diferentes do antecedente.')
    }
    if (background.tool_choose_from.length > 0 && !character.backgroundTool) add('origin', 'Escolha a ferramenta do antecedente.')
  }

  // ---- Atributos ----
  const scores = character.baseScores
  if (character.abilityMethod === 'standard') {
    const assigned = ABILITIES.map((a) => scores[a])
    if (assigned.some((v) => v === null)) add('abilities', 'Atribua todos os valores da Matriz Padrão (15, 14, 13, 12, 10, 8).')
    else if ([...assigned].sort().join() !== [...STANDARD_ARRAY].sort().join()) add('abilities', 'Use cada valor da Matriz Padrão exatamente uma vez.')
  } else if (character.abilityMethod === 'pointbuy') {
    if (pointBuyCost(scores) > POINT_BUY_BUDGET) add('abilities', `Compra de pontos acima do limite de ${POINT_BUY_BUDGET}.`)
  } else if (ABILITIES.some((a) => scores[a] === null)) {
    add('abilities', 'Informe todos os seis atributos.')
  }

  // ---- Escolhas de classe, perícias e talentos ----
  if (plan.cls) {
    const exact = (current: number, needed: number, text: string) => {
      if (current < needed) add('choices', `Escolha ${needed - current} ${text}.`)
      else if (current > needed) add('choices', `Há ${current - needed} ${text} a mais que o permitido.`)
    }
    for (const cp of plan.classes) {
      const picks = picksOf(character, cp.index)
      const of = multi ? ` (${cp.cls.name})` : ''
      exact(picks.classSkills.length, cp.skillCount, `perícia(s) de classe${of}`)
      for (const choice of cp.toolChoices) exact(picks.classTools.length, choice.count, `ferramenta(s) de classe${of}`)
      if (cp.expertise.count > 0) exact(picks.expertise.length, cp.expertise.count, `especialização(ões)${of}`)
      if (cp.orderOptions.length > 0 && !picks.classOrder) add('choices', `Escolha ${cp.orderFeature}${of}.`)
      if (cp.masteryCount > 0) exact(picks.masteries.length, cp.masteryCount, `maestria(s) de arma${of}`)
      if (cp.invocationCount > 0) exact(picks.invocations.length, cp.invocationCount, `invocação(ões) mística(s)${of}`)
      if (cp.metamagicCount > 0) exact(picks.metamagic.length, cp.metamagicCount, `opção(ões) de Metamagia${of}`)
      if (cp.casting.styleCantrips > 0) exact(picks.styleCantrips.length, cp.casting.styleCantrips, `truque(s) do estilo de luta${of}`)
    }
    exact(character.languages.length, plan.languageCount, 'idioma(s)')
    const affinityClass = plan.classes.find((c) => c.slug === 'sorcerer' && c.subclass?.slug === 'draconic-sorcery' && c.level >= 6)
    if (affinityClass && !character.elementalAffinity) add('choices', 'Escolha o tipo de dano da Afinidade Elemental.')

    const used = new Map<string, number>()
    for (const slot of plan.featSlots) {
      const pick = character.feats[slot.key]
      const owner = plan.classes.find((c) => c.slug === (slot.classSlug ?? plan.classes[0]?.slug))
      const isStyleAlt = slot.base === 'fighting-style' && owner?.styleAlternative && owner.picks.styleOption === owner.styleAlternative
      if (isStyleAlt) continue
      if (!slot.fixedSlug && !pick?.slug) {
        add('choices', `${slot.label}: escolha um talento.`)
        continue
      }
      const slug = slot.fixedSlug ?? pick?.slug
      const feat = slug ? look.feats.get(slug) : undefined
      if (!feat) continue
      used.set(feat.slug, (used.get(feat.slug) ?? 0) + 1)
      if (used.get(feat.slug)! > 1 && !feat.repeatable) add('choices', `${feat.name} não é repetível.`)
      const unmet = unmetPrerequisite(feat, totals)
      if (unmet) add('choices', `${feat.name}: ${unmet}.`, true)
      const fixedList = fixedMagicInitiateList(slot, plan.background)
      for (const message of featPickIssues(pick && { ...pick, slug }, feat, fixedList)) add('choices', `${slot.label} (${feat.name}): ${message}.`)
    }
  }

  // ---- Magias ----
  for (const cp of plan.classes) {
    if (!cp.row?.spellcasting) continue
    const picks = picksOf(character, cp.index)
    const casting = cp.casting
    const of = multi ? ` (${cp.cls.name})` : ''
    const exact = (current: number, needed: number, text: string) => {
      if (current !== needed) add('spells', `${text}${of}: ${current} de ${needed}.`)
    }
    if (casting.cantrips > 0) exact(picks.spells.cantrips.length, casting.cantrips, 'Truques da classe')
    if (casting.spellbook > 0) exact(picks.spells.spellbook.length, casting.spellbook, 'Magias no grimório')
    if (casting.prepared > 0) exact(picks.spells.prepared.length, casting.prepared, 'Magias preparadas')
    for (const lvl of casting.arcanumLevels) if (!picks.spells.arcanum[String(lvl)]) add('spells', `Escolha a Arcana Mística de nível ${lvl}${of}.`)
  }

  // ---- Equipamento ----
  if (plan.cls && !character.classEquipment) add('equipment', 'Escolha o equipamento inicial da classe.')
  if (plan.background && !character.backgroundEquipment) add('equipment', 'Escolha o equipamento inicial do antecedente.')
  for (const item of character.inventory) if (item.choices.length > 0) add('equipment', `Escolha qual item é: ${item.name}.`)

  // ---- Detalhes ----
  if (!character.name.trim()) add('details', 'Dê um nome ao personagem.', true)
  if (!character.alignment) add('details', 'Escolha um alinhamento.', true)

  return issues
}

export const requiredIssues = (issues: Issue[]): Issue[] => issues.filter((i) => !i.optional)
