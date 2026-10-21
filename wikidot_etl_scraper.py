"""
Pipeline ETL, Crawler Assíncrono, Parsers BeautifulSoup4 para o Wikidot D&D 5e 2024
e Seed Inicial Completo do Catálogo SRD 5.2.1.
"""

from __future__ import annotations

import asyncio
import hashlib
import re
from pathlib import Path
from typing import Any

import httpx
from bs4 import BeautifulSoup, Tag
from sqlalchemy import select
from sqlalchemy.orm import Session

from schemas_and_models import (
    AbilityScoreEnum,
    AdventuringGearModel,
    ArmorCategoryEnum,
    ArmorModel,
    BackgroundEquipmentOptionSchema,
    BackgroundModel,
    BackgroundSchema,
    BastionFacilityModel,
    ClassFeatureOptionModel,
    ClassLevelProgressionSchema,
    ClassModel,
    DamageTypeEnum,
    EmbeddedTableSchema,
    EntityReferenceSchema,
    EquipmentItemQuantitySchema,
    FeatBenefitSchema,
    FeatCategoryEnum,
    FeatModel,
    FeatSchema,
    MagicItemModel,
    MonsterModel,
    RuleGlossaryModel,
    SpeciesModel,
    SpellComponentsSchema,
    SpellModel,
    SpellSchema,
    SpellSchoolEnum,
    SpellcastingProgressionRowSchema,
    SubclassModel,
    ToolModel,
    WeaponMasteryEnum,
    WeaponMasteryModel,
    WeaponModel,
    WeaponSchema,
)

# =====================================================================
# 1. EXPRESSÕES REGULARES E UTILITÁRIOS DE NORMALIZAÇÃO
# =====================================================================

LEVEL_SCHOOL_RE = re.compile(
    r"^(?:Level\s+(?P<level>\d+)\s+(?P<school>[A-Za-z]+)|(?P<cantrip_school>[A-Za-z]+)\s+Cantrip)\s*(?:\((?P<classes>[^)]+)\))?",
    re.IGNORECASE,
)
COST_GP_RE = re.compile(r"worth\s+(?:at\s+least\s+)?([\d,]+)\+?\s*GP", re.IGNORECASE)
AREA_RE = re.compile(
    r"(?P<size>\d+)-foot(?:-radius)?\s+(?P<shape>Cone|Cube|Cylinder|Emanation|Line|Sphere)",
    re.IGNORECASE,
)
SAVING_THROW_RE = re.compile(
    r"(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)\s+saving\s+throw",
    re.IGNORECASE,
)
DAMAGE_TYPE_NAMES = [dt.value for dt in DamageTypeEnum]
DAMAGE_RE = re.compile(
    r"\b(" + "|".join(DAMAGE_TYPE_NAMES) + r")\s+damage\b",
    re.IGNORECASE,
)
LEVEL_INT_RE = re.compile(r"(\d+)")

ABILITY_MAP = {
    "strength": AbilityScoreEnum.STR,
    "str": AbilityScoreEnum.STR,
    "dexterity": AbilityScoreEnum.DEX,
    "dex": AbilityScoreEnum.DEX,
    "constitution": AbilityScoreEnum.CON,
    "con": AbilityScoreEnum.CON,
    "intelligence": AbilityScoreEnum.INT,
    "int": AbilityScoreEnum.INT,
    "wisdom": AbilityScoreEnum.WIS,
    "wis": AbilityScoreEnum.WIS,
    "charisma": AbilityScoreEnum.CHA,
    "cha": AbilityScoreEnum.CHA,
}


def slugify(value: str) -> str:
    clean = re.sub(r"[^a-z0-9]+", "-", value.lower().strip())
    return clean.strip("-")


def normalize_text(text: str) -> str:
    return (
        text.replace("\u2013", "-")
        .replace("\u2014", "-")
        .replace("\u2212", "-")
        .replace("\u2019", "'")
        .replace("\u201c", '"')
        .replace("\u201d", '"')
        .strip()
    )


def split_lines_on_br(tag: Tag) -> list[str]:
    """
    Divide o texto de um bloco em linhas lógicas apenas nas quebras <br>, mantendo
    rótulos em negrito (ex.: <strong>Range:</strong>) na mesma linha do seu valor.
    """
    lines: list[str] = []
    buffer: list[str] = []
    for node in tag.descendants:
        if isinstance(node, Tag):
            if node.name == "br":
                lines.append(normalize_text(re.sub(r"\s+", " ", "".join(buffer))))
                buffer = []
        else:
            buffer.append(str(node))
    lines.append(normalize_text(re.sub(r"\s+", " ", "".join(buffer))))
    return [line for line in lines if line]


def parse_cost_to_cp(cost_str: str) -> int:
    text = cost_str.upper().replace(",", "").strip()
    match = re.search(r"(\d+)\s*(CP|SP|EP|GP|PP)", text)
    if not match:
        return 0
    amount = int(match.group(1))
    unit = match.group(2)
    multipliers = {"CP": 1, "SP": 10, "EP": 50, "GP": 100, "PP": 1000}
    return amount * multipliers.get(unit, 100)


# =====================================================================
# 2. CRAWLER ASSÍNCRONO WIKIDOT COM CACHE LOCAL E HASH SHA-256
# =====================================================================


