"""
Schemas Pydantic v2 e Modelos SQLAlchemy 2.0 (Compatíveis com SQLite e PostgreSQL)
para a API de Catálogo do D&D 5e (Edição 2024 / SRD 5.2.1).
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from enum import StrEnum
from typing import Any, Generic, TypeVar

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Index, Integer, JSON, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

T = TypeVar("T")


# =====================================================================
# 1. ENUMERAÇÕES OFICIAIS D&D 5E 2024 (SRD 5.2.1)
# =====================================================================


class AbilityScoreEnum(StrEnum):
    STR = "STR"
    DEX = "DEX"
    CON = "CON"
    INT = "INT"
    WIS = "WIS"
    CHA = "CHA"


class SizeEnum(StrEnum):
    TINY = "Tiny"
    SMALL = "Small"
    MEDIUM = "Medium"
    LARGE = "Large"
    HUGE = "Huge"
    GARGANTUAN = "Gargantuan"


class DamageTypeEnum(StrEnum):
    ACID = "Acid"
    BLUDGEONING = "Bludgeoning"
    COLD = "Cold"
    FIRE = "Fire"
    FORCE = "Force"
    LIGHTNING = "Lightning"
    NECROTIC = "Necrotic"
    PIERCING = "Piercing"
    POISON = "Poison"
    PSYCHIC = "Psychic"
    RADIANT = "Radiant"
    SLASHING = "Slashing"
    THUNDER = "Thunder"


class SpellSchoolEnum(StrEnum):
    ABJURATION = "Abjuration"
    CONJURATION = "Conjuration"
    DIVINATION = "Divination"
    ENCHANTMENT = "Enchantment"
    EVOCATION = "Evocation"
    ILLUSION = "Illusion"
    NECROMANCY = "Necromancy"
    TRANSMUTATION = "Transmutation"


class FeatCategoryEnum(StrEnum):
    ORIGIN = "Origin"
    GENERAL = "General"
    FIGHTING_STYLE = "Fighting Style"
    EPIC_BOON = "Epic Boon"


class WeaponMasteryEnum(StrEnum):
    CLEAVE = "Cleave"
    GRAZE = "Graze"
    NICK = "Nick"
    PUSH = "Push"
    SAP = "Sap"
    SLOW = "Slow"
    TOPPLE = "Topple"
    VEX = "Vex"


class ArmorCategoryEnum(StrEnum):
    LIGHT = "Light Armor"
    MEDIUM = "Medium Armor"
    HEAVY = "Heavy Armor"
    SHIELD = "Shield"


class MagicItemRarityEnum(StrEnum):
    COMMON = "Common"
    UNCOMMON = "Uncommon"
    RARE = "Rare"
    VERY_RARE = "Very Rare"
    LEGENDARY = "Legendary"
    ARTIFACT = "Artifact"
    VARIES = "Varies"


class RuleGlossaryTagEnum(StrEnum):
    ACTION = "Action"
    AREA_OF_EFFECT = "Area of Effect"
    ATTITUDE = "Attitude"
    CONDITION = "Condition"
    HAZARD = "Hazard"
    GENERAL_RULE = "General Rule"
    RULES_SECTION = "Rules Section"


class FeatureOptionCategoryEnum(StrEnum):
    ELDRITCH_INVOCATION = "Eldritch Invocation"
    METAMAGIC = "Metamagic"
    BATTLE_MASTER_MANEUVER = "Battle Master Maneuver"
    CUNNING_STRIKE = "Cunning Strike"
    BRUTAL_STRIKE = "Brutal Strike"
    ELEMENTAL_DISCIPLINE = "Elemental Discipline"


# =====================================================================
# 2. MODELOS ORM SQLALCHEMY 2.0 (HÍBRIDOS SQLITE / POSTGRESQL)
# =====================================================================


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class CatalogMixin:
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    slug: Mapped[str] = mapped_column(String(120), unique=True, index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(200), index=True, nullable=False)
    source_book: Mapped[str] = mapped_column(String(120), default="Player's Handbook (2024)", nullable=False)
    source_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    is_srd: Mapped[bool] = mapped_column(Boolean, default=True, index=True, nullable=False)
    source_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    referenced_entities: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)


class ClassModel(CatalogMixin, Base):
    __tablename__ = "classes"

    primary_abilities: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    primary_ability_logic: Mapped[str] = mapped_column(String(10), default="OR", nullable=False)
    hit_point_die: Mapped[str] = mapped_column(String(10), index=True, nullable=False)
    hp_at_level_1: Mapped[str] = mapped_column(String(100), nullable=False)
    hp_per_level_after_1st: Mapped[str] = mapped_column(String(100), nullable=False)
    saving_throw_proficiencies: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    skill_choices_count: Mapped[int] = mapped_column(Integer, default=2, nullable=False)
    skill_options: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    weapon_proficiencies: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    tool_proficiencies: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    armor_training: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    starting_equipment_options: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list, nullable=False)
    multiclassing: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    spellcasting_ability: Mapped[str | None] = mapped_column(String(10), nullable=True)
    spellcasting_focus_type: Mapped[str | None] = mapped_column(String(80), nullable=True)
    has_weapon_mastery: Mapped[bool] = mapped_column(Boolean, default=False, index=True, nullable=False)
    level_table: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list, nullable=False)
    features: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list, nullable=False)
    subclass_unlock_level: Mapped[int] = mapped_column(Integer, default=3, nullable=False)
    subclass_feature_levels: Mapped[list[int]] = mapped_column(JSON, default=lambda: [3, 6, 10, 14], nullable=False)
    subclasses_summary: Mapped[list[dict[str, str]]] = mapped_column(JSON, default=list, nullable=False)


class SubclassModel(CatalogMixin, Base):
    __tablename__ = "subclasses"

    parent_class_slug: Mapped[str] = mapped_column(
        String(120), ForeignKey("classes.slug", ondelete="CASCADE"), index=True, nullable=False
    )
    parent_class_name: Mapped[str] = mapped_column(String(120), nullable=False)
    unlock_level: Mapped[int] = mapped_column(Integer, default=3, nullable=False)
    short_description: Mapped[str] = mapped_column(Text, nullable=False)
    always_prepared_spells: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list, nullable=False)
    features: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list, nullable=False)


class ClassFeatureOptionModel(CatalogMixin, Base):
    __tablename__ = "class_feature_options"

    parent_class_slug: Mapped[str] = mapped_column(String(120), index=True, nullable=False)
    parent_subclass_slug: Mapped[str | None] = mapped_column(String(120), index=True, nullable=True)
    category: Mapped[str] = mapped_column(String(60), index=True, nullable=False)
    level_prerequisite: Mapped[int] = mapped_column(Integer, default=1, index=True, nullable=False)
    prerequisite_text: Mapped[str | None] = mapped_column(String(250), nullable=True)
    cost_text: Mapped[str | None] = mapped_column(String(150), nullable=True)
    description: Mapped[str] = mapped_column(Text, nullable=False)


class SpeciesModel(CatalogMixin, Base):
    __tablename__ = "species"

    creature_type: Mapped[str] = mapped_column(String(60), default="Humanoid", index=True, nullable=False)
    sizes: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    size_description: Mapped[str] = mapped_column(String(160), nullable=False)
    speed_ft: Mapped[int] = mapped_column(Integer, default=30, nullable=False)
    special_speeds: Mapped[dict[str, int]] = mapped_column(JSON, default=dict, nullable=False)
    darkvision_ft: Mapped[int | None] = mapped_column(Integer, nullable=True)
    traits: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list, nullable=False)
    lineage_table_title: Mapped[str | None] = mapped_column(String(120), nullable=True)
    lineages: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list, nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)


class FeatModel(CatalogMixin, Base):
    __tablename__ = "feats"

    category: Mapped[str] = mapped_column(String(40), index=True, nullable=False)
    level_prerequisite: Mapped[int] = mapped_column(Integer, default=1, index=True, nullable=False)
    prerequisite_text: Mapped[str | None] = mapped_column(String(250), nullable=True)
    ability_score_increase_options: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    repeatable: Mapped[bool] = mapped_column(Boolean, default=False, index=True, nullable=False)
    repeatable_note: Mapped[str | None] = mapped_column(String(250), nullable=True)
    benefits: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list, nullable=False)
    description: Mapped[str] = mapped_column(Text, default="", nullable=False)


class BackgroundModel(CatalogMixin, Base):
    __tablename__ = "backgrounds"

    ability_scores: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    origin_feat_slug: Mapped[str] = mapped_column(
        String(120), ForeignKey("feats.slug"), index=True, nullable=False
    )
    origin_feat_name: Mapped[str] = mapped_column(String(200), nullable=False)
    skill_proficiencies: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    tool_proficiency: Mapped[str] = mapped_column(String(160), nullable=False)
    tool_slug: Mapped[str | None] = mapped_column(String(120), nullable=True)
    equipment_options: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list, nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)


class SpellModel(CatalogMixin, Base):
    __tablename__ = "spells"

    level: Mapped[int] = mapped_column(Integer, index=True, nullable=False)
    school: Mapped[str] = mapped_column(String(40), index=True, nullable=False)
    class_lists: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    casting_time: Mapped[str] = mapped_column(String(120), index=True, nullable=False)
    reaction_trigger: Mapped[str | None] = mapped_column(Text, nullable=True)
    ritual: Mapped[bool] = mapped_column(Boolean, default=False, index=True, nullable=False)
    range: Mapped[str] = mapped_column(String(120), nullable=False)
    area_of_effect: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    components: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    duration: Mapped[str] = mapped_column(String(120), nullable=False)
    concentration: Mapped[bool] = mapped_column(Boolean, default=False, index=True, nullable=False)
    saving_throw_ability: Mapped[str | None] = mapped_column(String(10), index=True, nullable=True)
    attack_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    damage_types: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    conditions_inflicted: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    higher_levels: Mapped[str | None] = mapped_column(Text, nullable=True)
    tables: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list, nullable=False)

    __table_args__ = (Index("ix_spells_level_school", "level", "school"),)


class WeaponMasteryModel(Base):
    __tablename__ = "weapon_masteries"

    slug: Mapped[str] = mapped_column(String(60), primary_key=True)
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    trigger_condition: Mapped[str] = mapped_column(String(120), nullable=False)
    effect_summary: Mapped[str] = mapped_column(String(300), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    compatible_weapons: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)


class WeaponModel(CatalogMixin, Base):
    __tablename__ = "weapons"

    category: Mapped[str] = mapped_column(String(40), index=True, nullable=False)
    range_type: Mapped[str] = mapped_column(String(20), index=True, nullable=False)
    damage_dice: Mapped[str] = mapped_column(String(30), nullable=False)
    damage_type: Mapped[str] = mapped_column(String(30), index=True, nullable=False)
    properties: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    range_normal_ft: Mapped[int | None] = mapped_column(Integer, nullable=True)
    range_long_ft: Mapped[int | None] = mapped_column(Integer, nullable=True)
    versatile_damage_dice: Mapped[str | None] = mapped_column(String(30), nullable=True)
    ammunition_type: Mapped[str | None] = mapped_column(String(60), nullable=True)
    mastery_slug: Mapped[str] = mapped_column(
        String(60), ForeignKey("weapon_masteries.slug"), index=True, nullable=False
    )
    mastery_name: Mapped[str] = mapped_column(String(60), nullable=False)
    weight_lb: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    cost_display: Mapped[str] = mapped_column(String(40), nullable=False)
    cost_cp: Mapped[int] = mapped_column(Integer, index=True, nullable=False)


class ArmorModel(CatalogMixin, Base):
    __tablename__ = "armors"

    category: Mapped[str] = mapped_column(String(40), index=True, nullable=False)
    base_ac: Mapped[int] = mapped_column(Integer, index=True, nullable=False)
    ac_formula_display: Mapped[str] = mapped_column(String(100), nullable=False)
    adds_dex_modifier: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    max_dex_modifier: Mapped[int | None] = mapped_column(Integer, nullable=True)
    strength_requirement: Mapped[int | None] = mapped_column(Integer, nullable=True)
    stealth_disadvantage: Mapped[bool] = mapped_column(Boolean, default=False, index=True, nullable=False)
    don_time: Mapped[str] = mapped_column(String(60), nullable=False)
    doff_time: Mapped[str] = mapped_column(String(60), nullable=False)
    weight_lb: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    cost_display: Mapped[str] = mapped_column(String(40), nullable=False)
    cost_cp: Mapped[int] = mapped_column(Integer, index=True, nullable=False)


class ToolModel(CatalogMixin, Base):
    __tablename__ = "tools"

    category: Mapped[str] = mapped_column(String(60), index=True, nullable=False)
    ability: Mapped[str] = mapped_column(String(10), index=True, nullable=False)
    weight_lb: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    cost_display: Mapped[str] = mapped_column(String(40), nullable=False)
    cost_cp: Mapped[int] = mapped_column(Integer, index=True, nullable=False)
    utilize_actions: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list, nullable=False)
    craftable_items: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    variants: Mapped[list[dict[str, str]]] = mapped_column(JSON, default=list, nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)


class AdventuringGearModel(CatalogMixin, Base):
    __tablename__ = "adventuring_gear"

    category: Mapped[str] = mapped_column(String(60), index=True, nullable=False)
    weight_lb: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    cost_display: Mapped[str] = mapped_column(String(40), nullable=False)
    cost_cp: Mapped[int] = mapped_column(Integer, index=True, nullable=False)
    action_type_required: Mapped[str | None] = mapped_column(String(60), index=True, nullable=True)
    pack_contents: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list, nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)


class MagicItemModel(CatalogMixin, Base):
    __tablename__ = "magic_items"

    item_category: Mapped[str] = mapped_column(String(60), index=True, nullable=False)
    rarity: Mapped[str] = mapped_column(String(40), index=True, nullable=False)
    requires_attunement: Mapped[bool] = mapped_column(Boolean, default=False, index=True, nullable=False)
    attunement_requirement: Mapped[str | None] = mapped_column(String(160), nullable=True)
    base_weapon_or_armor_slug: Mapped[str | None] = mapped_column(String(120), nullable=True)
    bonus_value: Mapped[int | None] = mapped_column(Integer, nullable=True)
    charges_max: Mapped[int | None] = mapped_column(Integer, nullable=True)
    recharge_formula: Mapped[str | None] = mapped_column(String(160), nullable=True)
    crafting_time_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
    crafting_cost_gp: Mapped[int | None] = mapped_column(Integer, index=True, nullable=True)
    description: Mapped[str] = mapped_column(Text, nullable=False)


class MonsterModel(CatalogMixin, Base):
    __tablename__ = "monsters"

    size: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    creature_type: Mapped[str] = mapped_column(String(80), index=True, nullable=False)
    alignment: Mapped[str] = mapped_column(String(80), nullable=False)
    armor_class: Mapped[int] = mapped_column(Integer, nullable=False)
    armor_notes: Mapped[str | None] = mapped_column(String(120), nullable=True)
    initiative_bonus: Mapped[int] = mapped_column(Integer, nullable=False)
    initiative_passive: Mapped[int] = mapped_column(Integer, nullable=False)
    hit_points: Mapped[int] = mapped_column(Integer, nullable=False)
    hit_dice_formula: Mapped[str] = mapped_column(String(60), nullable=False)
    speeds: Mapped[dict[str, str]] = mapped_column(JSON, default=dict, nullable=False)
    abilities: Mapped[dict[str, dict[str, int]]] = mapped_column(JSON, default=dict, nullable=False)
    skills: Mapped[dict[str, int]] = mapped_column(JSON, default=dict, nullable=False)
    gear: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    damage_vulnerabilities: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    damage_resistances: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    damage_immunities: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    condition_immunities: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    senses: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    languages: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    challenge_rating: Mapped[str] = mapped_column(String(20), index=True, nullable=False)
    cr_numeric: Mapped[float] = mapped_column(Float, index=True, nullable=False)
    xp: Mapped[int] = mapped_column(Integer, nullable=False)
    xp_in_lair: Mapped[int | None] = mapped_column(Integer, nullable=True)
    proficiency_bonus: Mapped[int] = mapped_column(Integer, nullable=False)
    habitat: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    treasure_theme: Mapped[str | None] = mapped_column(String(80), nullable=True)
    traits: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list, nullable=False)
    actions: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list, nullable=False)
    bonus_actions: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list, nullable=False)
    reactions: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list, nullable=False)
    legendary_actions_uses: Mapped[int | None] = mapped_column(Integer, nullable=True)
    legendary_actions_in_lair: Mapped[int | None] = mapped_column(Integer, nullable=True)
    legendary_actions: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list, nullable=False)



class CatalogMetadataModel(Base):
    """Chave/valor com a versão do catálogo importado (usado para reimportar quando o importador muda)."""

    __tablename__ = "catalog_metadata"

    key: Mapped[str] = mapped_column(String(60), primary_key=True)
    value: Mapped[str] = mapped_column(Text, nullable=False)


class RuleGlossaryModel(CatalogMixin, Base):
    __tablename__ = "rules_glossary"

    tag: Mapped[str] = mapped_column(String(40), index=True, nullable=False)
    summary: Mapped[str] = mapped_column(Text, nullable=False)
    bullet_effects: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    see_also_slugs: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)


# =====================================================================
# 3. SCHEMAS PYDANTIC V2 (REQUEST / RESPONSE CONTRACTS)
# =====================================================================


class EntityReferenceSchema(BaseModel):
    entity_type: str = Field(..., examples=["spell", "condition", "feat", "rule", "weapon-mastery"])
    slug: str = Field(..., examples=["prone"])
    name: str = Field(..., examples=["Prone"])
    api_path: str = Field(..., examples=["/api/v1/rules/prone"])


class EmbeddedTableSchema(BaseModel):
    caption: str | None = Field(default=None)
    headers: list[str]
    rows: list[list[str]]


class CatalogBaseSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    slug: str = Field(..., pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
    name: str
    source_book: str = Field(default="Player's Handbook (2024)")
    source_url: str | None = None
    is_srd: bool = True
    referenced_entities: list[EntityReferenceSchema] = Field(default_factory=list)


class PaginationMetaSchema(BaseModel):
    total: int
    page: int
    size: int
    pages: int
    has_next: bool
    has_prev: bool


class PaginatedResponse(BaseModel, Generic[T]):
    meta: PaginationMetaSchema
    items: list[T]


class ProblemDetailsSchema(BaseModel):
    type: str = Field(default="https://api.dnd2024.dev/errors/not-found")
    title: str
    status: int
    detail: str
    instance: str
    suggestions: list[str] = Field(default_factory=list)


# --- Origens (Species & Backgrounds) ---


class SpeciesTraitSchema(BaseModel):
    slug: str
    name: str
    description: str


class SpeciesLineageBenefitSchema(BaseModel):
    character_level: int
    description: str
    granted_spells: list[str] = Field(default_factory=list)


class SpeciesLineageSchema(BaseModel):
    slug: str
    name: str
    description: str
    benefits_by_level: list[SpeciesLineageBenefitSchema]


class SpeciesSchema(CatalogBaseSchema):
    creature_type: str = "Humanoid"
    sizes: list[SizeEnum]
    size_description: str
    speed_ft: int = 30
    special_speeds: dict[str, int] = Field(default_factory=dict)
    darkvision_ft: int | None = 60
    traits: list[SpeciesTraitSchema]
    lineage_table_title: str | None = None
    lineages: list[SpeciesLineageSchema] = Field(default_factory=list)
    description: str


class EquipmentItemQuantitySchema(BaseModel):
    item_slug: str
    item_name: str
    quantity: int = 1


class BackgroundEquipmentOptionSchema(BaseModel):
    option_label: str
    items: list[EquipmentItemQuantitySchema] = Field(default_factory=list)
    gold_gp: int = 0


class BackgroundSchema(CatalogBaseSchema):
    ability_scores: list[AbilityScoreEnum] = Field(..., min_length=3, max_length=3)
    origin_feat_slug: str
    origin_feat_name: str
    skill_proficiencies: list[str] = Field(..., min_length=2, max_length=2)
    tool_proficiency: str
    tool_slug: str | None = None
    equipment_options: list[BackgroundEquipmentOptionSchema]
    description: str


# --- Talentos (Feats) ---


class FeatBenefitSchema(BaseModel):
    name: str
    description: str


class FeatSchema(CatalogBaseSchema):
    category: FeatCategoryEnum
    level_prerequisite: int = 1
    prerequisite_text: str | None = None
    ability_score_increase_options: list[AbilityScoreEnum] = Field(default_factory=list)
    repeatable: bool = False
    repeatable_note: str | None = None
    benefits: list[FeatBenefitSchema]
    description: str = ""


# --- Classes, Subclasses & Feature Options ---


class ClassFeatureSchema(BaseModel):
    slug: str
    name: str
    level: int
    is_subclass_feature: bool = False
    action_economy: str | None = None
    uses_formula: str | None = None
    recharge: str | None = None
    description: str
    tables: list[EmbeddedTableSchema] = Field(default_factory=list)


class SpellcastingProgressionRowSchema(BaseModel):
    cantrips_known: int | None = None
    prepared_spells: int = 0
    slots_by_level: dict[str, int] = Field(default_factory=dict)
    pact_slots_count: int | None = None
    pact_slot_level: int | None = None


class ClassLevelProgressionSchema(BaseModel):
    level: int
    proficiency_bonus: int
    feature_names: list[str]
    feature_slugs: list[str]
    weapon_masteries_known: int = 0
    class_specific_columns: dict[str, int | str] = Field(default_factory=dict)
    spellcasting: SpellcastingProgressionRowSchema | None = None


class SubclassPreparedSpellsRowSchema(BaseModel):
    class_level: int
    spell_slugs: list[str]
    spell_names: list[str]


class SubclassSchema(CatalogBaseSchema):
    parent_class_slug: str
    parent_class_name: str
    unlock_level: int = 3
    short_description: str
    always_prepared_spells: list[SubclassPreparedSpellsRowSchema] = Field(default_factory=list)
    features: list[ClassFeatureSchema]


class MulticlassRulesSchema(BaseModel):
    ability_score_minimum: dict[AbilityScoreEnum, int]
    proficiencies_gained: dict[str, list[str]]


class ClassSchema(CatalogBaseSchema):
    primary_abilities: list[AbilityScoreEnum]
    primary_ability_logic: str = "OR"
    hit_point_die: str
    hp_at_level_1: str
    hp_per_level_after_1st: str
    saving_throw_proficiencies: list[AbilityScoreEnum]
    skill_choices_count: int
    skill_options: list[str]
    weapon_proficiencies: list[str]
    tool_proficiencies: list[str] = Field(default_factory=list)
    armor_training: list[str]
    starting_equipment_options: list[dict[str, Any]]
    multiclassing: MulticlassRulesSchema
    spellcasting_ability: AbilityScoreEnum | None = None
    spellcasting_focus_type: str | None = None
    has_weapon_mastery: bool = False
    level_table: list[ClassLevelProgressionSchema]
    features: list[ClassFeatureSchema]
    subclass_unlock_level: int = 3
    subclass_feature_levels: list[int] = Field(default_factory=lambda: [3, 6, 10, 14])
    subclasses_summary: list[dict[str, str]] = Field(default_factory=list)


class ClassFeatureOptionSchema(CatalogBaseSchema):
    parent_class_slug: str
    parent_subclass_slug: str | None = None
    category: FeatureOptionCategoryEnum
    level_prerequisite: int = 1
    prerequisite_text: str | None = None
    cost_text: str | None = None
    description: str


# --- Magias (Spells) ---


class SpellComponentsSchema(BaseModel):
    verbal: bool = False
    somatic: bool = False
    material: bool = False
    material_description: str | None = None
    material_cost_gp: int | None = None
    material_consumed: bool = False


class SpellSchema(CatalogBaseSchema):
    level: int = Field(..., ge=0, le=9)
    school: SpellSchoolEnum
    class_lists: list[str]
    casting_time: str
    reaction_trigger: str | None = None
    ritual: bool = False
    range: str
    area_of_effect: dict[str, Any] | None = None
    components: SpellComponentsSchema
    duration: str
    concentration: bool = False
    saving_throw_ability: str | None = None
    attack_type: str | None = None
    damage_types: list[DamageTypeEnum] = Field(default_factory=list)
    conditions_inflicted: list[str] = Field(default_factory=list)
    description: str
    higher_levels: str | None = None
    tables: list[EmbeddedTableSchema] = Field(default_factory=list)


# --- Equipamentos, Armas, Maestrias, Armaduras, Ferramentas e Itens Mágicos ---


class WeaponMasterySchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    slug: str
    name: WeaponMasteryEnum
    trigger_condition: str
    effect_summary: str
    description: str
    compatible_weapons: list[str] = Field(default_factory=list)


class WeaponSchema(CatalogBaseSchema):
    category: str
    range_type: str
    damage_dice: str
    damage_type: DamageTypeEnum
    properties: list[str] = Field(default_factory=list)
    range_normal_ft: int | None = None
    range_long_ft: int | None = None
    versatile_damage_dice: str | None = None
    ammunition_type: str | None = None
    mastery_slug: str
    mastery_name: WeaponMasteryEnum
    weight_lb: float = 0.0
    cost_display: str
    cost_cp: int


class ArmorSchema(CatalogBaseSchema):
    category: ArmorCategoryEnum
    base_ac: int
    ac_formula_display: str
    adds_dex_modifier: bool = True
    max_dex_modifier: int | None = 2
    strength_requirement: int | None = None
    stealth_disadvantage: bool = False
    don_time: str
    doff_time: str
    weight_lb: float = 0.0
    cost_display: str
    cost_cp: int


class ToolUtilizeActionSchema(BaseModel):
    action_description: str
    dc: int


class ToolSchema(CatalogBaseSchema):
    category: str
    ability: AbilityScoreEnum
    weight_lb: float = 0.0
    cost_display: str
    cost_cp: int
    utilize_actions: list[ToolUtilizeActionSchema] = Field(default_factory=list)
    craftable_items: list[str] = Field(default_factory=list)
    variants: list[dict[str, str]] = Field(default_factory=list)
    description: str


class AdventuringGearSchema(CatalogBaseSchema):
    category: str
    weight_lb: float = 0.0
    cost_display: str
    cost_cp: int
    action_type_required: str | None = None
    pack_contents: list[dict[str, Any]] = Field(default_factory=list)
    description: str


class MagicItemSchema(CatalogBaseSchema):
    item_category: str
    rarity: MagicItemRarityEnum
    requires_attunement: bool = False
    attunement_requirement: str | None = None
    base_weapon_or_armor_slug: str | None = None
    bonus_value: int | None = None
    charges_max: int | None = None
    recharge_formula: str | None = None
    crafting_time_days: int | None = None
    crafting_cost_gp: int | None = None
    description: str


# --- Monstros e Glossário de Regras ---


class MonsterAbilityEntrySchema(BaseModel):
    score: int
    modifier: int
    saving_throw: int


class MonsterTraitOrActionSchema(BaseModel):
    name: str
    recharge: str | None = None
    action_type: str
    attack_roll_type: str | None = None
    attack_bonus: int | None = None
    reach_or_range: str | None = None
    saving_throw_dc: int | None = None
    saving_throw_ability: AbilityScoreEnum | None = None
    hit_or_fail_effect: str | None = None
    description: str


class MonsterSchema(CatalogBaseSchema):
    size: list[SizeEnum]
    creature_type: str
    alignment: str
    armor_class: int
    armor_notes: str | None = None
    initiative_bonus: int
    initiative_passive: int
    hit_points: int
    hit_dice_formula: str
    speeds: dict[str, str]
    abilities: dict[AbilityScoreEnum, MonsterAbilityEntrySchema]
    skills: dict[str, int] = Field(default_factory=dict)
    gear: list[str] = Field(default_factory=list)
    damage_vulnerabilities: list[str] = Field(default_factory=list)
    damage_resistances: list[str] = Field(default_factory=list)
    damage_immunities: list[str] = Field(default_factory=list)
    condition_immunities: list[str] = Field(default_factory=list)
    senses: dict[str, Any]
    languages: list[str] = Field(default_factory=list)
    challenge_rating: str
    cr_numeric: float
    xp: int
    xp_in_lair: int | None = None
    proficiency_bonus: int
    habitat: list[str] = Field(default_factory=list)
    treasure_theme: str | None = None
    traits: list[MonsterTraitOrActionSchema] = Field(default_factory=list)
    actions: list[MonsterTraitOrActionSchema] = Field(default_factory=list)
    bonus_actions: list[MonsterTraitOrActionSchema] = Field(default_factory=list)
    reactions: list[MonsterTraitOrActionSchema] = Field(default_factory=list)
    legendary_actions_uses: int | None = None
    legendary_actions_in_lair: int | None = None
    legendary_actions: list[MonsterTraitOrActionSchema] = Field(default_factory=list)



class RuleGlossarySchema(CatalogBaseSchema):
    tag: RuleGlossaryTagEnum = RuleGlossaryTagEnum.GENERAL_RULE
    summary: str
    bullet_effects: list[str] = Field(default_factory=list)
    description: str
    see_also_slugs: list[str] = Field(default_factory=list)


class OmniSearchResultItemSchema(BaseModel):
    entity_type: str
    slug: str
    name: str
    summary: str
    api_path: str
    source_book: str


class OmniSearchResponseSchema(BaseModel):
    query: str
    total_matches: int
    results_by_type: dict[str, list[OmniSearchResultItemSchema]]