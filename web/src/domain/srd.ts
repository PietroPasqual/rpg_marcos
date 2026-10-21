// Constantes das regras de 2024 (SRD 5.2.1) que a API de catálogo não expõe como dados.

import type { Ability } from '../api/types'

export const ABILITIES: Ability[] = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA']

export const ABILITY_LABEL: Record<Ability, string> = {
  STR: 'Força',
  DEX: 'Destreza',
  CON: 'Constituição',
  INT: 'Inteligência',
  WIS: 'Sabedoria',
  CHA: 'Carisma',
}

export const ABILITY_FULL_NAME: Record<Ability, string> = {
  STR: 'Strength',
  DEX: 'Dexterity',
  CON: 'Constitution',
  INT: 'Intelligence',
  WIS: 'Wisdom',
  CHA: 'Charisma',
}

export interface SkillInfo {
  name: string
  ability: Ability
  label: string
}

export const SKILLS: SkillInfo[] = [
  { name: 'Acrobatics', ability: 'DEX', label: 'Acrobacia' },
  { name: 'Animal Handling', ability: 'WIS', label: 'Lidar com Animais' },
  { name: 'Arcana', ability: 'INT', label: 'Arcanismo' },
  { name: 'Athletics', ability: 'STR', label: 'Atletismo' },
  { name: 'Deception', ability: 'CHA', label: 'Enganação' },
  { name: 'History', ability: 'INT', label: 'História' },
  { name: 'Insight', ability: 'WIS', label: 'Intuição' },
  { name: 'Intimidation', ability: 'CHA', label: 'Intimidação' },
  { name: 'Investigation', ability: 'INT', label: 'Investigação' },
  { name: 'Medicine', ability: 'WIS', label: 'Medicina' },
  { name: 'Nature', ability: 'INT', label: 'Natureza' },
  { name: 'Perception', ability: 'WIS', label: 'Percepção' },
  { name: 'Performance', ability: 'CHA', label: 'Atuação' },
  { name: 'Persuasion', ability: 'CHA', label: 'Persuasão' },
  { name: 'Religion', ability: 'INT', label: 'Religião' },
  { name: 'Sleight of Hand', ability: 'DEX', label: 'Prestidigitação' },
  { name: 'Stealth', ability: 'DEX', label: 'Furtividade' },
  { name: 'Survival', ability: 'WIS', label: 'Sobrevivência' },
]

export const SKILL_BY_NAME: Record<string, SkillInfo> = Object.fromEntries(SKILLS.map((s) => [s.name, s]))

// Tabelas "Standard Languages" e "Rare Languages" do capítulo Character Creation do SRD 5.2.1.
export const STANDARD_LANGUAGES = [
  'Common Sign Language',
  'Draconic',
  'Dwarvish',
  'Elvish',
  'Giant',
  'Gnomish',
  'Goblin',
  'Halfling',
  'Orc',
]
export const RARE_LANGUAGES = ['Abyssal', 'Celestial', 'Deep Speech', 'Druidic', 'Infernal', 'Primordial', 'Sylvan', 'Thieves’ Cant', 'Undercommon']

export const ALIGNMENTS = [
  'Lawful Good',
  'Neutral Good',
  'Chaotic Good',
  'Lawful Neutral',
  'Neutral',
  'Chaotic Neutral',
  'Lawful Evil',
  'Neutral Evil',
  'Chaotic Evil',
]

export const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8]
export const POINT_BUY_BUDGET = 27
export const POINT_BUY_COST: Record<number, number> = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 }

export const MAX_LEVEL = 20
