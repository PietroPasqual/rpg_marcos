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

/** Escolhas feitas dentro de uma classe. A classe inicial guarda as suas no topo da ficha; as demais, em `multiclass`. */
export type ClassPicks = Pick<
  Character,
  'subclassSlug' | 'classSkills' | 'classTools' | 'expertise' | 'classOrder' | 'styleOption' | 'styleCantrips' | 'masteries' | 'invocations' | 'metamagic' | 'spells'
>

/** Classe adicional (multiclasse): nível nela e as escolhas feitas dentro dela. */
export interface ExtraClass extends ClassPicks {
  slug: string
  level: number
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

  /** Nível na classe inicial (o nível total é `totalLevel`). */
  level: number
  classSlug: string | null
  subclassSlug: string | null
  /** Classes adicionais, na ordem em que foram escolhidas. */
  multiclass: ExtraClass[]
  /** PV: valor médio por nível ou o resultado de cada dado de vida (`hpRolls`, por "classe:nível"). */
  hpMode: 'average' | 'manual'
  hpRolls: Record<string, number>
  /** Afinidade Elemental do Feiticeiro Dracônico (tipo de dano). */
  elementalAffinity: string | null

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
    multiclass: [],
    hpMode: 'average',
    hpRolls: {},
    elementalAffinity: null,
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
    multiclass: Array.isArray(data.multiclass) ? data.multiclass.map(normalizeExtra) : [],
    hpRolls: data.hpRolls ?? {},
    inventory: Array.isArray(data.inventory) ? data.inventory : [],
  }
}

function normalizeExtra(extra: ExtraClass): ExtraClass {
  return { ...emptyPicks(), ...extra, spells: { ...emptyPicks().spells, ...extra.spells } }
}

export function emptyPicks(): ClassPicks {
  return {
    subclassSlug: null,
    classSkills: [],
    classTools: [],
    expertise: [],
    classOrder: null,
    styleOption: 'feat',
    styleCantrips: [],
    masteries: [],
    invocations: [],
    metamagic: [],
    spells: { cantrips: [], spellbook: [], prepared: [], arcanum: {} },
  }
}

/** Escolhas da classe de índice `index` (0 = classe inicial). */
export function picksOf(character: Character, index: number): ClassPicks {
  if (index === 0) {
    const { subclassSlug, classSkills, classTools, expertise, classOrder, styleOption, styleCantrips, masteries, invocations, metamagic, spells } = character
    return { subclassSlug, classSkills, classTools, expertise, classOrder, styleOption, styleCantrips, masteries, invocations, metamagic, spells }
  }
  const extra = character.multiclass[index - 1]
  return extra ? { ...extra } : emptyPicks()
}

export function withPicks(character: Character, index: number, patch: Partial<ClassPicks>): Character {
  if (index === 0) return { ...character, ...patch }
  return { ...character, multiclass: character.multiclass.map((extra, i) => (i === index - 1 ? { ...extra, ...patch } : extra)) }
}

/** Nível do personagem: soma dos níveis de todas as classes. */
export function totalLevel(character: Character): number {
  return (character.classSlug ? character.level : 0) + character.multiclass.reduce((sum, c) => sum + c.level, 0)
}

/** Quebra a chave de talento de uma classe adicional ("rogue:asi-4") em classe e chave base. */
export const featKey = (classSlug: string | null, base: string): string => (classSlug ? `${classSlug}:${base}` : base)
