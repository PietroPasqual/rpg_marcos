// Efeitos de características que alteram a ficha além do texto: dano extra nos ataques, usos por descanso,
// reservas de recursos e defesas. Tudo é calculado a partir da tabela de classe e dos textos do SRD.

import type { Ability } from '../api/types'
import type { Character } from './character'
import type { Plan } from './plan'
import { ABILITY_FULL_NAME } from './srd'

export interface EffectContext {
  character: Character
  plan: Plan
  mods: Record<Ability, number>
  pb: number
}

export interface ResourceEntry {
  label: string
  value: string
}

export const classLevel = (plan: Plan, slug: string): number => plan.classes.find((c) => c.slug === slug)?.level ?? 0

function column(plan: Plan, slug: string, key: string): string | number | undefined {
  return plan.classes.find((c) => c.slug === slug)?.row?.class_specific_columns[key]
}

const hasFeat = (character: Character, slug: string): boolean => Object.values(character.feats).some((p) => p.slug === slug)

export interface AttackInfo {
  melee: boolean
  ranged: boolean
  properties: string[]
  /** Atributo usado no ataque. */
  ability: Ability | null
  unarmed: boolean
}

/** Dano extra e regras de ataque que dependem de classe e talentos (exibidos na linha do ataque). */
export function attackExtras(ctx: EffectContext, attack: AttackInfo): string[] {
  const { plan, character } = ctx
  const extras: string[] = []

  const rageDamage = column(plan, 'barbarian', 'rage_damage')
  if (rageDamage !== undefined && attack.melee && attack.ability === 'STR') extras.push(`Em Fúria: ${rageDamage} de dano`)

  const sneak = column(plan, 'rogue', 'sneak_attack')
  if (sneak !== undefined && !attack.unarmed && (attack.ranged || attack.properties.includes('Finesse'))) {
    extras.push(`Ataque Furtivo: +${String(sneak).toLowerCase()} (1×/turno)`)
  }

  const ranger = classLevel(plan, 'ranger')
  if (ranger >= 1) extras.push(`Marca do Caçador: +1d${ranger >= 20 ? 10 : 6} (alvo marcado)`)

  if (hasFeat(character, 'great-weapon-fighting') && attack.melee && (attack.properties.includes('Two-Handed') || attack.properties.includes('Versatile'))) {
    extras.push('Armas Grandes: dado 1 ou 2 conta como 3 (duas mãos)')
  }
  if (hasFeat(character, 'two-weapon-fighting') && attack.melee && attack.properties.includes('Light')) {
    extras.push('Duas Armas: some o modificador ao dano da mão secundária')
  }
  return extras
}

/** Reservas e usos que o SRD descreve em texto mas a tabela de classe não traz. */
export function extraResources(ctx: EffectContext): ResourceEntry[] {
  const { plan, mods, pb } = ctx
  const resources: ResourceEntry[] = []

  const paladin = classLevel(plan, 'paladin')
  if (paladin > 0) resources.push({ label: 'Lay on Hands (reserva)', value: `${5 * paladin} PV` })

  if (classLevel(plan, 'bard') > 0) resources.push({ label: 'Bardic Inspiration (usos)', value: `${Math.max(1, mods.CHA)} por descanso longo` })

  const fighter = classLevel(plan, 'fighter')
  if (fighter >= 2) resources.push({ label: 'Action Surge', value: `${fighter >= 17 ? 2 : 1} por descanso` })
  if (fighter >= 9) resources.push({ label: 'Indomitable', value: `${fighter >= 17 ? 3 : fighter >= 13 ? 2 : 1} por descanso longo` })

  const wizard = classLevel(plan, 'wizard')
  if (wizard > 0) resources.push({ label: 'Arcane Recovery', value: `espaços somando até nível ${Math.ceil(wizard / 2)} (máx. 5), 1× por dia` })

  if (plan.species?.slug === 'dragonborn') {
    const dice = ctx.plan.level >= 17 ? 4 : ctx.plan.level >= 11 ? 3 : ctx.plan.level >= 5 ? 2 : 1
    resources.push({ label: 'Breath Weapon', value: `CD ${8 + mods.CON + pb}, ${dice}d10, ${pb}× por descanso longo` })
  }
  return resources
}

/** Quantos usos e quando recuperam, lidos do texto de uma característica ("a number of times equal to ..."). */
export function featureUses(text: string, ctx: EffectContext): string | null {
  let count: number | null = null
  if (/a number of times equal to your Proficiency Bonus/i.test(text)) count = ctx.pb
  const byAbility = text.match(/a number of times equal to your (Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) modifier \(minimum of once\)/i)
  if (byAbility) {
    const ability = (Object.keys(ABILITY_FULL_NAME) as Ability[]).find((a) => ABILITY_FULL_NAME[a].toLowerCase() === byAbility[1]!.toLowerCase())
    if (ability) count = Math.max(1, ctx.mods[ability])
  }
  if (count === null) return null
  const rest = /Short or Long Rest/i.test(text) ? 'descanso curto ou longo' : 'descanso longo'
  return `${count}× por ${rest}`
}

export const ELEMENTAL_AFFINITY_TYPES = ['Acid', 'Cold', 'Fire', 'Lightning', 'Poison']