class WikidotCrawler:
    """
    Cliente assíncrono para baixar e armazenar em cache páginas do Wikidot
    (ex.: http://dnd2024.wikidot.com ou https://onednd.wikidot.com).
    """

    def __init__(
        self,
        base_url: str = "http://dnd2024.wikidot.com",
        cache_dir: str | Path = "data/raw_html",
        max_concurrency: int = 2,
        delay_seconds: float = 1.2,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.cache_dir = Path(cache_dir)
        self.semaphore = asyncio.Semaphore(max_concurrency)
        self.delay_seconds = delay_seconds
        self.cache_dir.mkdir(parents=True, exist_ok=True)

    def _get_cache_file(self, category: str, slug: str) -> Path:
        cat_path = self.cache_dir / category
        cat_path.mkdir(parents=True, exist_ok=True)
        safe_slug = slug.replace(":", "__").replace("/", "_")
        return cat_path / f"{safe_slug}.html"

    async def fetch_page(
        self,
        client: httpx.AsyncClient,
        category: str,
        page_path: str,
        force_refresh: bool = False,
    ) -> tuple[str, str]:
        slug = page_path.lstrip("/").split(":")[-1]
        cache_file = self._get_cache_file(category, slug)
        url = f"{self.base_url}/{page_path.lstrip('/')}"

        if cache_file.exists() and not force_refresh:
            html = cache_file.read_text(encoding="utf-8")
            return html, hashlib.sha256(html.encode("utf-8")).hexdigest()

        async with self.semaphore:
            response = await client.get(url, follow_redirects=True, timeout=20.0)
            response.raise_for_status()
            html = response.text
            cache_file.write_text(html, encoding="utf-8")
            await asyncio.sleep(self.delay_seconds)
            return html, hashlib.sha256(html.encode("utf-8")).hexdigest()


# =====================================================================
# 3. PARSERS HTML BEAUTIFULSOUP4 PARA PÁGINAS DO WIKIDOT
# =====================================================================


def extract_internal_references(container: Tag) -> list[EntityReferenceSchema]:
    refs: dict[str, EntityReferenceSchema] = {}
    route_map = {
        "spell": ("spell", "/api/v1/spells"),
        "feat": ("feat", "/api/v1/feats"),
        "background": ("background", "/api/v1/backgrounds"),
        "species": ("species", "/api/v1/species"),
        "lineage": ("species", "/api/v1/species"),
        "condition": ("condition", "/api/v1/rules"),
        "rule": ("rule", "/api/v1/rules"),
        "weapon-mastery": ("weapon-mastery", "/api/v1/equipment/weapon-masteries"),
    }
    for a_tag in container.find_all("a", href=True):
        href = str(a_tag["href"]).strip("/")
        if ":" in href and not href.startswith("http"):
            prefix, target_slug = href.split(":", 1)
            prefix_lower = prefix.lower()
            target_slug = slugify(target_slug)
            if prefix_lower in route_map and target_slug not in refs:
                ent_type, base_route = route_map[prefix_lower]
                refs[target_slug] = EntityReferenceSchema(
                    entity_type=ent_type,
                    slug=target_slug,
                    name=normalize_text(a_tag.get_text(" ", strip=True)),
                    api_path=f"{base_route}/{target_slug}",
                )
    return list(refs.values())


def parse_html_table(table_tag: Tag) -> EmbeddedTableSchema:
    headers = [normalize_text(th.get_text(" ", strip=True)) for th in table_tag.select("tr th")]
    rows: list[list[str]] = []
    for tr in table_tag.select("tr"):
        tds = tr.find_all("td")
        if tds:
            rows.append([normalize_text(td.get_text(" ", strip=True)) for td in tds])
    return EmbeddedTableSchema(headers=headers, rows=rows)


def extract_wikidot_spell_index_links(index_html: str) -> list[dict[str, Any]]:
    """
    Extrai os links da listagem de magias do Wikidot ('/spells'),
    iterando pelas abas YUI (#wiki-tab-0-0 = Cantrip até #wiki-tab-0-9 = 9th Level).
    """
    soup = BeautifulSoup(index_html, "lxml")
    results: list[dict[str, Any]] = []
    navset = soup.select_one("div.yui-navset")
    if not navset:
        return results

    tab_divs = navset.select("div.yui-content > div")
    for level_idx, tab_div in enumerate(tab_divs):
        for tr in tab_div.select("table.wiki-content-table tr"):
            tds = tr.find_all("td")
            if not tds:
                continue
            a_tag = tds[0].find("a", href=True)
            if not a_tag:
                continue
            href = str(a_tag["href"])
            slug = slugify(href.split(":")[-1])
            results.append(
                {
                    "slug": slug,
                    "name": normalize_text(a_tag.get_text(strip=True)),
                    "href": href,
                    "level": level_idx,
                }
            )
    return results


def parse_wikidot_spell_detail(html: str, slug: str, source_url: str) -> SpellSchema:
    """
    Converte o HTML de uma página '/spell:<slug>' do Wikidot em um SpellSchema validado.
    """
    soup = BeautifulSoup(html, "lxml")
    title_el = soup.select_one("#page-title")
    content_el = soup.select_one("#page-content")

    if not title_el or not content_el:
        raise ValueError(f"Estrutura Wikidot inválida para a magia '{slug}'")

    name = normalize_text(title_el.get_text(strip=True))
    source_book = "Player's Handbook (2024)"
    level = 0
    school = SpellSchoolEnum.EVOCATION
    class_lists: list[str] = []
    casting_time = "Action"
    reaction_trigger: str | None = None
    ritual = False
    spell_range = "Self"
    area_of_effect: dict[str, Any] | None = None
    components = SpellComponentsSchema()
    duration = "Instantaneous"
    concentration = False
    description_parts: list[str] = []
    higher_levels: str | None = None
    embedded_tables: list[EmbeddedTableSchema] = []

    for child in content_el.children:
        if not isinstance(child, Tag):
            continue

        if child.name == "table" and "wiki-content-table" in (child.get("class") or []):
            embedded_tables.append(parse_html_table(child))
            continue

        if child.name in ("p", "ul", "ol", "blockquote"):
            text = normalize_text(child.get_text(" ", strip=True))
            if not text:
                continue

            if text.startswith("Source:"):
                source_book = text.replace("Source:", "").strip()
                continue

            match = LEVEL_SCHOOL_RE.search(text)
            if match and child.name == "p":
                if match.group("cantrip_school"):
                    level = 0
                    school = SpellSchoolEnum(match.group("cantrip_school").capitalize())
                else:
                    level = int(match.group("level"))
                    school = SpellSchoolEnum(match.group("school").capitalize())
                if match.group("classes"):
                    class_lists = [slugify(c) for c in match.group("classes").split(",")]
                continue

            if "Casting Time:" in text and "Range:" in text:
                for line in split_lines_on_br(child):
                    if line.startswith("Casting Time:"):
                        raw_ct = line.replace("Casting Time:", "").strip()
                        ritual = "ritual" in raw_ct.lower()
                        cleaned_ct = re.sub(r"\s*or\s+Ritual", "", raw_ct, flags=re.IGNORECASE).strip()
                        if "," in cleaned_ct and cleaned_ct.lower().startswith("reaction"):
                            parts = cleaned_ct.split(",", 1)
                            casting_time = parts[0].strip()
                            reaction_trigger = parts[1].strip()
                        else:
                            casting_time = cleaned_ct
                    elif line.startswith("Range:"):
                        spell_range = line.replace("Range:", "").strip()
                        area_match = AREA_RE.search(spell_range)
                        if area_match:
                            area_of_effect = {
                                "type": area_match.group("shape").capitalize(),
                                "size_ft": int(area_match.group("size")),
                            }
                    elif line.startswith("Components:"):
                        raw_comp = line.replace("Components:", "").strip()
                        flags_part = raw_comp.split("(")[0]
                        components.verbal = "V" in flags_part
                        components.somatic = "S" in flags_part
                        components.material = "M" in flags_part
                        mat_match = re.search(r"\((.+)\)", raw_comp)
                        if mat_match:
                            mat_desc = mat_match.group(1).strip()
                            components.material_description = mat_desc
                            components.material_consumed = "consume" in mat_desc.lower()
                            cost_match = COST_GP_RE.search(mat_desc)
                            if cost_match:
                                components.material_cost_gp = int(cost_match.group(1).replace(",", ""))
                    elif line.startswith("Duration:"):
                        duration = line.replace("Duration:", "").strip()
                        concentration = "concentration" in duration.lower()
                continue

            if text.startswith(("Using a Higher-Level Spell Slot.", "Cantrip Upgrade.")):
                higher_levels = text
            else:
                description_parts.append(text)

    full_description = "\n\n".join(description_parts)
    save_match = SAVING_THROW_RE.search(full_description)
    saving_throw_ability = ABILITY_MAP[save_match.group(1).lower()].value if save_match else None

    attack_type = None
    if "melee spell attack" in full_description.lower():
        attack_type = "Melee Spell Attack"
    elif "ranged spell attack" in full_description.lower() or "ranged attack roll" in full_description.lower():
        attack_type = "Ranged Spell Attack"

    found_damage_types: list[DamageTypeEnum] = []
    for dm in DAMAGE_RE.finditer(full_description):
        dt_enum = DamageTypeEnum(dm.group(1).capitalize())
        if dt_enum not in found_damage_types:
            found_damage_types.append(dt_enum)

    return SpellSchema(
        slug=slug,
        name=name,
        source_book=source_book,
        source_url=source_url,
        level=level,
        school=school,
        class_lists=class_lists,
        casting_time=casting_time,
        reaction_trigger=reaction_trigger,
        ritual=ritual,
        range=spell_range,
        area_of_effect=area_of_effect,
        components=components,
        duration=duration,
        concentration=concentration,
        saving_throw_ability=saving_throw_ability,
        attack_type=attack_type,
        damage_types=found_damage_types,
        description=full_description,
        higher_levels=higher_levels,
        tables=embedded_tables,
        referenced_entities=extract_internal_references(content_el),
    )


def parse_wikidot_class_progression_table(table_tag: Tag) -> list[ClassLevelProgressionSchema]:
    """
    Extrai as 20 linhas da tabela de progressão de nível de uma Classe no Wikidot,
    lidando com super-cabeçalhos 'colspan' de espaços de magia.
    """
    rows = table_tag.find_all("tr")
    if not rows:
        return []

    header_row_idx = 0
    for idx, tr in enumerate(rows):
        ths = [th.get_text(" ", strip=True).lower() for th in tr.find_all("th")]
        if any("level" in h for h in ths) and any("proficiency" in h for h in ths):
            header_row_idx = idx
            break

    headers = [normalize_text(th.get_text(" ", strip=True)) for th in rows[header_row_idx].find_all("th")]
    progression: list[ClassLevelProgressionSchema] = []

    for tr in rows[header_row_idx + 1 :]:
        cells = [normalize_text(td.get_text(" ", strip=True)) for td in tr.find_all("td")]
        if len(cells) < 3:
            continue

        row_map = dict(zip(headers, cells))
        lvl_match = LEVEL_INT_RE.search(row_map.get("Level", ""))
        if not lvl_match:
            continue

        level = int(lvl_match.group(1))
        pb_text = row_map.get("Proficiency Bonus", "+2").replace("+", "").strip()
        proficiency_bonus = int(pb_text) if pb_text.isdigit() else 2

        raw_features = row_map.get("Class Features", row_map.get("Features", ""))
        feature_names = [f.strip() for f in raw_features.split(",") if f.strip() and f.strip() not in ("-", "—")]
        feature_slugs = [slugify(f) for f in feature_names]

        weapon_masteries_known = 0
        if "Weapon Mastery" in row_map:
            wm_val = row_map["Weapon Mastery"].strip()
            weapon_masteries_known = int(wm_val) if wm_val.isdigit() else 0

        spell_slots: dict[str, int] = {}
        for slot_lvl in ("1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th"):
            if slot_lvl in row_map:
                val = row_map[slot_lvl].strip()
                spell_slots[slot_lvl[0]] = int(val) if val.isdigit() else 0

        spellcasting_obj = None
        if spell_slots or "Prepared Spells" in row_map or "Spell Slots" in row_map:
            cantrips = row_map.get("Cantrips")
            prep = row_map.get("Prepared Spells", "0")
            pact_slots = row_map.get("Spell Slots")
            pact_lvl = row_map.get("Slot Level")
            spellcasting_obj = SpellcastingProgressionRowSchema(
                cantrips_known=int(cantrips) if cantrips and cantrips.isdigit() else None,
                prepared_spells=int(prep) if prep.isdigit() else 0,
                slots_by_level=spell_slots,
                pact_slots_count=int(pact_slots) if pact_slots and pact_slots.isdigit() else None,
                pact_slot_level=int(LEVEL_INT_RE.search(pact_lvl).group(1))
                if pact_lvl and LEVEL_INT_RE.search(pact_lvl)
                else None,
            )

        ignored_cols = {
            "Level",
            "Proficiency Bonus",
            "Class Features",
            "Features",
            "Weapon Mastery",
            "Cantrips",
            "Prepared Spells",
            "Spell Slots",
            "Slot Level",
            "1st",
            "2nd",
            "3rd",
            "4th",
            "5th",
            "6th",
            "7th",
            "8th",
            "9th",
        }
        specific_cols: dict[str, int | str] = {}
        for col_name, col_val in row_map.items():
            if col_name not in ignored_cols:
                key = re.sub(r"[^a-z0-9]+", "_", col_name.lower()).strip("_")
                specific_cols[key] = int(col_val) if col_val.isdigit() else col_val

        progression.append(
            ClassLevelProgressionSchema(
                level=level,
                proficiency_bonus=proficiency_bonus,
                feature_names=feature_names,
                feature_slugs=feature_slugs,
                weapon_masteries_known=weapon_masteries_known,
                class_specific_columns=specific_cols,
                spellcasting=spellcasting_obj,
            )
        )

    return progression


def parse_wikidot_feat_detail(html: str, slug: str, source_url: str) -> FeatSchema:
    """
    Converte uma página '/feat:<slug>' do Wikidot em FeatSchema (Origin, General, Fighting Style, Epic Boon).
    """
    soup = BeautifulSoup(html, "lxml")
    title_el = soup.select_one("#page-title")
    content_el = soup.select_one("#page-content")
    if not title_el or not content_el:
        raise ValueError(f"Página de talento inválida: {slug}")

    name = normalize_text(title_el.get_text(strip=True))
    source_book = "Player's Handbook (2024)"
    category = FeatCategoryEnum.ORIGIN
    level_prereq = 1
    prereq_text: str | None = None
    asi_options: list[AbilityScoreEnum] = []
    repeatable = False
    repeatable_note: str | None = None
    benefits: list[FeatBenefitSchema] = []
    intro_parts: list[str] = []

    for p in content_el.find_all(["p", "ul"], recursive=False):
        text = normalize_text(p.get_text(" ", strip=True))
        if not text:
            continue
        if text.startswith("Source:"):
            source_book = text.replace("Source:", "").strip()
            continue

        if any(cat.value.lower() + " feat" in text.lower() for cat in FeatCategoryEnum):
            for cat in FeatCategoryEnum:
                if cat.value.lower() + " feat" in text.lower():
                    category = cat
                    break
            if category == FeatCategoryEnum.GENERAL:
                level_prereq = 4
            elif category == FeatCategoryEnum.EPIC_BOON:
                level_prereq = 19

            prereq_match = re.search(r"\(Prerequisite:\s*([^)]+)\)", text, re.IGNORECASE)
            if prereq_match:
                prereq_text = prereq_match.group(1).strip()
                lvl_m = re.search(r"Level\s+(\d+)\+?", prereq_text, re.IGNORECASE)
                if lvl_m:
                    level_prereq = int(lvl_m.group(1))
            continue

        strong = p.find("strong")
        if strong and p.name == "p":
            header_name = normalize_text(strong.get_text(strip=True)).rstrip(".")
            body_text = text[len(strong.get_text(strip=True)) :].lstrip(" .:")
            if header_name.lower() == "repeatable":
                repeatable = True
                repeatable_note = body_text
            else:
                if "ability score increase" in header_name.lower():
                    for ab_key, ab_enum in ABILITY_MAP.items():
                        if len(ab_key) > 3 and ab_key in body_text.lower() and ab_enum not in asi_options:
                            asi_options.append(ab_enum)
                benefits.append(FeatBenefitSchema(name=header_name, description=body_text))
        else:
            intro_parts.append(text)

    return FeatSchema(
        slug=slug,
        name=name,
        source_book=source_book,
        source_url=source_url,
        category=category,
        level_prerequisite=level_prereq,
        prerequisite_text=prereq_text,
        ability_score_increase_options=asi_options,
        repeatable=repeatable,
        repeatable_note=repeatable_note,
        benefits=benefits,
        description="\n\n".join(intro_parts),
        referenced_entities=extract_internal_references(content_el),
    )


def parse_wikidot_background_detail(html: str, slug: str, source_url: str) -> BackgroundSchema:
    """
    Converte uma página '/background:<slug>' do Wikidot em BackgroundSchema (2024).
    """
    soup = BeautifulSoup(html, "lxml")
    title_el = soup.select_one("#page-title")
    content_el = soup.select_one("#page-content")
    if not title_el or not content_el:
        raise ValueError(f"Página de antecedente inválida: {slug}")

    name = normalize_text(title_el.get_text(strip=True))
    source_book = "Player's Handbook (2024)"
    abilities: list[AbilityScoreEnum] = []
    origin_feat_slug = "skilled"
    origin_feat_name = "Skilled"
    skills: list[str] = []
    tool_prof = ""
    equipment_options: list[BackgroundEquipmentOptionSchema] = []
    desc_parts: list[str] = []

    for p in content_el.find_all(["p", "ul"], recursive=False):
        text = normalize_text(p.get_text("\n", strip=True))
        if not text:
            continue
        if text.startswith("Source:"):
            source_book = text.replace("Source:", "").strip()
            continue

        if "Ability Scores:" in text or "Skill Proficiencies:" in text:
            for line in split_lines_on_br(p):
                if line.startswith("Ability Scores:"):
                    raw_abs = line.replace("Ability Scores:", "").strip()
                    for token in raw_abs.split(","):
                        t_clean = token.strip().lower()
                        if t_clean in ABILITY_MAP:
                            abilities.append(ABILITY_MAP[t_clean])
                elif line.startswith("Feat:"):
                    origin_feat_name = line.replace("Feat:", "").strip()
                    origin_feat_slug = slugify(origin_feat_name)
                elif line.startswith("Skill Proficiencies:"):
                    raw_sk = line.replace("Skill Proficiencies:", "").strip()
                    skills = [s.strip() for s in re.split(r",|\band\b", raw_sk) if s.strip()][:2]
                elif line.startswith("Tool Proficiency:"):
                    tool_prof = line.replace("Tool Proficiency:", "").strip()
                elif line.startswith("Equipment:"):
                    eq_text = line.replace("Equipment:", "").strip()
                    opt_a_match = re.search(r"\(A\)\s*(.+?)\s*or\s*\(B\)\s*(\d+)\s*GP", eq_text, re.IGNORECASE)
                    if opt_a_match:
                        raw_a = opt_a_match.group(1)
                        opt_b_gp = int(opt_a_match.group(2))
                        a_gold = 0
                        items_a: list[EquipmentItemQuantitySchema] = []
                        for part in raw_a.split(","):
                            part_clean = part.strip()
                            gp_m = re.match(r"^(\d+)\s*GP$", part_clean, re.IGNORECASE)
                            if gp_m:
                                a_gold = int(gp_m.group(1))
                            elif part_clean:
                                items_a.append(
                                    EquipmentItemQuantitySchema(
                                        item_slug=slugify(part_clean),
                                        item_name=part_clean,
                                        quantity=1,
                                    )
                                )
                        equipment_options = [
                            BackgroundEquipmentOptionSchema(option_label="A", items=items_a, gold_gp=a_gold),
                            BackgroundEquipmentOptionSchema(option_label="B", items=[], gold_gp=opt_b_gp),
                        ]
            continue

        desc_parts.append(text.replace("\n", " "))

    return BackgroundSchema(
        slug=slug,
        name=name,
        source_book=source_book,
        source_url=source_url,
        ability_scores=abilities[:3],
        origin_feat_slug=origin_feat_slug,
        origin_feat_name=origin_feat_name,
        skill_proficiencies=skills[:2],
        tool_proficiency=tool_prof,
        tool_slug=slugify(tool_prof),
        equipment_options=equipment_options,
        description="\n\n".join(desc_parts),
    )


# =====================================================================
# 4. SEED OFICIAL E COMPLETO DO CATÁLOGO D&D 5E 2024 (SRD 5.2.1)
# =====================================================================


def seed_database_with_2024_catalog(session: Session) -> dict[str, int]:
    """
    Popula o banco de dados de forma idempotente com um conjunto completo e representativo
    do Catálogo D&D 5e 2024 (SRD 5.2.1 e estrutura Wikidot) cobrindo todas as 15 entidades.
    """
    existing_mastery = session.execute(select(WeaponMasteryModel)).first()
    if existing_mastery:
        return {"status": 0}

    # 1. Weapon Masteries (Todas as 8 propriedades oficiais de 2024)
    masteries = [
        WeaponMasteryModel(
            slug="cleave",
            name="Cleave",
            trigger_condition="On a melee hit against a creature",
            effect_summary="Make one extra melee attack against a second creature within 5 ft. and within reach (no ability modifier to damage unless negative).",
            description="If you hit a creature with a melee attack roll using this weapon, you can make a melee attack roll with the weapon against a second creature within 5 feet of the first that is also within your reach. On a hit, the second creature takes the weapon's damage, but don't add your ability modifier to that damage unless that modifier is negative. You can make this extra attack only once per turn.",
            compatible_weapons=["greataxe", "halberd"],
        ),
        WeaponMasteryModel(
            slug="graze",
            name="Graze",
            trigger_condition="When an attack roll with this weapon misses a creature",
            effect_summary="Deal damage equal to the ability modifier used to make the attack roll.",
            description="If your attack roll with this weapon misses a creature, you can deal damage to that creature equal to the ability modifier you used to make the attack roll. This damage is the same type dealt by the weapon, and the damage can be increased only by increasing the ability modifier.",
            compatible_weapons=["glaive", "greatsword"],
        ),
        WeaponMasteryModel(
            slug="nick",
            name="Nick",
            trigger_condition="When making the extra attack of the Light property",
            effect_summary="Make the extra attack of the Light property as part of the Attack action instead of as a Bonus Action (once per turn).",
            description="When you make the extra attack of the Light property, you can make it as part of the Attack action instead of as a Bonus Action. You can make this extra attack only once per turn.",
            compatible_weapons=["dagger", "light-hammer", "sickle", "scimitar"],
        ),
        WeaponMasteryModel(
            slug="push",
            name="Push",
            trigger_condition="On a hit against a Large or smaller creature",
            effect_summary="Push the creature up to 10 feet straight away from you.",
            description="If you hit a creature with this weapon, you can push the creature up to 10 feet straight away from you if it is Large or smaller.",
            compatible_weapons=["greatclub", "pike", "warhammer", "heavy-crossbow"],
        ),
        WeaponMasteryModel(
            slug="sap",
            name="Sap",
            trigger_condition="On a hit against a creature",
            effect_summary="Target has Disadvantage on its next attack roll before the start of your next turn.",
            description="If you hit a creature with this weapon, that creature has Disadvantage on its next attack roll before the start of your next turn.",
            compatible_weapons=["mace", "spear", "flail", "longsword", "morningstar", "war-pick"],
        ),
        WeaponMasteryModel(
            slug="slow",
            name="Slow",
            trigger_condition="On a hit that deals damage to a creature",
            effect_summary="Reduce the creature's Speed by 10 feet until the start of your next turn.",
            description="If you hit a creature with this weapon and deal damage to it, you can reduce its Speed by 10 feet until the start of your next turn. If the creature is hit more than once by weapons that have this property, the Speed reduction doesn't exceed 10 feet.",
            compatible_weapons=["club", "javelin", "light-crossbow", "sling", "whip", "longbow", "musket"],
        ),
        WeaponMasteryModel(
            slug="topple",
            name="Topple",
            trigger_condition="On a hit against a creature",
            effect_summary="Force a Constitution saving throw (DC 8 + PB + attack ability mod) or knock the target Prone.",
            description="If you hit a creature with this weapon, you can force the creature to make a Constitution saving throw (DC 8 plus the ability modifier used to make the attack roll and your Proficiency Bonus). On a failed save, the creature has the Prone condition.",
            compatible_weapons=["quarterstaff", "battleaxe", "lance", "maul", "trident"],
        ),
        WeaponMasteryModel(
            slug="vex",
            name="Vex",
            trigger_condition="On a hit that deals damage to a creature",
            effect_summary="Gain Advantage on your next attack roll against that creature before the end of your next turn.",
            description="If you hit a creature with this weapon and deal damage to the creature, you have Advantage on your next attack roll against that creature before the end of your next turn.",
            compatible_weapons=["handaxe", "dart", "shortbow", "rapier", "shortsword", "blowgun", "hand-crossbow", "pistol"],
        ),
    ]
    session.add_all(masteries)
    session.flush()

    # 2. Feats (Origin, General, Fighting Style, Epic Boon)
    feats = [
        FeatModel(
            slug="alert",
            name="Alert",
            source_url="http://dnd2024.wikidot.com/feat:alert",
            category=FeatCategoryEnum.ORIGIN.value,
            level_prerequisite=1,
            prerequisite_text=None,
            ability_score_increase_options=[],
            repeatable=False,
            benefits=[
                {
                    "name": "Initiative Proficiency",
                    "description": "When you roll Initiative, you can add your Proficiency Bonus to the roll.",
                },
                {
                    "name": "Initiative Swap",
                    "description": "Immediately after you roll Initiative, you can swap your Initiative with the Initiative of one willing ally in the same combat. You can't make this swap if you or the ally has the Incapacitated condition.",
                },
            ],
            description="Always on the lookout for danger, you gain the following benefits.",
        ),
        FeatModel(
            slug="magic-initiate-cleric",
            name="Magic Initiate (Cleric)",
            source_url="http://dnd2024.wikidot.com/feat:magic-initiate",
            category=FeatCategoryEnum.ORIGIN.value,
            level_prerequisite=1,
            prerequisite_text=None,
            ability_score_increase_options=[],
            repeatable=True,
            repeatable_note="You can take this feat more than once, but you must choose a different spell list each time.",
            benefits=[
                {
                    "name": "Two Cantrips",
                    "description": "You learn two cantrips of your choice from the Cleric spell list. Intelligence, Wisdom, or Charisma is your spellcasting ability for this feat's spells.",
                },
                {
                    "name": "Level 1 Spell",
                    "description": "Choose a level 1 spell from the Cleric spell list. You always have that spell prepared. You can cast it once without a spell slot, and you regain the ability to cast it in that way when you finish a Long Rest.",
                },
                {
                    "name": "Spell Change",
                    "description": "Whenever you gain a new level, you can replace one of the spells you chose for this feat with a different spell of the same level from the chosen spell list.",
                },
            ],
            description="You learn foundational divine magic from the Cleric spell list.",
        ),
        FeatModel(
            slug="magic-initiate-wizard",
            name="Magic Initiate (Wizard)",
            source_url="http://dnd2024.wikidot.com/feat:magic-initiate",
            category=FeatCategoryEnum.ORIGIN.value,
            level_prerequisite=1,
            prerequisite_text=None,
            ability_score_increase_options=[],
            repeatable=True,
            repeatable_note="You can take this feat more than once, but you must choose a different spell list each time.",
            benefits=[
                {
                    "name": "Two Cantrips",
                    "description": "You learn two cantrips of your choice from the Wizard spell list.",
                },
                {
                    "name": "Level 1 Spell",
                    "description": "Choose a level 1 spell from the Wizard spell list. You always have that spell prepared and can cast it once without a spell slot per Long Rest.",
                },
            ],
            description="You learn foundational arcane magic from the Wizard spell list.",
        ),
        FeatModel(
            slug="savage-attacker",
            name="Savage Attacker",
            source_url="http://dnd2024.wikidot.com/feat:savage-attacker",
            category=FeatCategoryEnum.ORIGIN.value,
            level_prerequisite=1,
            prerequisite_text=None,
            ability_score_increase_options=[],
            repeatable=False,
            benefits=[
                {
                    "name": "Reroll Weapon Damage",
                    "description": "You've trained to deal particularly damaging strikes. Once per turn when you hit a target with a weapon, you can roll the weapon's damage dice twice and use either roll against the target.",
                }
            ],
            description="You've trained to deal particularly damaging strikes.",
        ),
        FeatModel(
            slug="grappler",
            name="Grappler",
            source_url="http://dnd2024.wikidot.com/feat:grappler",
            category=FeatCategoryEnum.GENERAL.value,
            level_prerequisite=4,
            prerequisite_text="Level 4+, Strength or Dexterity 13+",
            ability_score_increase_options=["STR", "DEX"],
            repeatable=False,
            benefits=[
                {
                    "name": "Ability Score Increase",
                    "description": "Increase your Strength or Dexterity score by 1, to a maximum of 20.",
                },
                {
                    "name": "Punch and Grab",
                    "description": "When you hit a creature with an Unarmed Strike as part of the Attack action on your turn, you can use both the Damage and the Grapple option. You can use this benefit only once per turn.",
                },
                {
                    "name": "Attack Advantage",
                    "description": "You have Advantage on attack rolls against a creature Grappled by you.",
                },
                {
                    "name": "Fast Wrestler",
                    "description": "You don't have to spend extra movement to move a creature Grappled by you if the creature is your size or smaller.",
                },
            ],
            description="You excel at close-quarters grappling combat.",
        ),
        FeatModel(
            slug="boon-of-combat-prowess",
            name="Boon of Combat Prowess",
            source_url="http://dnd2024.wikidot.com/feat:boon-of-combat-prowess",
            category=FeatCategoryEnum.EPIC_BOON.value,
            level_prerequisite=19,
            prerequisite_text="Level 19+",
            ability_score_increase_options=["STR", "DEX", "CON", "INT", "WIS", "CHA"],
            repeatable=False,
            benefits=[
                {
                    "name": "Ability Score Increase",
                    "description": "Increase one ability score of your choice by 1, to a maximum of 30.",
                },
                {
                    "name": "Peerless Aim",
                    "description": "When you miss with an attack roll, you can hit instead. Once you use this benefit, you can't use it again until the start of your next turn.",
                },
            ],
            description="You gain peerless martial precision at epic tiers of play.",
        ),
    ]
    session.add_all(feats)
    session.flush()

    # 3. Backgrounds (2024 Rules)
    backgrounds = [
        BackgroundModel(
            slug="acolyte",
            name="Acolyte",
            source_url="http://dnd2024.wikidot.com/background:acolyte",
            ability_scores=["INT", "WIS", "CHA"],
            origin_feat_slug="magic-initiate-cleric",
            origin_feat_name="Magic Initiate (Cleric)",
            skill_proficiencies=["Insight", "Religion"],
            tool_proficiency="Calligrapher's Supplies",
            tool_slug="calligraphers-supplies",
            equipment_options=[
                {
                    "option_label": "A",
                    "items": [
                        {"item_slug": "calligraphers-supplies", "item_name": "Calligrapher's Supplies", "quantity": 1},
                        {"item_slug": "book-prayers", "item_name": "Book (prayers)", "quantity": 1},
                        {"item_slug": "holy-symbol", "item_name": "Holy Symbol", "quantity": 1},
                        {"item_slug": "parchment", "item_name": "Parchment", "quantity": 10},
                        {"item_slug": "robe", "item_name": "Robe", "quantity": 1},
                    ],
                    "gold_gp": 8,
                },
                {"option_label": "B", "items": [], "gold_gp": 50},
            ],
            description="You devoted yourself to service in a temple, either nestled in a town or secluded in a sacred grove.",
        ),
        BackgroundModel(
            slug="criminal",
            name="Criminal",
            source_url="http://dnd2024.wikidot.com/background:criminal",
            ability_scores=["DEX", "CON", "INT"],
            origin_feat_slug="alert",
            origin_feat_name="Alert",
            skill_proficiencies=["Sleight of Hand", "Stealth"],
            tool_proficiency="Thieves' Tools",
            tool_slug="thieves-tools",
            equipment_options=[
                {
                    "option_label": "A",
                    "items": [
                        {"item_slug": "dagger", "item_name": "Dagger", "quantity": 2},
                        {"item_slug": "thieves-tools", "item_name": "Thieves' Tools", "quantity": 1},
                        {"item_slug": "crowbar", "item_name": "Crowbar", "quantity": 1},
                        {"item_slug": "pouch", "item_name": "Pouch", "quantity": 2},
                        {"item_slug": "travelers-clothes", "item_name": "Traveler's Clothes", "quantity": 1},
                    ],
                    "gold_gp": 16,
                },
                {"option_label": "B", "items": [], "gold_gp": 50},
            ],
            description="You eked out a living in dark alleyways, cutting purses or breaking into shops.",
        ),
        BackgroundModel(
            slug="sage",
            name="Sage",
            source_url="http://dnd2024.wikidot.com/background:sage",
            ability_scores=["CON", "INT", "WIS"],
            origin_feat_slug="magic-initiate-wizard",
            origin_feat_name="Magic Initiate (Wizard)",
            skill_proficiencies=["Arcana", "History"],
            tool_proficiency="Calligrapher's Supplies",
            tool_slug="calligraphers-supplies",
            equipment_options=[
                {
                    "option_label": "A",
                    "items": [
                        {"item_slug": "quarterstaff", "item_name": "Quarterstaff", "quantity": 1},
                        {"item_slug": "calligraphers-supplies", "item_name": "Calligrapher's Supplies", "quantity": 1},
                        {"item_slug": "book-history", "item_name": "Book (history)", "quantity": 1},
                        {"item_slug": "parchment", "item_name": "Parchment", "quantity": 8},
                        {"item_slug": "robe", "item_name": "Robe", "quantity": 1},
                    ],
                    "gold_gp": 8,
                },
                {"option_label": "B", "items": [], "gold_gp": 50},
            ],
            description="You spent your formative years traveling between manors and monasteries, studying the multiverse.",
        ),
        BackgroundModel(
            slug="soldier",
            name="Soldier",
            source_url="http://dnd2024.wikidot.com/background:soldier",
            ability_scores=["STR", "DEX", "CON"],
            origin_feat_slug="savage-attacker",
            origin_feat_name="Savage Attacker",
            skill_proficiencies=["Athletics", "Intimidation"],
            tool_proficiency="Gaming Set (one of your choice)",
            tool_slug="gaming-set",
            equipment_options=[
                {
                    "option_label": "A",
                    "items": [
                        {"item_slug": "spear", "item_name": "Spear", "quantity": 1},
                        {"item_slug": "shortbow", "item_name": "Shortbow", "quantity": 1},
                        {"item_slug": "arrows", "item_name": "Arrows", "quantity": 20},
                        {"item_slug": "healers-kit", "item_name": "Healer's Kit", "quantity": 1},
                        {"item_slug": "quiver", "item_name": "Quiver", "quantity": 1},
                    ],
                    "gold_gp": 14,
                },
                {"option_label": "B", "items": [], "gold_gp": 50},
            ],
            description="You began training for war as soon as you reached adulthood.",
        ),
    ]
    session.add_all(backgrounds)

    # 4. Species (2024 Rules)
    species_list = [
        SpeciesModel(
            slug="elf",
            name="Elf",
            source_url="http://dnd2024.wikidot.com/species:elf",
            creature_type="Humanoid",
            sizes=["Medium"],
            size_description="Medium (about 5-6 feet tall)",
            speed_ft=30,
            darkvision_ft=60,
            traits=[
                {"slug": "darkvision", "name": "Darkvision", "description": "You have Darkvision with a range of 60 feet."},
                {
                    "slug": "elven-lineage",
                    "name": "Elven Lineage",
                    "description": "Choose a lineage from the Elven Lineages table (Drow, High Elf, or Wood Elf) to gain level 1, 3, and 5 benefits.",
                },
                {
                    "slug": "fey-ancestry",
                    "name": "Fey Ancestry",
                    "description": "You have Advantage on saving throws you make to avoid or end the Charmed condition.",
                },
                {
                    "slug": "keen-senses",
                    "name": "Keen Senses",
                    "description": "You have proficiency in the Insight, Perception, or Survival skill.",
                },
                {
                    "slug": "trance",
                    "name": "Trance",
                    "description": "You can finish a Long Rest in 4 hours if you spend those hours in a trancelike meditation.",
                },
            ],
            lineage_table_title="Elven Lineages",
            lineages=[
                {
                    "slug": "drow",
                    "name": "Drow",
                    "description": "The range of your Darkvision increases to 120 feet.",
                    "benefits_by_level": [
                        {"character_level": 1, "description": "Darkvision 120 ft. and Dancing Lights cantrip.", "granted_spells": ["dancing-lights"]},
                        {"character_level": 3, "description": "You learn the Faerie Fire spell.", "granted_spells": ["faerie-fire"]},
                        {"character_level": 5, "description": "You learn the Darkness spell.", "granted_spells": ["darkness"]},
                    ],
                },
                {
                    "slug": "high-elf",
                    "name": "High Elf",
                    "description": "You know the Prestidigitation cantrip (can swap on Long Rest).",
                    "benefits_by_level": [
                        {"character_level": 1, "description": "Prestidigitation cantrip.", "granted_spells": ["prestidigitation"]},
                        {"character_level": 3, "description": "You learn the Detect Magic spell.", "granted_spells": ["detect-magic"]},
                        {"character_level": 5, "description": "You learn the Misty Step spell.", "granted_spells": ["misty-step"]},
                    ],
                },
                {
                    "slug": "wood-elf",
                    "name": "Wood Elf",
                    "description": "Your Speed increases to 35 feet.",
                    "benefits_by_level": [
                        {"character_level": 1, "description": "Speed 35 ft. and Druidcraft cantrip.", "granted_spells": ["druidcraft"]},
                        {"character_level": 3, "description": "You learn the Longstrider spell.", "granted_spells": ["longstrider"]},
                        {"character_level": 5, "description": "You learn the Pass without Trace spell.", "granted_spells": ["pass-without-trace"]},
                    ],
                },
            ],
            description="Created by the god Corellon, the first elves could change their forms at will.",
        ),
        SpeciesModel(
            slug="human",
            name="Human",
            source_url="http://dnd2024.wikidot.com/species:human",
            creature_type="Humanoid",
            sizes=["Medium", "Small"],
            size_description="Medium (4-7 feet tall) or Small (2-4 feet tall), chosen when you select this species",
            speed_ft=30,
            darkvision_ft=None,
            traits=[
                {
                    "slug": "resourceful",
                    "name": "Resourceful",
                    "description": "You gain Heroic Inspiration whenever you finish a Long Rest.",
                },
                {
                    "slug": "skillful",
                    "name": "Skillful",
                    "description": "You gain proficiency in one skill of your choice.",
                },
                {
                    "slug": "versatile",
                    "name": "Versatile",
                    "description": "You gain an Origin feat of your choice.",
                },
            ],
            lineages=[],
            description="Found throughout the multiverse, humans are as varied as they are numerous.",
        ),
    ]
    session.add_all(species_list)

    # 5. Classes, Subclasses & Class Feature Options (2024 Rules)
    barbarian_levels = [
        {
            "level": lvl,
            "proficiency_bonus": 2 + (lvl - 1) // 4,
            "feature_names": ["Rage", "Unarmored Defense", "Weapon Mastery"] if lvl == 1 else (["Barbarian Subclass", "Primal Knowledge"] if lvl == 3 else [f"Level {lvl} Feature"]),
            "feature_slugs": ["rage", "unarmored-defense", "weapon-mastery"] if lvl == 1 else (["barbarian-subclass", "primal-knowledge"] if lvl == 3 else [f"level-{lvl}-feature"]),
            "weapon_masteries_known": 2 if lvl < 4 else (3 if lvl < 10 else 4),
            "class_specific_columns": {
                "rages": 2 if lvl < 3 else (3 if lvl < 6 else (4 if lvl < 12 else (5 if lvl < 17 else 6))),
                "rage_damage": "+2" if lvl < 9 else ("+3" if lvl < 16 else "+4"),
            },
            "spellcasting": None,
        }
        for lvl in range(1, 21)
    ]

    classes_list = [
        ClassModel(
            slug="barbarian",
            name="Barbarian",
            source_url="http://dnd2024.wikidot.com/barbarian",
            primary_abilities=["STR"],
            hit_point_die="d12",
            hp_at_level_1="12 + Con. modifier",
            hp_per_level_after_1st="1d12 (or 7) + Con. modifier",
            saving_throw_proficiencies=["STR", "CON"],
            skill_choices_count=2,
            skill_options=["Animal Handling", "Athletics", "Intimidation", "Nature", "Perception", "Survival"],
            weapon_proficiencies=["Simple weapons", "Martial weapons"],
            tool_proficiencies=[],
            armor_training=["Light armor", "Medium armor", "Shields"],
            starting_equipment_options=[
                {"option_label": "A", "items": ["Greataxe", "4 Handaxes", "Explorer's Pack"], "gold_gp": 15},
                {"option_label": "B", "items": [], "gold_gp": 75},
            ],
            multiclassing={"ability_score_minimum": {"STR": 13}, "proficiencies_gained": {"armor": ["Shields"], "weapons": ["Martial weapons"], "skills": []}},
            has_weapon_mastery=True,
            level_table=barbarian_levels,
            features=[
                {
                    "slug": "rage",
                    "name": "Rage",
                    "level": 1,
                    "is_subclass_feature": False,
                    "action_economy": "Bonus Action",
                    "uses_formula": "See Rages column of the Barbarian table (regain 1 expended use on Short Rest, all on Long Rest)",
                    "recharge": "Short Rest (+1) / Long Rest (All)",
                    "description": "You can imbue yourself with a primal power called Rage, granting Resistance to Bludgeoning, Piercing, and Slashing damage, Rage Damage bonus, and Advantage on Strength checks and saves. Lasts up to 10 minutes.",
                    "tables": [],
                },
                {
                    "slug": "weapon-mastery",
                    "name": "Weapon Mastery",
                    "level": 1,
                    "is_subclass_feature": False,
                    "action_economy": "Free",
                    "description": "Your training with weapons allows you to use the mastery properties of two kinds of Simple or Martial Melee weapons of your choice.",
                    "tables": [],
                },
                {
                    "slug": "brutal-strike",
                    "name": "Brutal Strike",
                    "level": 9,
                    "is_subclass_feature": False,
                    "action_economy": "Part of Attack",
                    "description": "If you use Reckless Attack, you can forgo any Advantage on one Strength-based attack roll on your turn to deal an extra 1d10 damage and apply one Brutal Strike effect (Forceful Blow or Hamstring Blow).",
                    "tables": [],
                },
            ],
            subclass_unlock_level=3,
            subclass_feature_levels=[3, 6, 10, 14],
            subclasses_summary=[{"slug": "path-of-the-berserker", "name": "Path of the Berserker"}],
        )
    ]
    session.add_all(classes_list)
    session.flush()

    subclasses_list = [
        SubclassModel(
            slug="path-of-the-berserker",
            name="Path of the Berserker",
            parent_class_slug="barbarian",
            parent_class_name="Barbarian",
            unlock_level=3,
            source_url="http://dnd2024.wikidot.com/barbarian:berserker",
            short_description="Barbarians who walk the Path of the Berserker direct their Rage primarily toward violence.",
            always_prepared_spells=[],
            features=[
                {
                    "slug": "frenzy",
                    "name": "Frenzy",
                    "level": 3,
                    "is_subclass_feature": True,
                    "description": "If you use Reckless Attack while your Rage is active, you deal extra damage to the first target you hit on your turn with a Strength-based attack equal to a number of d6s equal to your Rage Damage bonus (no Exhaustion penalty in 2024).",
                    "tables": [],
                },
                {
                    "slug": "mindless-rage",
                    "name": "Mindless Rage",
                    "level": 6,
                    "is_subclass_feature": True,
                    "description": "You have Immunity to the Charmed and Frightened conditions while your Rage is active.",
                    "tables": [],
                },
            ],
        )
    ]
    session.add_all(subclasses_list)

    feature_options = [
        ClassFeatureOptionModel(
            slug="brutal-strike-forceful-blow",
            name="Forceful Blow",
            parent_class_slug="barbarian",
            category="Brutal Strike",
            level_prerequisite=9,
            prerequisite_text="Level 9+ Barbarian, Reckless Attack",
            cost_text="Forgo Advantage on one attack roll",
            description="The target is pushed 15 feet straight away from you, and you can then move up to half your Speed straight toward the target without provoking Opportunity Attacks.",
        ),
        ClassFeatureOptionModel(
            slug="cunning-strike-trip",
            name="Trip (Cunning Strike)",
            parent_class_slug="rogue",
            category="Cunning Strike",
            level_prerequisite=5,
            prerequisite_text="Level 5+ Rogue, Sneak Attack",
            cost_text="1d6 Sneak Attack die",
            description="If the target is Large or smaller, it must succeed on a Dexterity saving throw or have the Prone condition.",
        ),
        ClassFeatureOptionModel(
            slug="agonizing-blast",
            name="Agonizing Blast",
            parent_class_slug="warlock",
            category="Eldritch Invocation",
            level_prerequisite=2,
            prerequisite_text="Level 2+ Warlock, a Warlock Cantrip that Deals Damage",
            cost_text="1 Eldritch Invocation known",
            description="Choose one of your known Warlock cantrips that deals damage. You can add your Charisma modifier to that spell's damage rolls.",
        ),
    ]
    session.add_all(feature_options)

    # 6. Spells (2024 Catalog)
    spells = [
        SpellModel(
            slug="sorcerous-burst",
            name="Sorcerous Burst",
            source_url="http://dnd2024.wikidot.com/spell:sorcerous-burst",
            level=0,
            school=SpellSchoolEnum.EVOCATION.value,
            class_lists=["sorcerer"],
            casting_time="Action",
            ritual=False,
            range="120 feet",
            area_of_effect=None,
            components={"verbal": True, "somatic": True, "material": False, "material_description": None, "material_cost_gp": None, "material_consumed": False},
            duration="Instantaneous",
            concentration=False,
            saving_throw_ability=None,
            attack_type="Ranged Spell Attack",
            damage_types=["Acid", "Cold", "Fire", "Lightning", "Poison", "Psychic", "Thunder"],
            description="You cast sorcerous energy at one creature or object within range. Make a ranged attack roll against the target. On a hit, the target takes 1d8 damage of a type you choose: Acid, Cold, Fire, Lightning, Poison, Psychic, or Thunder. If you roll an 8 on a d8 for this spell, you can roll another d8, and add it to the damage (up to a number of extra d8s equal to your spellcasting ability modifier).",
            higher_levels="Cantrip Upgrade. The damage increases by 1d8 when you reach levels 5 (2d8), 11 (3d8), and 17 (4d8).",
        ),
        SpellModel(
            slug="fireball",
            name="Fireball",
            source_url="http://dnd2024.wikidot.com/spell:fireball",
            level=3,
            school=SpellSchoolEnum.EVOCATION.value,
            class_lists=["sorcerer", "wizard"],
            casting_time="Action",
            ritual=False,
            range="150 feet",
            area_of_effect={"type": "Sphere", "size_ft": 20},
            components={"verbal": True, "somatic": True, "material": True, "material_description": "a ball of bat guano and sulfur", "material_cost_gp": None, "material_consumed": False},
            duration="Instantaneous",
            concentration=False,
            saving_throw_ability="DEX",
            attack_type=None,
            damage_types=["Fire"],
            description="A bright streak flashes from you to a point you choose within range and then blossoms with a low roar into a fiery explosion. Each creature in a 20-foot-radius Sphere centered on that point makes a Dexterity saving throw, taking 8d6 Fire damage on a failed save or half as much damage on a successful one.",
            higher_levels="Using a Higher-Level Spell Slot. The damage increases by 1d6 for each spell slot level above 3.",
        ),
        SpellModel(
            slug="spirit-guardians",
            name="Spirit Guardians",
            source_url="http://dnd2024.wikidot.com/spell:spirit-guardians",
            level=3,
            school=SpellSchoolEnum.CONJURATION.value,
            class_lists=["cleric"],
            casting_time="Action",
            ritual=False,
            range="Self (15-foot Emanation)",
            area_of_effect={"type": "Emanation", "size_ft": 15},
            components={"verbal": True, "somatic": True, "material": True, "material_description": "a prayer scroll", "material_cost_gp": None, "material_consumed": False},
            duration="Concentration, up to 10 minutes",
            concentration=True,
            saving_throw_ability="WIS",
            attack_type=None,
            damage_types=["Radiant", "Necrotic"],
            description="Protective spirits flit around you in a 15-foot Emanation for the duration. Any creature you don't designate has its Speed halved in the Emanation, and whenever the Emanation enters a creature's space and whenever a creature enters the Emanation or ends its turn there, the creature makes a Wisdom saving throw, taking 3d8 Radiant or Necrotic damage on a failed save or half as much on a successful one (once per turn).",
            higher_levels="Using a Higher-Level Spell Slot. The damage increases by 1d8 for each spell slot level above 3.",
        ),
        SpellModel(
            slug="cure-wounds",
            name="Cure Wounds",
            source_url="http://dnd2024.wikidot.com/spell:cure-wounds",
            level=1,
            school=SpellSchoolEnum.ABJURATION.value,
            class_lists=["bard", "cleric", "druid", "paladin", "ranger"],
            casting_time="Action",
            ritual=False,
            range="Touch",
            area_of_effect=None,
            components={"verbal": True, "somatic": True, "material": False, "material_description": None, "material_cost_gp": None, "material_consumed": False},
            duration="Instantaneous",
            concentration=False,
            saving_throw_ability=None,
            attack_type=None,
            damage_types=[],
            description="A creature you touch regains a number of Hit Points equal to 2d8 plus your spellcasting ability modifier (doubled base dice in 2024).",
            higher_levels="Using a Higher-Level Spell Slot. The healing increases by 2d8 for each spell slot level above 1.",
        ),
    ]
    session.add_all(spells)

    # 7. Equipment: Weapons, Armors, Tools, Gear & Magic Items
    weapons = [
        WeaponModel(
            slug="longsword",
            name="Longsword",
            category="Martial Melee",
            range_type="Melee",
            damage_dice="1d8",
            damage_type="Slashing",
            properties=["Versatile (1d10)"],
            versatile_damage_dice="1d10",
            mastery_slug="sap",
            mastery_name="Sap",
            weight_lb=3.0,
            cost_display="15 GP",
            cost_cp=1500,
        ),
        WeaponModel(
            slug="greataxe",
            name="Greataxe",
            category="Martial Melee",
            range_type="Melee",
            damage_dice="1d12",
            damage_type="Slashing",
            properties=["Heavy", "Two-Handed"],
            mastery_slug="cleave",
            mastery_name="Cleave",
            weight_lb=7.0,
            cost_display="30 GP",
            cost_cp=3000,
        ),
        WeaponModel(
            slug="dagger",
            name="Dagger",
            category="Simple Melee",
            range_type="Melee",
            damage_dice="1d4",
            damage_type="Piercing",
            properties=["Finesse", "Light", "Thrown (Range 20/60)"],
            range_normal_ft=20,
            range_long_ft=60,
            mastery_slug="nick",
            mastery_name="Nick",
            weight_lb=1.0,
            cost_display="2 GP",
            cost_cp=200,
        ),
        WeaponModel(
            slug="rapier",
            name="Rapier",
            category="Martial Melee",
            range_type="Melee",
            damage_dice="1d8",
            damage_type="Piercing",
            properties=["Finesse"],
            mastery_slug="vex",
            mastery_name="Vex",
            weight_lb=2.0,
            cost_display="25 GP",
            cost_cp=2500,
        ),
    ]
    session.add_all(weapons)

    armors = [
        ArmorModel(
            slug="studded-leather-armor",
            name="Studded Leather Armor",
            category=ArmorCategoryEnum.LIGHT.value,
            base_ac=12,
            ac_formula_display="12 + Dex modifier",
            adds_dex_modifier=True,
            max_dex_modifier=None,
            strength_requirement=None,
            stealth_disadvantage=False,
            don_time="1 minute",
            doff_time="1 minute",
            weight_lb=13.0,
            cost_display="45 GP",
            cost_cp=4500,
        ),
        ArmorModel(
            slug="chain-mail",
            name="Chain Mail",
            category=ArmorCategoryEnum.HEAVY.value,
            base_ac=16,
            ac_formula_display="16",
            adds_dex_modifier=False,
            max_dex_modifier=0,
            strength_requirement=13,
            stealth_disadvantage=True,
            don_time="10 minutes",
            doff_time="5 minutes",
            weight_lb=55.0,
            cost_display="75 GP",
            cost_cp=7500,
        ),
    ]
    session.add_all(armors)

    tools = [
        ToolModel(
            slug="thieves-tools",
            name="Thieves' Tools",
            category="Other Tools",
            ability="DEX",
            weight_lb=1.0,
            cost_display="25 GP",
            cost_cp=2500,
            utilize_actions=[
                {"action_description": "Pick a lock", "dc": 15},
                {"action_description": "Disarm a trap", "dc": 15},
            ],
            craftable_items=[],
            description="This set of tools includes a small file, a set of lock picks, a small mirror mounted on a metal handle, a set of narrow-bladed scissors, and a pair of pliers.",
        ),
        ToolModel(
            slug="calligraphers-supplies",
            name="Calligrapher's Supplies",
            category="Artisan's Tools",
            ability="DEX",
            weight_lb=5.0,
            cost_display="10 GP",
            cost_cp=1000,
            utilize_actions=[
                {"action_description": "Write text with impressive flourishes that guard against forgery", "dc": 15}
            ],
            craftable_items=["Ink", "Spell Scroll"],
            description="Calligrapher's Supplies include ink, a dozen sheets of parchment, and three quills.",
        ),
    ]
    session.add_all(tools)

    gears = [
        AdventuringGearModel(
            slug="potion-of-healing",
            name="Potion of Healing",
            category="Adventuring Gear",
            weight_lb=0.5,
            cost_display="50 GP",
            cost_cp=5000,
            action_type_required="Bonus Action",
            pack_contents=[],
            description="This potion is a magic item. As a Bonus Action, you can drink it or administer it to another creature within 5 feet of yourself. The creature regains 2d4 + 2 Hit Points.",
        )
    ]
    session.add_all(gears)

    magic_items = [
        MagicItemModel(
            slug="bag-of-holding",
            name="Bag of Holding",
            item_category="Wondrous Item",
            rarity="Uncommon",
            requires_attunement=False,
            crafting_time_days=10,
            crafting_cost_gp=200,
            description="This bag has an interior space considerably larger than its outside dimensions, roughly 2 feet in diameter at the mouth and 4 feet deep. It can hold up to 500 pounds, not exceeding a volume of 64 cubic feet. The bag always weighs 15 pounds.",
        )
    ]
    session.add_all(magic_items)

    # 8. Monsters (2024 Stat Block Format)
    monsters = [
        MonsterModel(
            slug="owlbear",
            name="Owlbear",
            size=["Large"],
            creature_type="Monstrosity",
            alignment="Unaligned",
            armor_class=13,
            armor_notes="natural armor",
            initiative_bonus=1,
            initiative_passive=11,
            hit_points=59,
            hit_dice_formula="7d10 + 21",
            speeds={"walk": "40 ft.", "climb": "40 ft."},
            abilities={
                "STR": {"score": 20, "modifier": 5, "saving_throw": 5},
                "DEX": {"score": 12, "modifier": 1, "saving_throw": 1},
                "CON": {"score": 17, "modifier": 3, "saving_throw": 3},
                "INT": {"score": 3, "modifier": -4, "saving_throw": -4},
                "WIS": {"score": 12, "modifier": 1, "saving_throw": 1},
                "CHA": {"score": 7, "modifier": -2, "saving_throw": -2},
            },
            skills={"Perception": 5},
            senses={"darkvision": "60 ft.", "passive_perception": 15},
            languages=[],
            challenge_rating="3",
            cr_numeric=3.0,
            xp=700,
            proficiency_bonus=2,
            habitat=["Forest"],
            traits=[],
            actions=[
                {
                    "name": "Multiattack",
                    "action_type": "Action",
                    "description": "The owlbear makes two Rend attacks.",
                },
                {
                    "name": "Rend",
                    "action_type": "Action",
                    "attack_roll_type": "Melee Attack Roll",
                    "attack_bonus": 7,
                    "reach_or_range": "reach 5 ft.",
                    "hit_or_fail_effect": "14 (2d8 + 5) Slashing damage.",
                    "description": "Melee Attack Roll: +7, reach 5 ft. Hit: 14 (2d8 + 5) Slashing damage.",
                },
            ],
        )
    ]
    session.add_all(monsters)

    # 9. Bastion Facilities (2024 Rules)
    bastions = [
        BastionFacilityModel(
            slug="arcane-study",
            name="Arcane Study",
            facility_type="Special",
            level_prerequisite=5,
            prerequisite_text="Ability to use an Arcane Focus or Tool as a Spellcasting Focus",
            space="Roomy (16 squares)",
            hirelings_count=1,
            bastion_order="Craft",
            passive_benefit="Arcane Study Charm: After spending a Long Rest in your Bastion, you gain a magical Charm that lets you cast Identify once without a spell slot or Material components.",
            order_options=[
                {"option": "Craft: Arcane Focus", "description": "Commission the facility's hireling to craft an Arcane Focus (7 days, no cost)."},
                {"option": "Craft: Book", "description": "Commission the hireling to craft a blank book (7 days, 10 GP)."},
                {"option": "Craft: Magic Item (Arcana)", "description": "Level 9+: Craft a Common or Uncommon magic item from the Arcana table."},
            ],
            description="An Arcane Study is a quiet place of research containing desks and bookshelves.",
        )
    ]
    session.add_all(bastions)

    # 10. Rules Glossary (2024 Rules)
    rules = [
        RuleGlossaryModel(
            slug="bloodied",
            name="Bloodied",
            tag="General Rule",
            summary="A creature is Bloodied while it has half its Hit Points or fewer remaining.",
            bullet_effects=["Triggers specific monster traits, class features, and spell effects when HP <= 50% of maximum."],
            description="A creature is Bloodied while it has half its Hit Points or fewer remaining.",
            see_also_slugs=["hit-points"],
        ),
        RuleGlossaryModel(
            slug="exhaustion",
            name="Exhaustion [Condition]",
            tag="Condition",
            summary="Cumulative 6-level condition in 2024 that reduces D20 Tests by 2 x level and Speed by 5 x level ft.",
            bullet_effects=[
                "Exhaustion Levels: This condition is cumulative. Each time you receive it, you gain 1 Exhaustion level. You die if your Exhaustion level is 6.",
                "D20 Tests Affected: When you make a D20 Test, the roll is reduced by 2 times your Exhaustion level.",
                "Speed Reduced: Your Speed is reduced by a number of feet equal to 5 times your Exhaustion level.",
                "Removing Exhaustion Levels: Finishing a Long Rest removes 1 of your Exhaustion levels.",
            ],
            description="While you have the Exhaustion condition, you experience the following effects.",
            see_also_slugs=["long-rest"],
        ),
        RuleGlossaryModel(
            slug="emanation",
            name="Emanation [Area of Effect]",
            tag="Area of Effect",
            summary="An area of effect that extends in straight lines in all directions from a creature or object.",
            bullet_effects=[
                "Originates from the boundary of the creator's space.",
                "Moves with the creature or object that is its origin unless it is an instantaneous or stationary effect.",
            ],
            description="An Emanation is an area of effect that extends in straight lines from a creature or an object in all directions.",
            see_also_slugs=["spirit-guardians"],
        ),
        RuleGlossaryModel(
            slug="utilize",
            name="Utilize [Action]",
            tag="Action",
            summary="Use a nonmagical object or tool that requires an action.",
            bullet_effects=[
                "You normally interact with an object while doing something else, such as when you draw a sword as part of the Attack action.",
                "When an object requires an action for its use, you take the Utilize action.",
            ],
            description="You normally interact with an object while doing something else. When an object requires an action for its use, you take the Utilize action.",
            see_also_slugs=["magic-action"],
        ),
    ]
    session.add_all(rules)
    session.commit()

    return {
        "weapon_masteries": len(masteries),
        "feats": len(feats),
        "backgrounds": len(backgrounds),
        "species": len(species_list),
        "classes": len(classes_list),
        "subclasses": len(subclasses_list),
        "feature_options": len(feature_options),
        "spells": len(spells),
        "weapons": len(weapons),
        "armors": len(armors),
        "tools": len(tools),
        "gears": len(gears),
        "magic_items": len(magic_items),
        "monsters": len(monsters),
        "bastions": len(bastions),
        "rules": len(rules),
    }