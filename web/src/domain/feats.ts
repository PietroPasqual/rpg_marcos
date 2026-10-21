import type { Ability, BackgroundData, FeatData } from '../api/types'
import type { FeatPick } from './character'
import type { FeatSlot } from './plan'
import { ABILITY_FULL_NAME } from './srd'

export const MAGIC_INITIATE_LISTS = ['cleric', 'druid', 'wizard']

/** Talentos que ocupam um slot, filtrados por categoria e pré-requisito de nível. */
export function featsForSlot(slot: FeatSlot, feats: FeatData[], level: number): FeatData[] {
  return feats.filter((f) => f.category === slot.category && f.level_prerequisite <= level)
}

/** Pré-requisito de atributo do texto, ex.: "Level 4+, Strength or Dexterity 13+". Retorna null se atendido. */
export function unmetPrerequisite(feat: FeatData, scores: Record<Ability, number>): string | null {
  const text = feat.prerequisite_text ?? ''
  const match = text.match(/((?:Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)(?:\s+or\s+(?:Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma))*)\s+(\d+)\+/)
  if (!match) return null
  const minimum = Number(match[2])
  const names = match[1]!.split(/\s+or\s+/)
  const ok = names.some((name) => {
    const ability = (Object.keys(ABILITY_FULL_NAME) as Ability[]).find((a) => ABILITY_FULL_NAME[a] === name)
    return ability ? scores[ability] >= minimum : false
  })
  return ok ? null : `Exige ${match[1]} ${minimum}+`
}

/** Lista de magias fixa do Magic Initiate vindo do antecedente ("Magic Initiate (Cleric)"). */
export function fixedMagicInitiateList(slot: FeatSlot, background: BackgroundData | null): string | null {
  if (slot.key !== 'origin' || !background) return null
  const match = background.origin_feat_name.match(/\((\w+)\)/)
  return match ? match[1]!.toLowerCase() : null
}

export function emptyPick(slug: string | null): FeatPick {
  return { slug }
}

/** Escolhas que faltam dentro de um talento já selecionado. */
export function featPickIssues(pick: FeatPick | undefined, feat: FeatData | undefined, fixedList: string | null): string[] {
  if (!pick?.slug || !feat) return []
  const issues: string[] = []
  if (pick.slug === 'ability-score-improvement') {
    const asi = pick.asi
    if (!asi?.first) issues.push('escolha o atributo')
    else if (asi.mode === 'plus1x2' && (!asi.second || asi.second === asi.first)) issues.push('escolha dois atributos diferentes')
  } else if (feat.ability_score_increase_options.length > 0 && !pick.ability) {
    issues.push('escolha o atributo que recebe +1')
  }
  if (pick.slug === 'magic-initiate') {
    const mi = pick.magicInitiate
    if (!(fixedList ?? mi?.list)) issues.push('escolha a lista de magias')
    if (!mi?.ability) issues.push('escolha o atributo de conjuração')
    if ((mi?.cantrips.length ?? 0) !== 2) issues.push('escolha 2 truques')
    if (!mi?.spell) issues.push('escolha 1 magia de nível 1')
  }
  if (pick.slug === 'skilled' && (pick.skilled?.length ?? 0) !== 3) issues.push('escolha 3 perícias ou ferramentas')
  return issues
}
