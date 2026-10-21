import type { Ability, ItemType } from '../api/types'
import { ABILITIES } from './srd'

export type AbilityMethod = 'standard' | 'pointbuy' | 'manual'

/** Escolhas feitas dentro de um talento (cada talento do personagem ocupa um "slot"). */
export interface FeatPick {
  slug: string | null
  /** Talento "Ability Score Improvement": +2 em um atributo (`plus2`) ou +1 em dois (`plus1` e `plus1b`). */
  asi?: { mode: 'plus2' | 'plus1x2'; first: Ability | null; second: Ability | null }
  /** Talentos com opções de atributo (+1 em um dos atributos permitidos). */
  ability?: Ability | null
  /** Magic Initiate: lista de magias, atributo de conjuração e magias escolhidas. */
  magicInitiate?: { list: string | null; ability: Ability | null; cantrips: string[]; spell: string | null }
  /** Skilled: três perícias ou ferramentas. */
  skilled?: string[]
}

export interface InventoryItem {
  id: string
  slug: string | null
  type: ItemType | null
  name: string
  quantity: number
  source: 'class' | 'background' | 'custom'
  equipped: boolean
  /** Opções quando o item é uma escolha ainda não feita (ex.: um Holy Symbol). */
  choices: string[]
}

export interface Character {
  schema: 1
  id: string
  createdAt: string
  updatedAt: string

  name: string
  alignment: string
  languages: string[]
  appearance: string
  personality: string
  ideals: string
  bonds: string
  flaws: string
  backstory: string

  level: number
  classSlug: string | null
  subclassSlug: string | null

  speciesSlug: string | null
  speciesChoice: { lineage: string | null; size: string | null; skill: string | null; spellAbility: Ability | null }

  backgroundSlug: string | null
  backgroundAsi: { mode: 'two-one' | 'one-one-one'; plus2: Ability | null; plus1: Ability | null }
  backgroundTool: string | null

  abilityMethod: AbilityMethod
  baseScores: Record<Ability, number | null>

  classSkills: string[]
  classTools: string[]
  expertise: string[]
  classOrder: string | null
  styleOption: 'feat' | 'blessed-warrior' | 'druidic-warrior'
  styleCantrips: string[]
  masteries: string[]
  invocations: string[]
  metamagic: string[]
  feats: Record<string, FeatPick>

  spells: { cantrips: string[]; spellbook: string[]; prepared: string[]; arcanum: Record<string, string> }

  classEquipment: string | null
  backgroundEquipment: string | null
  inventory: InventoryItem[]
  extraGold: number
}

export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function emptyScores(): Record<Ability, number | null> {
  return Object.fromEntries(ABILITIES.map((a) => [a, null])) as Record<Ability, number | null>
}

export function newCharacter(): Character {
  const now = new Date().toISOString()
  return {
    schema: 1,
    id: newId(),
    createdAt: now,
    updatedAt: now,
    name: '',
    alignment: '',
    languages: [],
    appearance: '',
    personality: '',
    ideals: '',
    bonds: '',
    flaws: '',
    backstory: '',
    level: 1,
    classSlug: null,
    subclassSlug: null,
    speciesSlug: null,
    speciesChoice: { lineage: null, size: null, skill: null, spellAbility: null },
    backgroundSlug: null,
    backgroundAsi: { mode: 'two-one', plus2: null, plus1: null },
    backgroundTool: null,
    abilityMethod: 'standard',
    baseScores: emptyScores(),
    classSkills: [],
    classTools: [],
    expertise: [],
    classOrder: null,
    styleOption: 'feat',
    styleCantrips: [],
    masteries: [],
    invocations: [],
    metamagic: [],
    feats: {},
    spells: { cantrips: [], spellbook: [], prepared: [], arcanum: {} },
    classEquipment: null,
    backgroundEquipment: null,
    inventory: [],
    extraGold: 0,
  }
}

/** Completa campos ausentes de fichas salvas por versões anteriores ou importadas de arquivo. */
export function normalizeCharacter(raw: unknown): Character | null {
  if (!raw || typeof raw !== 'object') return null
  const data = raw as Partial<Character>
  if (data.schema !== 1 || typeof data.id !== 'string') return null
  const base = newCharacter()
  return {
    ...base,
    ...data,
    speciesChoice: { ...base.speciesChoice, ...data.speciesChoice },
    backgroundAsi: { ...base.backgroundAsi, ...data.backgroundAsi },
    baseScores: { ...base.baseScores, ...data.baseScores },
    spells: { ...base.spells, ...data.spells },
    feats: data.feats ?? {},
    inventory: Array.isArray(data.inventory) ? data.inventory : [],
  }
}
