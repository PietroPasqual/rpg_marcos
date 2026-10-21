// Regras de multiclasse do SRD 5.2.1: pré-requisitos, proficiências ganhas ao entrar em outra classe e
// quais classes contam para os espaços de magia combinados.

import type { Ability, ClassData, ToolChoice } from '../api/types'
import type { ArmorTier } from './derive'
import { ABILITY_LABEL, SKILLS } from './srd'

/** Classes cujos níveis contam inteiros / pela metade (arredondado para cima) na tabela de Conjurador Multiclasse. */
export const FULL_CASTERS = ['bard', 'cleric', 'druid', 'sorcerer', 'wizard']
export const HALF_CASTERS = ['paladin', 'ranger']

export const MULTICLASS_MINIMUM = 13

/** Atende ao requisito de atributo primário da classe (13 ou mais; "e" exige todos, "ou" basta um). */
export function meetsPrimary(cls: ClassData, totals: Record<Ability, number>): boolean {
  const abilities = cls.primary_abilities
  return cls.primary_ability_logic === 'AND'
    ? abilities.every((a) => totals[a] >= MULTICLASS_MINIMUM)
    : abilities.some((a) => totals[a] >= MULTICLASS_MINIMUM)
}

export function primaryRequirement(cls: ClassData): string {
  const joiner = cls.primary_ability_logic === 'AND' ? ' e ' : ' ou '
  return `${cls.primary_abilities.map((a) => ABILITY_LABEL[a]).join(joiner)} ${MULTICLASS_MINIMUM}+`
}

export interface MulticlassGains {
  martial: boolean
  armor: ArmorTier[]
  skillCount: number
  skillOptions: string[]
  toolNames: string[]
  toolChoice: ToolChoice | null
}

/** O que uma classe concede quando não é a classe inicial (tabela "Multiclass Proficiencies" do SRD). */
export function multiclassGains(cls: ClassData): MulticlassGains {
  const gained = cls.multiclassing.proficiencies_gained
  const armor = new Set<ArmorTier>()
  for (const text of gained.armor) {
    if (/light/i.test(text)) armor.add('Light')
    if (/medium/i.test(text)) armor.add('Medium')
    if (/heavy/i.test(text)) armor.add('Heavy')
    if (/shield/i.test(text)) armor.add('Shield')
  }
  const skillText = gained.skills[0] ?? ''
  const fromClassList = /skill list/i.test(skillText)
  const toolNames: string[] = []
  let toolChoice: ToolChoice | null = null
  for (const text of gained.tools) {
    if (/of your choice/i.test(text)) {
      const source = cls.tool_proficiency_choices[0]
      toolChoice = { count: 1, label: source?.label ?? text, choose_from: source?.choose_from ?? [] }
    } else {
      toolNames.push(text)
    }
  }
  return {
    martial: gained.weapons.some((w) => /martial/i.test(w)),
    armor: [...armor],
    skillCount: gained.skills.length > 0 ? 1 : 0,
    skillOptions: fromClassList ? cls.skill_options : SKILLS.map((s) => s.name),
    toolNames,
    toolChoice,
  }
}

/** "Fighter 3 / Wizard 2" para listas e cabeçalhos. */
export function describeClasses(character: { classSlug: string | null; level: number; multiclass: { slug: string; level: number }[] }, classes: { slug: string; name: string }[]): string {
  const name = (slug: string) => classes.find((c) => c.slug === slug)?.name ?? slug
  if (!character.classSlug) return 'Sem classe'
  return [{ slug: character.classSlug, level: character.level }, ...character.multiclass].map((c) => `${name(c.slug)} ${c.level}`).join(' / ')
}
