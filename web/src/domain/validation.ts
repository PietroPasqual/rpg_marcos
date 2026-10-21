// Lista o que ainda falta decidir em cada etapa do assistente.

import type { Catalog } from '../api/types'
import type { Character } from './character'
import { computeScores } from './derive'
import { featPickIssues, fixedMagicInitiateList, unmetPrerequisite } from './feats'
import { lookup } from './lookup'
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
  if (!plan.cls) add('class', 'Escolha uma classe.')
  if (plan.needsSubclass && !plan.subclass) add('class', `Escolha a subclasse (disponível a partir do nível ${plan.cls?.subclass_unlock_level}).`)

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
    exact(character.classSkills.length, plan.classSkillCount, 'perícia(s) de classe')
    for (const choice of plan.toolChoices) exact(character.classTools.length, choice.count, 'ferramenta(s) de classe')
    if (plan.expertise.count > 0) exact(character.expertise.length, plan.expertise.count, 'especialização(ões)')
    exact(character.languages.length, plan.languageCount, 'idioma(s)')
    if (plan.orderOptions.length > 0 && !character.classOrder) add('choices', `Escolha ${plan.orderFeature}.`)
    if (plan.masteryCount > 0) exact(character.masteries.length, plan.masteryCount, 'maestria(s) de arma')
    if (plan.invocationCount > 0) exact(character.invocations.length, plan.invocationCount, 'invocação(ões) mística(s)')
    if (plan.metamagicCount > 0) exact(character.metamagic.length, plan.metamagicCount, 'opção(ões) de Metamagia')
    if (plan.casting.styleCantrips > 0) exact(character.styleCantrips.length, plan.casting.styleCantrips, 'truque(s) do estilo de luta')

    const totals = Object.fromEntries(ABILITIES.map((a) => [a, computeScores(character, plan, look)[a].total])) as Record<(typeof ABILITIES)[number], number>
    const used = new Map<string, number>()
    for (const slot of plan.featSlots) {
      const pick = character.feats[slot.key]
      const isStyleAlt = slot.key === 'fighting-style' && plan.styleAlternative && character.styleOption === plan.styleAlternative
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
  const casting = plan.casting
  if (plan.cls && plan.row?.spellcasting) {
    const exact = (current: number, needed: number, text: string) => {
      if (current !== needed) add('spells', `${text}: ${current} de ${needed}.`)
    }
    if (casting.cantrips > 0) exact(character.spells.cantrips.length, casting.cantrips, 'Truques da classe')
    if (casting.spellbook > 0) exact(character.spells.spellbook.length, casting.spellbook, 'Magias no grimório')
    if (casting.prepared > 0) exact(character.spells.prepared.length, casting.prepared, 'Magias preparadas')
    for (const lvl of casting.arcanumLevels) if (!character.spells.arcanum[String(lvl)]) add('spells', `Escolha a Arcana Mística de nível ${lvl}.`)
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
