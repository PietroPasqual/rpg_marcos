// Tipos das respostas da API de catálogo (apenas os campos usados pelo montador de ficha).

export type Ability = 'STR' | 'DEX' | 'CON' | 'INT' | 'WIS' | 'CHA'

export interface Paginated<T> {
  meta: { total: number; page: number; size: number; pages: number; has_next: boolean; has_prev: boolean }
  items: T[]
}

export interface Named {
  slug: string
  name: string
}

export interface EmbeddedTable {
  caption: string | null
  headers: string[]
  rows: string[][]
}

// ---------- Classes ----------

export interface ClassFeature extends Named {
  level: number
  is_subclass_feature: boolean
  description: string
  tables: EmbeddedTable[]
}

export interface SpellcastingRow {
  cantrips_known: number | null
  prepared_spells: number
  slots_by_level: Record<string, number>
  pact_slots_count: number | null
  pact_slot_level: number | null
}

export interface ClassLevelRow {
  level: number
  proficiency_bonus: number
  feature_names: string[]
  feature_slugs: string[]
  weapon_masteries_known: number
  class_specific_columns: Record<string, number | string>
  spellcasting: SpellcastingRow | null
}

export type ItemType = 'weapon' | 'armor' | 'tool' | 'gear'

export interface EquipmentItem {
  item_slug: string | null
  item_name: string
  quantity: number
  item_type: ItemType | null
  choose_from: string[]
}

export interface EquipmentOption {
  option_label: string
  items: EquipmentItem[]
  gold_gp: number
}

export interface ToolChoice {
  count: number
  label: string
  choose_from: string[]
}

export interface ClassData extends Named {
  primary_abilities: Ability[]
  primary_ability_logic: string
  hit_point_die: string
  saving_throw_proficiencies: Ability[]
  skill_choices_count: number
  skill_options: string[]
  weapon_proficiencies: string[]
  tool_proficiencies: string[]
  tool_proficiency_choices: ToolChoice[]
  armor_training: string[]
  starting_equipment_options: EquipmentOption[]
  spellcasting_ability: Ability | null
  has_weapon_mastery: boolean
  level_table: ClassLevelRow[]
  features: ClassFeature[]
  subclass_unlock_level: number
  subclasses_summary: Named[]
}

export interface SubclassData extends Named {
  parent_class_slug: string
  parent_class_name: string
  unlock_level: number
  always_prepared_spells: { class_level: number; spell_slugs: string[]; spell_names: string[] }[]
  features: ClassFeature[]
}

export interface FeatureOption extends Named {
  parent_class_slug: string
  category: string
  level_prerequisite: number
  prerequisite_text: string | null
  cost_text: string | null
  description: string
}

// ---------- Origens ----------

export interface SpeciesTrait extends Named {
  description: string
}

export interface LineageBenefit {
  character_level: number
  description: string
  granted_spells: string[]
}

export interface Lineage extends Named {
  description: string
  benefits_by_level: LineageBenefit[]
}

export interface SpeciesData extends Named {
  sizes: string[]
  size_description: string
  speed_ft: number
  darkvision_ft: number | null
  traits: SpeciesTrait[]
  lineage_table_title: string | null
  lineages: Lineage[]
}

export interface BackgroundData extends Named {
  ability_scores: Ability[]
  origin_feat_slug: string
  origin_feat_name: string
  skill_proficiencies: string[]
  tool_proficiency: string
  tool_slug: string | null
  tool_choose_from: string[]
  equipment_options: EquipmentOption[]
  description: string
}

export interface FeatBenefit {
  name: string
  description: string
}

export interface FeatData extends Named {
  category: 'Origin' | 'General' | 'Fighting Style' | 'Epic Boon'
  level_prerequisite: number
  prerequisite_text: string | null
  ability_score_increase_options: Ability[]
  repeatable: boolean
  benefits: FeatBenefit[]
  description: string
}

// ---------- Magias ----------

export interface SpellData extends Named {
  level: number
  school: string
  class_lists: string[]
  casting_time: string
  range: string
  components: { verbal: boolean; somatic: boolean; material: boolean; material_description: string | null }
  duration: string
  concentration: boolean
  ritual: boolean
  description: string
  higher_levels: string | null
}

// ---------- Equipamento ----------

export interface WeaponData extends Named {
  category: string
  range_type: 'Melee' | 'Ranged'
  damage_dice: string
  damage_type: string
  properties: string[]
  versatile_damage_dice: string | null
  mastery_slug: string
  mastery_name: string
  weight_lb: number
  cost_display: string
  range_normal_ft: number | null
  range_long_ft: number | null
}

export interface ArmorData extends Named {
  category: 'Light Armor' | 'Medium Armor' | 'Heavy Armor' | 'Shield'
  base_ac: number
  ac_formula_display: string
  adds_dex_modifier: boolean
  max_dex_modifier: number | null
  strength_requirement: number | null
  stealth_disadvantage: boolean
  weight_lb: number
  cost_display: string
}

export interface ToolData extends Named {
  category: string
  ability: Ability
  weight_lb: number
  cost_display: string
  description: string
}

export interface GearData extends Named {
  category: string
  weight_lb: number
  cost_display: string
  description: string
  pack_contents: { item_slug: string; item_name: string; quantity: number }[]
}

export interface WeaponMasteryData extends Named {
  trigger_condition: string
  effect_summary: string
  description: string
}

// ---------- Catálogo carregado ----------

export interface Catalog {
  classes: ClassData[]
  subclasses: SubclassData[]
  species: SpeciesData[]
  backgrounds: BackgroundData[]
  feats: FeatData[]
  spells: SpellData[]
  weapons: WeaponData[]
  armor: ArmorData[]
  tools: ToolData[]
  gear: GearData[]
  masteries: WeaponMasteryData[]
  featureOptions: FeatureOption[]
  attribution: string
  importVersion: string
}
