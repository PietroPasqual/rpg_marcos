"""
Importador do catálogo a partir do System Reference Document 5.2.1 (SRD 5.2.1, CC-BY 4.0).

Fontes (versionadas em data/srd_5_2_1/, regeneradas por scripts/download_srd_data.py):
* data/srd_5_2_1/open5e/*.json — transcrição estruturada do SRD 5.2 pelo projeto Open5e
  (documento "srd-2024"): classes, subclasses, espécies, antecedentes, talentos, magias,
  armas, armaduras, ferramentas, equipamentos, itens mágicos, criaturas e regras.
* data/srd_5_2_1/srd_pdf_extract.json — Glossário de Regras e proficiências de multiclasse
  extraídos do PDF oficial SRD_CC_v5.2.1.pdf (scripts/extract_srd_pdf.py).

Cada registro é validado pelo schema Pydantic correspondente antes de ser gravado, garantindo
que toda resposta da API seja serializável.
"""

from __future__ import annotations

import hashlib
import json
import re
from collections import defaultdict
from decimal import Decimal
from functools import cached_property
from pathlib import Path
from typing import Any, Iterable

from pydantic import BaseModel
from sqlalchemy.orm import Session

from schemas_and_models import (
    AdventuringGearModel,
    AdventuringGearSchema,
    ArmorModel,
    ArmorSchema,
    BackgroundModel,
    BackgroundSchema,
    CatalogMetadataModel,
    ClassFeatureOptionModel,
    ClassFeatureOptionSchema,
    ClassModel,
    ClassSchema,
    FeatModel,
    FeatSchema,
    MagicItemModel,
    MagicItemSchema,
    MonsterModel,
    MonsterSchema,
    RuleGlossaryModel,
    RuleGlossarySchema,
    SpeciesModel,
    SpeciesSchema,
    SpellModel,
    SpellSchema,
    SubclassModel,
    SubclassSchema,
    ToolModel,
    ToolSchema,
    WeaponMasteryModel,
    WeaponMasterySchema,
    WeaponModel,
    WeaponSchema,
)

# Incrementar sempre que o mapeamento mudar: bancos com outra versão são recriados no startup.
IMPORT_VERSION = "srd-5.2.1/open5e-srd-2024/v3"

DATA_DIR = Path(__file__).resolve().parent / "data" / "srd_5_2_1"
SOURCE_BOOK = "System Reference Document 5.2.1"
SOURCE_URL = "https://www.dndbeyond.com/srd"
ATTRIBUTION = (
    "This work includes material from the System Reference Document 5.2.1 (\"SRD 5.2.1\") by Wizards of "
    "the Coast LLC, available at https://www.dndbeyond.com/srd. The SRD 5.2.1 is licensed under the Creative "
    "Commons Attribution 4.0 International License, available at https://creativecommons.org/licenses/by/4.0/legalcode."
)

ABILITIES = ["STR", "DEX", "CON", "INT", "WIS", "CHA"]
ABILITY_BY_NAME = {
    "strength": "STR", "str": "STR",
    "dexterity": "DEX", "dex": "DEX",
    "constitution": "CON", "con": "CON",
    "intelligence": "INT", "int": "INT",
    "wisdom": "WIS", "wis": "WIS",
    "charisma": "CHA", "cha": "CHA",
}
ABILITY_NAME_RE = re.compile(r"\b(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)\b")
SKILLS = [
    "Acrobatics", "Animal Handling", "Arcana", "Athletics", "Deception", "History", "Insight",
    "Intimidation", "Investigation", "Medicine", "Nature", "Perception", "Performance",
    "Persuasion", "Religion", "Sleight of Hand", "Stealth", "Survival",
]
SIZES = ["Tiny", "Small", "Medium", "Large", "Huge", "Gargantuan"]
CONDITIONS = [
    "Blinded", "Charmed", "Deafened", "Exhaustion", "Frightened", "Grappled", "Incapacitated",
    "Invisible", "Paralyzed", "Petrified", "Poisoned", "Prone", "Restrained", "Stunned", "Unconscious",
]
CONDITION_RE = re.compile(r"\b(" + "|".join(CONDITIONS) + r") condition", re.IGNORECASE)

CASTING_TIMES = {
    "action": "Action",
    "bonus-action": "Bonus Action",
    "reaction": "Reaction",
    "1minute": "1 minute",
    "10minutes": "10 minutes",
    "1hour": "1 hour",
    "8hours": "8 hours",
    "12hours": "12 hours",
    "24hours": "24 hours",
}
ARMOR_DON_DOFF = {
    "Light Armor": ("1 Minute", "1 Minute"),
    "Medium Armor": ("5 Minutes", "1 Minute"),
    "Heavy Armor": ("10 Minutes", "5 Minutes"),
    "Shield": ("Utilize Action", "Utilize Action"),
}
# Armas à distância do SRD sem a propriedade Ammunition (os demais são identificados por ela).
RANGED_WEAPONS_WITHOUT_AMMUNITION = {"dart"}
# Correções de erros de digitação/rotulagem do dataset de origem.
CLASS_COLUMN_NAME_FIXES = {"wild-shape-uses": "Wild Shape", "unarmored-movement": "Unarmored Movement"}
NON_COLUMN_FEATURE_SUFFIXES = ("core-traits", "spell-list")
OPTION_FEATURES = {
    "eldritch-invocation-options": "Eldritch Invocation",
    "metamagic-options": "Metamagic",
}
CR_FRACTIONS = {0.125: "1/8", 0.25: "1/4", 0.5: "1/2"}
XP_BY_CR = {
    0: 10, 0.125: 25, 0.25: 50, 0.5: 100, 1: 200, 2: 450, 3: 700, 4: 1100, 5: 1800, 6: 2300, 7: 2900,
    8: 3900, 9: 5000, 10: 5900, 11: 7200, 12: 8400, 13: 10000, 14: 11500, 15: 13000, 16: 15000,
    17: 18000, 18: 20000, 19: 22000, 20: 25000, 21: 33000, 22: 41000, 23: 50000, 24: 62000,
    25: 75000, 26: 90000, 27: 105000, 28: 120000, 29: 135000, 30: 155000,
}


# =====================================================================
# 1. UTILITÁRIOS DE TEXTO E CONVERSÃO
# =====================================================================


# Restos de marcação de links do 5etools no dataset de origem:
# "Sphere [Area of Effect]|XPHB|Sphere" -> "Sphere", "Cover|XPHB|Total Cover" -> "Total Cover".
LINK_MARKUP_RE = re.compile(r"\b\S+(?: \[[^\]]+\])?\|X[A-Z]+\|")


# Palavras partidas no meio pelo PDF de origem: "Ar cane Focus", "Ar rows", "Leather Ar mor".
BROKEN_WORD_RE = re.compile(r"\bAr (cane|rows|mor)\b")


def clean_text(value: Any) -> Any:
    if not isinstance(value, str):
        return value
    return BROKEN_WORD_RE.sub(r"Ar\1", LINK_MARKUP_RE.sub("", value))


def slugify(value: str) -> str:
    value = value.lower().replace("’", "").replace("'", "")
    return re.sub(r"[^a-z0-9]+", "-", value).strip("-")


def strip_key(pk: str) -> str:
    return pk.removeprefix("srd-2024_")


def content_hash(*parts: Any) -> str:
    return hashlib.sha256(json.dumps(parts, sort_keys=True, ensure_ascii=False, default=str).encode()).hexdigest()


def ability_codes(text: str) -> list[str]:
    found: list[str] = []
    for name in ABILITY_NAME_RE.findall(text or ""):
        code = ABILITY_BY_NAME[name.lower()]
        if code not in found:
            found.append(code)
    return found


def normalize_skill(raw: str) -> str:
    key = re.sub(r"[^a-z]", "", raw.lower())
    for skill in SKILLS:
        if re.sub(r"[^a-z]", "", skill.lower()) == key:
            return skill
    return raw.strip()


def split_top_level(text: str, sep: str = ",") -> list[str]:
    """Divide por vírgula ignorando separadores dentro de parênteses."""
    parts, depth, current = [], 0, ""
    for char in text:
        depth += char == "("
        depth -= char == ")"
        if char == sep and depth == 0:
            parts.append(current)
            current = ""
        else:
            current += char
    parts.append(current)
    return [p.strip() for p in parts if p.strip()]


def split_list(text: str) -> list[str]:
    """'A, B, and C' / 'A and B' -> ['A', 'B', 'C']."""
    items: list[str] = []
    for part in split_top_level(text):
        part = re.sub(r"^(?:and|or)\s+", "", part.strip())
        items.extend(p.strip() for p in re.split(r"\s+(?:and|or)\s+", part) if p.strip())
    return items


def cost_from_gp(cost: str | None) -> tuple[str, int]:
    cp = int((Decimal(cost or "0") * 100).to_integral_value())
    if cp == 0:
        return "—", 0
    if cp % 100 == 0:
        return f"{cp // 100:,} GP", cp
    if cp % 10 == 0:
        return f"{cp // 10} SP", cp
    return f"{cp} CP", cp


def weight_lb(value: str | None) -> float:
    return float(Decimal(value or "0"))


def title_from_key(key: str) -> str:
    return " ".join(word.capitalize() for word in key.replace("_", "-").split("-"))


def first_sentence(text: str, limit: int = 300) -> str:
    match = re.match(r"(.+?[.!?])(\s|$)", text.strip(), re.S)
    sentence = match.group(1) if match else text.strip()
    return sentence[:limit]


def parse_markdown_tables(text: str) -> list[dict[str, Any]]:
    tables: list[dict[str, Any]] = []
    lines = (text or "").splitlines()
    i = 0
    while i < len(lines):
        if lines[i].strip().startswith("|"):
            block: list[str] = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                block.append(lines[i].strip())
                i += 1
            rows = [[cell.strip() for cell in row.strip("|").split("|")] for row in block]
            is_separator = lambda r: all(re.fullmatch(r":?-{2,}:?", c) for c in r) and any(r)
            if len(rows) >= 2 and is_separator(rows[1]):
                headers, body = rows[0], rows[2:]
            else:
                headers, body = [], [r for r in rows if not is_separator(r)]
            caption = None
            j = i - len(block) - 1
            while j >= 0 and not lines[j].strip():
                j -= 1
            if j >= 0:
                cap = re.match(r"^\**Table:\s*(.+?)\**$", lines[j].strip())
                caption = cap.group(1).strip() if cap else None
            tables.append({"caption": caption, "headers": headers, "rows": body})
        else:
            i += 1
    return tables


def condition_references(*texts: str) -> list[dict[str, str]]:
    names: list[str] = []
    for text in texts:
        for name in CONDITION_RE.findall(text or ""):
            name = name.capitalize()
            if name not in names:
                names.append(name)
    return [
        {"entity_type": "rule", "slug": slugify(n), "name": n, "api_path": f"/api/v1/rules/{slugify(n)}"}
        for n in names
    ]


class ItemIndex:
    """Resolve nomes de itens do equipamento inicial para slugs reais de armas, armaduras, ferramentas e equipamentos."""

    GROUPS = {"weapons": "weapon", "armor": "armor", "tools": "tool", "gear": "gear"}
    # Nome (slugificado) -> slug do catálogo, quando o SRD usa outro termo ou o item vem em pacote.
    ALIASES = {
        "arrows": "arrows-20",
        "bolts": "bolts-20",
        "druidic-focus-quarterstaff": "druidic-focus-wooden-staff",
        "arcane-focus-quarterstaff": "quarterstaff",
    }
    # Escolhas genéricas do SRD ("a Holy Symbol", "a Musical Instrument of your choice").
    CHOICES = {
        "holy-symbol": ("gear", "holy-symbol-"),
        "musical-instrument-of-your-choice": ("tool", "musical-instrument-"),
        "gaming-set-same-as-above": ("tool", "gaming-set-"),
    }

    def __init__(self, catalog: dict[str, list[dict[str, Any]]]) -> None:
        self.type_by_slug: dict[str, str] = {}
        for group, item_type in self.GROUPS.items():
            for row in catalog[group]:
                self.type_by_slug[row["slug"]] = item_type
        self.by_tokens = {frozenset(slug.split("-")): slug for slug in self.type_by_slug}

    def _lookup(self, slug: str) -> str | None:
        candidates = [slug, self.ALIASES.get(slug, slug)]
        for suffix in ("s", "es"):
            if slug.endswith(suffix):
                candidates.append(slug[: -len(suffix)])
        for candidate in candidates:
            candidate = self.ALIASES.get(candidate, candidate)
            if candidate in self.type_by_slug:
                return candidate
        return self.by_tokens.get(frozenset(slug.split("-")))

    def resolve(self, name: str, quantity: int) -> dict[str, Any]:
        slug = slugify(name)
        entry: dict[str, Any] = {"item_slug": None, "item_name": name, "quantity": quantity, "item_type": None, "choose_from": []}
        if slug in self.CHOICES or "chosen-for-the-tool-proficiency" in slug:
            if slug in self.CHOICES:
                item_type, prefix = self.CHOICES[slug]
                entry["choose_from"] = sorted(s for s in self.type_by_slug if s.startswith(prefix))
            else:  # Monge: ferramenta de artesão ou instrumento musical
                entry["choose_from"] = sorted(
                    s for s in self.type_by_slug
                    if s.startswith("musical-instrument-") or s.endswith(("-supplies", "-tools", "-utensils")) and s not in {"navigators-tools", "thieves-tools"}
                )
            entry["item_type"] = "tool" if slug not in {"holy-symbol"} else "gear"
            return entry

        found = self._lookup(slug)
        if found is None and "(" in name:  # "Book (prayers)", "Parchment (10 sheets)", "Arcane Focus (crystal)"
            base = re.sub(r"\s*\(.*\)", "", name)
            found = self._lookup(slugify(base))
            if sheets := re.search(r"\((\d+) sheets\)", name):
                entry["quantity"] = quantity * int(sheets.group(1))
        if found:
            entry["item_slug"] = found
            entry["item_type"] = self.type_by_slug[found]
            if pack := re.search(r"-(\d+)$", found):  # "20 Arrows" = 1 pacote "arrows-20"
                size = int(pack.group(1))
                if quantity % size == 0:
                    entry["quantity"] = quantity // size
        return entry


def parse_equipment_options(text: str, index: "ItemIndex | None" = None) -> list[dict[str, Any]]:
    """'(A) Greataxe, 4 Handaxes, Explorer's Pack, and 15 GP; or (B) 75 GP' -> opções A/B com itens resolvidos."""
    options: list[dict[str, Any]] = []
    for label, body in re.findall(r"\(([A-Z])\)\s*(.+?)(?=;\s*(?:or\s+)?\([A-Z]\)|$)", text or ""):
        gold = 0
        items: list[dict[str, Any]] = []
        for part in split_top_level(body.strip().rstrip(".")):
            part = re.sub(r"^and\s+", "", part)
            gp = re.fullmatch(r"(\d+)\s*GP", part, re.IGNORECASE)
            if gp:
                gold = int(gp.group(1))
                continue
            qty = re.match(r"^(\d+)\s+(.+)$", part)
            name = qty.group(2) if qty else part
            quantity = int(qty.group(1)) if qty else 1
            if index is None:
                items.append({"item_slug": slugify(name), "item_name": name, "quantity": quantity, "item_type": None, "choose_from": []})
            else:
                items.append(index.resolve(name, quantity))
        options.append({"option_label": label, "items": items, "gold_gp": gold})
    return options


# =====================================================================
# 2. LEITURA DOS DADOS DE ORIGEM
# =====================================================================


class SrdSource:
    def __init__(self, data_dir: Path = DATA_DIR) -> None:
        self.data_dir = data_dir

    def records(self, name: str) -> list[dict[str, Any]]:
        path = self.data_dir / "open5e" / f"{name}.json"
        rows = json.loads(path.read_text(encoding="utf-8"))
        return [{"pk": r["pk"], **{k: clean_text(v) for k, v in r["fields"].items()}} for r in rows]

    @cached_property
    def pdf_extract(self) -> dict[str, Any]:
        return json.loads((self.data_dir / "srd_pdf_extract.json").read_text(encoding="utf-8"))

    @cached_property
    def items_by_pk(self) -> dict[str, dict[str, Any]]:
        return {r["pk"]: r for r in self.records("Item")}

    def children(self, name: str) -> dict[str, list[dict[str, Any]]]:
        grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for r in self.records(name):
            grouped[r["parent"]].append(r)
        return grouped


# =====================================================================
# 3. MAPEADORES POR ENTIDADE
# =====================================================================


def build_rules(src: SrdSource) -> list[dict[str, Any]]:
    glossary = src.pdf_extract["rules_glossary"]
    slugs = {slugify(e["name"]) for e in glossary}
    rules: list[dict[str, Any]] = []
    for entry in glossary:
        paragraphs, bullets = entry["paragraphs"], entry["bullets"]
        description = "\n\n".join(paragraphs + [f"**{b['name']}.** {b['text']}" for b in bullets])
        summary = paragraphs[0] if paragraphs else f"{bullets[0]['name']}. {bullets[0]['text']}"
        rules.append({
            "slug": slugify(entry["name"]),
            "name": entry["name"],
            "tag": entry["tag"] or "General Rule",
            "summary": summary,
            "bullet_effects": [f"{b['name']}: {b['text']}" for b in bullets],
            "description": description,
            "see_also_slugs": [s for s in dict.fromkeys(slugify(x) for x in entry["see_also"]) if s in slugs],
            "referenced_entities": [r for r in condition_references(description) if r["slug"] != slugify(entry["name"])],
        })

    # Capítulos "Playing the Game", "Create Your Character", "Multiclassing"... (seções do Open5e)
    rulesets = {r["pk"]: r for r in src.records("RuleSet")}
    for ruleset in rulesets.values():
        rules.append({
            "slug": f"rules-{slugify(strip_key(ruleset['pk']))}",
            "name": ruleset["name"],
            "tag": "Rules Section",
            "summary": first_sentence(ruleset["desc"] or ruleset["name"], 500),
            "description": ruleset["desc"] or "",
            "see_also_slugs": [],
        })
    for rule in sorted(src.records("Rule"), key=lambda r: (r["ruleset"], r["index"])):
        chapter = rulesets[rule["ruleset"]]["name"]
        rules.append({
            "slug": f"rules-{slugify(strip_key(rule['pk']))}",
            "name": f"{rule['name']} ({chapter})",
            "tag": "Rules Section",
            "summary": first_sentence(re.sub(r"[#*|]", "", rule["desc"]).strip() or rule["name"], 500),
            "description": rule["desc"],
            "see_also_slugs": [f"rules-{slugify(strip_key(rule['ruleset']))}"],
            "referenced_entities": condition_references(rule["desc"]),
        })
    return rules


def build_feats(src: SrdSource) -> list[dict[str, Any]]:
    benefits = src.children("FeatBenefit")
    feats: list[dict[str, Any]] = []
    for feat in src.records("Feat"):
        category = feat["type"]
        level = {"General": 4, "Epic Boon": 19}.get(category, 1)
        prereq = feat["prerequisite"] or None
        if prereq and (m := re.search(r"Level\s+(\d+)\+?", prereq)):
            level = int(m.group(1))
        repeatable, repeatable_note = False, None
        asi: list[str] = []
        feat_benefits: list[dict[str, str]] = []
        for b in sorted(benefits.get(feat["pk"], []), key=lambda b: b["pk"]):
            if b["name"].lower() == "repeatable":
                repeatable, repeatable_note = True, b["desc"]
                continue
            if "ability score" in b["name"].lower():
                asi = ability_codes(b["desc"]) or (ABILITIES[:] if "of your choice" in b["desc"] else [])
            feat_benefits.append({"name": b["name"], "description": b["desc"]})
        all_text = " ".join([feat["desc"]] + [b["description"] for b in feat_benefits])
        feats.append({
            "slug": strip_key(feat["pk"]),
            "name": feat["name"],
            "category": category,
            "level_prerequisite": level,
            "prerequisite_text": prereq,
            "ability_score_increase_options": asi,
            "repeatable": repeatable,
            "repeatable_note": repeatable_note,
            "benefits": feat_benefits,
            "description": feat["desc"],
            "referenced_entities": condition_references(all_text),
        })
    return feats


def build_backgrounds(src: SrdSource, index: ItemIndex) -> list[dict[str, Any]]:
    benefits = src.children("BackgroundBenefit")
    backgrounds: list[dict[str, Any]] = []
    for bg in src.records("Background"):
        by_type = {b["type"]: b["desc"] for b in benefits.get(bg["pk"], [])}
        feat_name = by_type["feat"].strip()
        tool = by_type.get("tool_proficiency", "").strip()
        backgrounds.append({
            "slug": strip_key(bg["pk"]),
            "name": bg["name"],
            "ability_scores": ability_codes(by_type["ability_score"]),
            "origin_feat_slug": slugify(re.sub(r"\s*\(.*\)$", "", feat_name)),
            "origin_feat_name": feat_name,
            "skill_proficiencies": [normalize_skill(s) for s in split_list(by_type["skill_proficiency"])],
            "tool_proficiency": tool,
            "tool_slug": slugify(re.sub(r"\s*\(.*\)$", "", tool)) or None,
            "equipment_options": parse_equipment_options(by_type.get("equipment", ""), index),
            "description": bg["desc"] or "",
        })
    return backgrounds


def _text_lineages(trait: dict[str, Any]) -> tuple[str | None, list[dict[str, Any]]]:
    """Opções de escolha descritas fora de tabelas de nível: parágrafos em negrito (Gnomo), lista (Golias) ou tabela Dragon (Dragonato)."""
    desc = trait["desc"]
    lineages: list[dict[str, Any]] = []

    def lineage(name: str, text: str) -> dict[str, Any]:
        spells = list(dict.fromkeys(slugify(m) for m in re.findall(r"\*([A-Z][^*]+?)\*", text)))
        return {
            "slug": slugify(re.sub(r"\s*\(.*\)$", "", name)),
            "name": name,
            "description": text,
            "benefits_by_level": [{"character_level": 1, "description": text, "granted_spells": spells}],
        }

    for table in parse_markdown_tables(desc):
        if table["headers"][:2] == ["Dragon", "Damage Type"]:
            for dragon, damage in table["rows"]:
                lineages.append(lineage(dragon, f"Damage Type: {damage}. Your Breath Weapon and Damage Resistance use {damage} damage."))
            return table["caption"] or trait["name"], lineages

    for m in re.finditer(r"(?:^|\n)(?:- )?\*\*(?P<name>[^*\n]+?)\.?\*\*\.?\s+(?P<text>.+?)(?=\n\n|\n- \*\*|$)", desc, re.S):
        if not m.group("name").startswith("Table:"):
            lineages.append(lineage(m.group("name").strip(), m.group("text").strip()))
    return (trait["name"] if lineages else None), lineages


def build_species(src: SrdSource) -> list[dict[str, Any]]:
    traits = src.children("SpeciesTrait")
    species: list[dict[str, Any]] = []
    for sp in src.records("Species"):
        sp_traits = sorted(traits.get(sp["pk"], []), key=lambda t: t["order"] or 0)
        size_desc = next((t["desc"] for t in sp_traits if t["type"] == "SIZE"), "Medium")
        speed_desc = next((t["desc"] for t in sp_traits if t["type"] == "SPEED"), "30 feet")
        darkvision = None
        lineages: list[dict[str, Any]] = []
        lineage_title = None
        trait_list: list[dict[str, str]] = []
        for t in sp_traits:
            if t["type"] in ("SIZE", "SPEED"):
                continue
            if m := re.search(r"Darkvision with a range of (\d+) feet", t["desc"]):
                darkvision = int(m.group(1))
            for table in parse_markdown_tables(t["desc"]):
                headers = [h.lower() for h in table["headers"]]
                if "level 1" not in headers:
                    continue
                lineage_title = table["caption"] or t["name"]
                for row in table["rows"]:
                    benefits = []
                    for col, header in enumerate(table["headers"][1:], start=1):
                        lvl = int(re.search(r"\d+", header).group(0))
                        cell = row[col] if col < len(row) else ""
                        if lvl == 1:
                            spells = re.findall(r"know the ([A-Z][\w' ]+?) cantrip", cell)
                            benefits.append({"character_level": 1, "description": cell, "granted_spells": [slugify(s) for s in spells]})
                        else:
                            benefits.append({
                                "character_level": lvl,
                                "description": f"You learn the {cell} spell.",
                                "granted_spells": [slugify(cell)],
                            })
                    lineages.append({
                        "slug": slugify(row[0]),
                        "name": row[0],
                        "description": row[1] if len(row) > 1 else "",
                        "benefits_by_level": benefits,
                    })
            if not lineages:
                title, found = _text_lineages(t)
                if found:
                    lineage_title, lineages = title, found
            trait_list.append({"slug": slugify(t["name"]), "name": t["name"], "description": t["desc"]})
        speed = re.search(r"(\d+)", speed_desc)
        species.append({
            "slug": strip_key(sp["pk"]),
            "name": sp["name"],
            "creature_type": "Humanoid",
            "sizes": [s for s in SIZES if re.search(rf"\b{s}\b", size_desc)] or ["Medium"],
            "size_description": size_desc,
            "speed_ft": int(speed.group(1)) if speed else 30,
            "darkvision_ft": darkvision,
            "traits": trait_list,
            "lineage_table_title": lineage_title,
            "lineages": lineages,
            "description": sp["desc"] or "",
            "referenced_entities": condition_references(*(t["description"] for t in trait_list)),
        })
    return species


def _parse_multiclass(text: str, primary: list[str]) -> dict[str, Any]:
    gained: dict[str, list[str]] = {"weapons": [], "armor": [], "skills": [], "tools": []}
    body = text.split(":", 1)[1] if ":" in text else ""
    for kind, value in re.findall(
        r"(proficiency (?:with|in)|training with)\s+(.+?)(?=,\s*(?:and\s+)?(?:proficiency|training)|\s+and\s+(?:proficiency|training)|\.?$)",
        body.strip(),
    ):
        value = value.strip().rstrip(".")
        if kind == "training with":
            parts = [p.strip() for p in re.split(r",\s*|\s+and\s+", value) if p.strip()]
            gained["armor"].extend(p if re.search(r"armor|Shields?$", p) else f"{p} armor" for p in parts)
        elif "weapon" in value.lower():
            gained["weapons"].append(value)
        elif "skill" in value.lower():
            gained["skills"].append(value)
        else:
            gained["tools"].append(value)
    gained["description"] = [text] if text else []
    return {"ability_score_minimum": {ab: 13 for ab in primary}, "proficiencies_gained": gained}


def _feature_levels(items: list[dict[str, Any]]) -> list[int]:
    return sorted({i["level"] for i in items if i["column_value"] is None})


def _feature_payload(feature: dict[str, Any], items: list[dict[str, Any]], is_subclass: bool) -> dict[str, Any]:
    levels = _feature_levels(items)
    return {
        "slug": strip_key(feature["pk"]).split("_")[-1],
        "name": feature["name"],
        "level": levels[0] if levels else 1,
        "is_subclass_feature": is_subclass,
        "description": feature["desc"],
        "tables": parse_markdown_tables(feature["desc"]),
    }


def _column_value(value: str) -> int | str:
    value = value.strip()
    return int(value) if re.fullmatch(r"\d+", value) else value


def build_classes(src: SrdSource, index: ItemIndex) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    all_classes = src.records("CharacterClass")
    features_by_parent = src.children("ClassFeature")
    items_by_feature = src.children("ClassFeatureItem")
    multiclass_text = src.pdf_extract["multiclass_proficiencies"]
    base_classes = [c for c in all_classes if not c["subclass_of"]]
    subclasses_by_parent: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for c in all_classes:
        if c["subclass_of"]:
            subclasses_by_parent[c["subclass_of"]].append(c)

    classes, subclasses, options = [], [], []
    for cls in base_classes:
        slug = strip_key(cls["pk"])
        features = features_by_parent.get(cls["pk"], [])
        by_suffix = {strip_key(f["pk"]).removeprefix(f"{slug}_"): f for f in features}

        core_rows = parse_markdown_tables(by_suffix["core-traits"]["desc"])[0]["rows"]
        core = {row[0]: row[1] for row in core_rows if len(row) >= 2}
        primary_text = core.get("Primary Ability", "")
        primary = ability_codes(primary_text)
        die = int(re.search(r"\d+", cls["hit_dice"]).group(0))

        skills_text = core.get("Skill Proficiencies", "")
        count_match = re.search(r"Choose (?:any )?(\d+)", skills_text)
        if ":" in skills_text:
            skill_options = [normalize_skill(s) for s in split_list(skills_text.split(":", 1)[1])]
        else:
            skill_options = SKILLS[:]

        spell_feature = by_suffix.get("spellcasting") or by_suffix.get("pact-magic")
        spell_ability = focus = None
        if spell_feature:
            if m := re.search(r"\*\*Spellcasting Ability\.\*\*\s*(\w+) is (?:your|the) spellcasting ability", spell_feature["desc"]):
                spell_ability = ABILITY_BY_NAME.get(m.group(1).lower())
            if m := re.search(r"\*\*Spellcasting Focus\.\*\*\s*You can use (?:an? )?(.+?) as a Spellcasting Focus", spell_feature["desc"]):
                focus = m.group(1).strip()

        # Separa colunas da tabela de classe (bônus de proficiência, espaços de magia, Rages...) das features.
        columns: dict[str, dict[int, str]] = {}
        regular_features: list[dict[str, Any]] = []
        for suffix, feature in by_suffix.items():
            items = items_by_feature.get(feature["pk"], [])
            values = {i["level"]: i["column_value"] for i in items if i["column_value"] is not None}
            if values:
                columns[suffix] = values
            elif suffix in OPTION_FEATURES:
                options.extend(_parse_feature_options(feature, slug, OPTION_FEATURES[suffix]))
            elif not suffix.endswith(NON_COLUMN_FEATURE_SUFFIXES) and _feature_levels(items):
                regular_features.append(_feature_payload(feature, items, is_subclass=False) | {"_levels": _feature_levels(items)})

        level_table = []
        for level in range(1, 21):
            names = [f["name"] for f in regular_features if level in f["_levels"]]
            slots = {
                str(n): int(columns[f"slots-{ordinal}"][level])
                for n, ordinal in enumerate(["1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th"], start=1)
                if f"slots-{ordinal}" in columns and level in columns[f"slots-{ordinal}"]
            }
            spellcasting = None
            if spell_feature:
                cantrips = columns.get("cantrips", {}).get(level)
                prepared = columns.get("prepared-spells", {}).get(level)
                pact_count = columns.get("spell-slots", {}).get(level)
                pact_level = columns.get("slot-level", {}).get(level)
                spellcasting = {
                    "cantrips_known": int(cantrips) if cantrips and cantrips.isdigit() else None,
                    "prepared_spells": int(prepared) if prepared and prepared.isdigit() else 0,
                    "slots_by_level": slots,
                    "pact_slots_count": int(pact_count) if pact_count and pact_count.isdigit() else None,
                    "pact_slot_level": int(re.search(r"\d+", pact_level).group(0)) if pact_level else None,
                }
            specific = {}
            for suffix, values in columns.items():
                if suffix in {"proficiency-bonus", "weapon-mastery-count", "cantrips", "prepared-spells", "spell-slots", "slot-level"}:
                    continue
                if suffix.startswith("slots-") or level not in values:
                    continue
                column_name = CLASS_COLUMN_NAME_FIXES.get(suffix, by_suffix[suffix]["name"])
                specific[slugify(column_name).replace("-", "_")] = _column_value(values[level])
            masteries = columns.get("weapon-mastery-count", {}).get(level)
            level_table.append({
                "level": level,
                "proficiency_bonus": int(columns["proficiency-bonus"][level]),
                "feature_names": names,
                "feature_slugs": [slugify(n) for n in names],
                "weapon_masteries_known": int(masteries) if masteries else 0,
                "class_specific_columns": specific,
                "spellcasting": spellcasting,
            })

        class_subclasses = sorted(subclasses_by_parent.get(cls["pk"], []), key=lambda s: s["name"])
        subclass_levels: set[int] = set()
        for sub in class_subclasses:
            sub_features = features_by_parent.get(sub["pk"], [])
            payload_features = []
            prepared_spells = []
            for feature in sub_features:
                items = items_by_feature.get(feature["pk"], [])
                subclass_levels.update(_feature_levels(items))
                payload_features.append(_feature_payload(feature, items, is_subclass=True))
                for table in parse_markdown_tables(feature["desc"]):
                    if "level" in table["headers"][0].lower() and len(table["headers"]) >= 2:
                        for row in table["rows"]:
                            names = split_list(row[1])
                            prepared_spells.append({
                                "class_level": int(re.search(r"\d+", row[0]).group(0)),
                                "spell_slugs": [slugify(n) for n in names],
                                "spell_names": names,
                            })
            payload_features.sort(key=lambda f: (f["level"], f["name"]))
            subclasses.append({
                "slug": strip_key(sub["pk"]),
                "name": sub["name"],
                "parent_class_slug": slug,
                "parent_class_name": cls["name"],
                "unlock_level": 3,
                "short_description": "",
                "always_prepared_spells": prepared_spells,
                "features": payload_features,
            })

        for f in regular_features:
            f.pop("_levels")
        regular_features.sort(key=lambda f: (f["level"], f["name"]))
        classes.append({
            "slug": slug,
            "name": cls["name"],
            "primary_abilities": primary,
            "primary_ability_logic": "AND" if " and " in primary_text else "OR",
            "hit_point_die": f"d{die}",
            "hp_at_level_1": f"{die} + your Constitution modifier",
            "hp_per_level_after_1st": f"1d{die} (or {die // 2 + 1}) + your Constitution modifier per {cls['name']} level after level 1",
            "saving_throw_proficiencies": [a for a in ABILITIES if a.lower() in cls["saving_throws"]],
            "skill_choices_count": int(count_match.group(1)) if count_match else 2,
            "skill_options": skill_options,
            "weapon_proficiencies": [core["Weapon Proficiencies"]] if core.get("Weapon Proficiencies") else [],
            "tool_proficiencies": [core["Tool Proficiencies"]] if core.get("Tool Proficiencies") else [],
            "armor_training": [] if core.get("Armor Training", "None") == "None" else [core["Armor Training"]],
            "starting_equipment_options": parse_equipment_options(core.get("Starting Equipment", ""), index),
            "multiclassing": _parse_multiclass(multiclass_text.get(slug, ""), primary),
            "spellcasting_ability": spell_ability,
            "spellcasting_focus_type": focus,
            "has_weapon_mastery": "weapon-mastery" in by_suffix,
            "level_table": level_table,
            "features": regular_features,
            "subclass_unlock_level": 3,
            "subclass_feature_levels": sorted(subclass_levels) or [3],
            "subclasses_summary": [{"slug": strip_key(s["pk"]), "name": s["name"]} for s in class_subclasses],
        })
    return classes, subclasses, options


def _parse_feature_options(feature: dict[str, Any], class_slug: str, category: str) -> list[dict[str, Any]]:
    options = []
    for block in re.split(r"^###\s+", feature["desc"], flags=re.M)[1:]:
        name, _, body = block.partition("\n")
        body = body.strip()
        prereq = cost = None
        if m := re.match(r"^\*Prerequisite:\s*(.+?)\*\s*", body):
            prereq = m.group(1).strip()
            body = body[m.end():].strip()
        if m := re.match(r"^\*Cost:\s*(.+?)\*\s*", body):
            cost = m.group(1).strip()
            body = body[m.end():].strip()
        level = int(m.group(1)) if prereq and (m := re.search(r"Level\s+(\d+)\+", prereq)) else 1
        options.append({
            "slug": slugify(name),
            "name": name.strip(),
            "parent_class_slug": class_slug,
            "category": category,
            "level_prerequisite": level,
            "prerequisite_text": prereq,
            "cost_text": cost,
            "description": body,
            "referenced_entities": condition_references(body),
        })
    return options


def build_spells(src: SrdSource) -> list[dict[str, Any]]:
    spells = []
    for s in src.records("Spell"):
        desc = s["desc"]
        lower = desc.lower()
        attack_type = None
        if s["attack_roll"]:
            attack_type = "Melee Spell Attack" if "melee spell attack" in lower else "Ranged Spell Attack" if "ranged spell attack" in lower else "Spell Attack"
        duration = s["duration"][:1].upper() + s["duration"][1:]
        if s["concentration"]:
            duration = f"Concentration, up to {s['duration']}"
        conditions = list(dict.fromkeys(c.capitalize() for c in CONDITION_RE.findall(desc)))
        spells.append({
            "slug": strip_key(s["pk"]),
            "name": s["name"],
            "level": s["level"],
            "school": s["school"].capitalize(),
            "class_lists": [strip_key(c) for c in s["classes"]],
            "casting_time": CASTING_TIMES.get(s["casting_time"], s["casting_time"]),
            "reaction_trigger": s["reaction_condition"],
            "ritual": s["ritual"],
            "range": s["range_text"],
            "area_of_effect": {"type": s["shape_type"].capitalize(), "size_ft": s["shape_size"]} if s["shape_type"] else None,
            "components": {
                "verbal": s["verbal"],
                "somatic": s["somatic"],
                "material": s["material"],
                "material_description": s["material_specified"] or None,
                "material_cost_gp": int(Decimal(s["material_cost"])) if s["material_cost"] else None,
                "material_consumed": bool(s["material_consumed"]),
            },
            "duration": duration,
            "concentration": s["concentration"],
            "saving_throw_ability": ABILITY_BY_NAME.get((s["saving_throw_ability"] or "").lower()),
            "attack_type": attack_type,
            "damage_types": [d.capitalize() for d in s["damage_types"]],
            "conditions_inflicted": conditions,
            "description": desc,
            "higher_levels": s["higher_level"] or None,
            "tables": parse_markdown_tables(desc),
            "referenced_entities": condition_references(desc),
        })
    return spells


def build_weapons(src: SrdSource) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    properties = {p["pk"]: p for p in src.records("WeaponProperty")}
    assignments: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for a in src.records("WeaponPropertyAssignment"):
        assignments[a["weapon"]].append(a)

    masteries = []
    for prop in properties.values():
        if prop["type"] != "Mastery":
            continue
        slug = strip_key(prop["pk"]).removesuffix("-mastery")
        sentence = first_sentence(prop["desc"])
        trigger, _, effect = sentence.partition(", ")
        masteries.append({
            "slug": slug,
            "name": prop["name"].removesuffix(" Mastery"),
            "trigger_condition": trigger[:120],
            "effect_summary": (effect[:1].upper() + effect[1:] if effect else sentence)[:300],
            "description": prop["desc"],
            "compatible_weapons": sorted(
                strip_key(a["weapon"]) for group in assignments.values() for a in group if a["property"] == prop["pk"]
            ),
        })

    weapons = []
    for w in src.records("Weapon"):
        slug = strip_key(w["pk"])
        props, mastery = [], None
        range_normal = range_long = None
        versatile = ammo = None
        has_ammunition = False
        for a in sorted(assignments.get(w["pk"], []), key=lambda a: properties[a["property"]]["name"]):
            prop = properties[a["property"]]
            if prop["type"] == "Mastery":
                mastery = prop
                continue
            detail = a["detail"]
            props.append(f"{prop['name']} ({detail})" if detail else prop["name"])
            if prop["name"] == "Versatile":
                versatile = detail
            if prop["name"] == "Ammunition":
                has_ammunition = True
                if detail and ";" in detail:
                    ammo = detail.split(";", 1)[1].strip()
            if detail and (m := re.search(r"Range\s+(\d+)/(\d+)", detail)):
                range_normal, range_long = int(m.group(1)), int(m.group(2))
        range_type = "Ranged" if has_ammunition or slug in RANGED_WEAPONS_WITHOUT_AMMUNITION else "Melee"
        item = src.items_by_pk.get(w["pk"], {})
        cost_display, cost_cp = cost_from_gp(item.get("cost"))
        weapons.append({
            "slug": slug,
            "name": w["name"],
            "category": f"{'Simple' if w['is_simple'] else 'Martial'} {range_type}",
            "range_type": range_type,
            "damage_dice": w["damage_dice"],
            "damage_type": w["damage_type"].capitalize(),
            "properties": props,
            "range_normal_ft": range_normal,
            "range_long_ft": range_long,
            "versatile_damage_dice": versatile,
            "ammunition_type": ammo,
            "mastery_slug": strip_key(mastery["pk"]).removesuffix("-mastery"),
            "mastery_name": mastery["name"].removesuffix(" Mastery"),
            "weight_lb": weight_lb(item.get("weight")),
            "cost_display": cost_display,
            "cost_cp": cost_cp,
        })
    return weapons, masteries


def build_armor(src: SrdSource) -> list[dict[str, Any]]:
    armors = []
    for a in src.records("Armor"):
        if a["name"] == "Shield":
            category, formula = "Shield", f"+{a['ac_base']}"
        elif not a["ac_add_dexmod"]:
            category, formula = "Heavy Armor", str(a["ac_base"])
        elif a["ac_cap_dexmod"] is not None:
            category, formula = "Medium Armor", f"{a['ac_base']} + Dex modifier (max {a['ac_cap_dexmod']})"
        else:
            category, formula = "Light Armor", f"{a['ac_base']} + Dex modifier"
        item = src.items_by_pk.get(a["pk"], {})
        cost_display, cost_cp = cost_from_gp(item.get("cost"))
        don, doff = ARMOR_DON_DOFF[category]
        armors.append({
            "slug": strip_key(a["pk"]),
            "name": a["name"],
            "category": category,
            "base_ac": a["ac_base"],
            "ac_formula_display": formula,
            "adds_dex_modifier": a["ac_add_dexmod"],
            "max_dex_modifier": a["ac_cap_dexmod"],
            "strength_requirement": a["strength_score_required"],
            "stealth_disadvantage": a["grants_stealth_disadvantage"],
            "don_time": don,
            "doff_time": doff,
            "weight_lb": weight_lb(item.get("weight")),
            "cost_display": cost_display,
            "cost_cp": cost_cp,
        })
    return armors


def _tool_category(name: str) -> str:
    if name.startswith("Gaming Set"):
        return "Gaming Set"
    if name.startswith("Musical Instrument"):
        return "Musical Instrument"
    if name.endswith(("Supplies", "Tools", "Utensils")) and name not in {"Navigator's Tools", "Thieves' Tools"}:
        return "Artisan's Tools"
    return "Other Tools"


def build_tools_and_gear(src: SrdSource) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    tools, gear = [], []
    for item in src.records("Item"):
        if item["weapon"] or item["armor"]:
            continue
        name = re.sub(r"\s*\(\d[\d,]* GP\)$", "", item["name"])
        cost_display, cost_cp = cost_from_gp(item["cost"])
        desc = item["desc"]
        if item["category"] == "tools" and desc.startswith("Ability:"):
            # "Ability: Intelligence. Utilize: Identify a substance (DC 15), or ... Craft: Acid, Oil"
            parts = re.split(r"\s*\b(Ability|Utilize|Craft|Variants?):\s*", desc)
            fields = {parts[k]: parts[k + 1].strip().rstrip(".") for k in range(1, len(parts) - 1, 2)}
            utilize = []
            for action in re.split(r",\s*or\s+|;\s*|,\s*(?=[A-Z])", fields.get("Utilize", "")):
                if m := re.match(r"^(.+?)\s*\(DC\s*(\d+)\)$", action.strip()):
                    action_text = m.group(1).strip()
                    utilize.append({"action_description": action_text[:1].upper() + action_text[1:], "dc": int(m.group(2))})
            craft = [c.strip("*") for c in split_list(fields["Craft"])] if fields.get("Craft") else []
            tools.append({
                "slug": slugify(name),
                "name": name,
                "category": _tool_category(name),
                "ability": ABILITY_BY_NAME[fields["Ability"].lower()],
                "weight_lb": weight_lb(item["weight"]),
                "cost_display": cost_display,
                "cost_cp": cost_cp,
                "utilize_actions": utilize,
                "craftable_items": craft,
                "variants": [],
                "description": desc,
            })
            continue

        pack_contents = []
        if m := re.search(r"contains the following items:\s*(.+?)\.?$", desc, re.S):
            for part in split_list(m.group(1)):
                qty = re.match(r"^(\d+)\s+(?:(?:flasks?|days?|sheets?|pieces?|vials?|bottles?|feet) of\s+)?(.+)$", part)
                item_name = qty.group(2) if qty else part
                pack_contents.append({"item_slug": slugify(item_name), "item_name": item_name, "quantity": int(qty.group(1)) if qty else 1})
        action = re.search(r"\b(?:As an?|take an?|use an?)\s+(Bonus Action|Utilize action|Magic action|Reaction|Action)\b", desc)
        category = "Adventuring Gear" if item["category"] in ("weapon", "tools") else title_from_key(item["category"])
        gear.append({
            "slug": slugify(name),
            "name": name,
            "category": category,
            "weight_lb": weight_lb(item["weight"]),
            "cost_display": cost_display,
            "cost_cp": cost_cp,
            "action_type_required": action.group(1).replace(" action", " Action") if action else None,
            "pack_contents": pack_contents,
            "description": desc,
            "referenced_entities": condition_references(desc),
        })
    return tools, gear


def build_magic_items(src: SrdSource) -> list[dict[str, Any]]:
    items = []
    for m in src.records("MagicItem"):
        desc = m["desc"]
        bonus = re.match(r"^\+(\d)\b", m["name"]) or re.search(r"\s\+(\d)\b", m["name"])
        charges = re.search(r"\b(\d+) charges\b", desc)
        recharge = re.search(r"regains? (.+?) expended charges? daily at dawn", desc)
        base = m["weapon"] or m["armor"]
        items.append({
            "slug": strip_key(m["pk"]),
            "name": m["name"],
            "item_category": title_from_key(m["category"]),
            "rarity": title_from_key(m["rarity"]) if m["rarity"] else "Varies",
            "requires_attunement": m["requires_attunement"],
            "attunement_requirement": m.get("attunement_detail") or None,
            "base_weapon_or_armor_slug": strip_key(base) if base else None,
            "bonus_value": int(bonus.group(1)) if bonus else None,
            "charges_max": int(charges.group(1)) if charges else None,
            "recharge_formula": f"{recharge.group(1)} daily at dawn" if recharge else None,
            "description": desc,
            "referenced_entities": condition_references(desc),
        })
    return items


ATTACK_RE = re.compile(
    r"^(?P<kind>Melee or Ranged|Melee|Ranged) Attack Roll:\s*\+(?P<bonus>\d+),\s*(?P<reach>(?:reach|range) [^.]+?ft\.)\s*(?P<hit>.*)$",
    re.S,
)
SAVE_RE = re.compile(r"^(?P<ability>Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) Saving Throw:\s*DC\s*(?P<dc>\d+)")


def _monster_action(action: dict[str, Any], action_type: str) -> dict[str, Any]:
    desc = action["desc"]
    recharge = None
    if action["uses_type"] == "RECHARGE_ON_ROLL" and action["uses_param"]:
        recharge = f"Recharge {action['uses_param']}–6" if action["uses_param"] < 6 else "Recharge 6"
    elif action["uses_type"] == "PER_DAY" and action["uses_param"]:
        recharge = f"{action['uses_param']}/Day"
    elif action["uses_type"] == "RECHARGE" and (m := re.search(r"\((Recharge [^)]+)\)", action["name"])):
        recharge = m.group(1)
    payload: dict[str, Any] = {"name": action["name"], "recharge": recharge, "action_type": action_type, "description": desc}
    if m := ATTACK_RE.match(desc):
        payload |= {
            "attack_roll_type": f"{m.group('kind')} Attack Roll",
            "attack_bonus": int(m.group("bonus")),
            "reach_or_range": m.group("reach"),
            "hit_or_fail_effect": m.group("hit").removeprefix("Hit:").strip() or None,
        }
    elif m := SAVE_RE.match(desc):
        payload |= {"saving_throw_dc": int(m.group("dc")), "saving_throw_ability": ABILITY_BY_NAME[m.group("ability").lower()]}
    return payload


def build_monsters(src: SrdSource) -> list[dict[str, Any]]:
    actions = src.children("CreatureAction")
    traits = src.children("CreatureTrait")
    monsters = []
    for c in src.records("Creature"):
        cr = float(c["challenge_rating"])
        cr_display = CR_FRACTIONS.get(cr, str(int(cr)))
        abilities = {}
        for name, code in (("strength", "STR"), ("dexterity", "DEX"), ("constitution", "CON"),
                           ("intelligence", "INT"), ("wisdom", "WIS"), ("charisma", "CHA")):
            score = c[f"ability_score_{name}"]
            modifier = (score - 10) // 2
            save = c.get(f"saving_throw_{name}")
            abilities[code] = {"score": score, "modifier": modifier, "saving_throw": save if save is not None else modifier}
        speeds = {}
        for mode in ("walk", "burrow", "climb", "fly", "swim"):
            if c.get(mode):
                speeds[mode] = f"{c[mode]} ft." + (" (hover)" if mode == "fly" and c.get("hover") else "")
        senses: dict[str, Any] = {}
        for sense in ("blindsight", "darkvision", "tremorsense", "truesight"):
            if c.get(f"{sense}_range"):
                senses[sense] = f"{c[f'{sense}_range']} ft."
        senses["passive_perception"] = c["passive_perception"]
        skills = {
            title_from_key(k.removeprefix("skill_bonus_")).replace("Of", "of"): v
            for k, v in c.items()
            if k.startswith("skill_bonus_") and v is not None
        }
        grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for a in sorted(actions.get(c["pk"], []), key=lambda a: a["order_in_statblock"] or 0):
            kind = {"ACTION": "Action", "BONUS_ACTION": "Bonus Action", "REACTION": "Reaction", "LEGENDARY_ACTION": "Legendary Action"}[a["action_type"]]
            grouped[kind].append(_monster_action(a, kind))
        trait_payloads = [{"name": t["name"], "action_type": "Trait", "description": t["desc"]} for t in traits.get(c["pk"], [])]
        all_text = " ".join(x["description"] for group in grouped.values() for x in group)
        monsters.append({
            "slug": strip_key(c["pk"]),
            "name": c["name"],
            "size": [c["size"].capitalize()],
            "creature_type": c["type"].capitalize(),
            "alignment": c["alignment"].title(),
            "armor_class": c["armor_class"],
            "armor_notes": c["armor_detail"] or None,
            "initiative_bonus": c["initiative_bonus"],
            "initiative_passive": 10 + c["initiative_bonus"],
            "hit_points": c["hit_points"],
            "hit_dice_formula": c["hit_dice"] or "",
            "speeds": speeds,
            "abilities": abilities,
            "skills": skills,
            "damage_vulnerabilities": [d.capitalize() for d in c["damage_vulnerabilities"]],
            "damage_resistances": [d.capitalize() for d in c["damage_resistances"]],
            "damage_immunities": [d.capitalize() for d in c["damage_immunities"]],
            "condition_immunities": [d.capitalize() for d in c["condition_immunities"]],
            "senses": senses,
            "languages": [lang.strip() for lang in re.split(r"[;,]", c["languages_desc"] or "") if lang.strip()],
            "challenge_rating": cr_display,
            "cr_numeric": cr,
            "xp": c.get("experience_points_integer") or XP_BY_CR.get(cr, 0),
            "proficiency_bonus": c.get("proficiency_bonus") or (max(2, (int(cr) + 7) // 4) if cr >= 1 else 2),
            "habitat": [title_from_key(e) for e in c.get("environments") or []],
            "traits": trait_payloads,
            "actions": grouped["Action"],
            "bonus_actions": grouped["Bonus Action"],
            "reactions": grouped["Reaction"],
            "legendary_actions": grouped["Legendary Action"],
            "referenced_entities": condition_references(all_text),
        })
    return monsters


# =====================================================================
# 4. IMPORTAÇÃO NO BANCO
# =====================================================================

ENTITY_PIPELINE: list[tuple[str, Any, type[BaseModel]]] = [
    ("weapon_masteries", WeaponMasteryModel, WeaponMasterySchema),
    ("feats", FeatModel, FeatSchema),
    ("classes", ClassModel, ClassSchema),
    ("subclasses", SubclassModel, SubclassSchema),
    ("class_feature_options", ClassFeatureOptionModel, ClassFeatureOptionSchema),
    ("species", SpeciesModel, SpeciesSchema),
    ("backgrounds", BackgroundModel, BackgroundSchema),
    ("spells", SpellModel, SpellSchema),
    ("weapons", WeaponModel, WeaponSchema),
    ("armor", ArmorModel, ArmorSchema),
    ("tools", ToolModel, ToolSchema),
    ("gear", AdventuringGearModel, AdventuringGearSchema),
    ("magic_items", MagicItemModel, MagicItemSchema),
    ("monsters", MonsterModel, MonsterSchema),
    ("rules", RuleGlossaryModel, RuleGlossarySchema),
]


def build_catalog(data_dir: Path = DATA_DIR) -> dict[str, list[dict[str, Any]]]:
    src = SrdSource(data_dir)
    weapons, masteries = build_weapons(src)
    armor = build_armor(src)
    tools, gear = build_tools_and_gear(src)
    index = ItemIndex({"weapons": weapons, "armor": armor, "tools": tools, "gear": gear})
    classes, subclasses, options = build_classes(src, index)
    return {
        "weapon_masteries": masteries,
        "feats": build_feats(src),
        "classes": classes,
        "subclasses": subclasses,
        "class_feature_options": options,
        "species": build_species(src),
        "backgrounds": build_backgrounds(src, index),
        "spells": build_spells(src),
        "weapons": weapons,
        "armor": armor,
        "tools": tools,
        "gear": gear,
        "magic_items": build_magic_items(src),
        "monsters": build_monsters(src),
        "rules": build_rules(src),
    }


def _dedupe_slugs(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: dict[str, int] = {}
    for row in rows:
        slug = row["slug"]
        if slug in seen:
            seen[slug] += 1
            row["slug"] = f"{slug}-{seen[slug]}"
        else:
            seen[slug] = 1
    return rows


def _rows_for_model(rows: Iterable[dict[str, Any]], model_cls: Any, schema_cls: type[BaseModel]) -> list[Any]:
    columns = set(model_cls.__table__.columns.keys())
    objects = []
    for row in rows:
        if "slug" in columns and "source_book" in columns:
            row = {"source_book": SOURCE_BOOK, "source_url": SOURCE_URL, "is_srd": True} | row
        validated = schema_cls.model_validate(row).model_dump(mode="json")
        payload = {k: v for k, v in validated.items() if k in columns}
        if "source_hash" in columns:
            payload["source_hash"] = content_hash(payload)
        objects.append(model_cls(**payload))
    return objects


def import_srd_catalog(session: Session, data_dir: Path = DATA_DIR) -> dict[str, int]:
    """Importa o catálogo completo do SRD 5.2.1. Espera um banco com as tabelas vazias."""
    catalog = build_catalog(data_dir)
    counts: dict[str, int] = {}
    for key, model_cls, schema_cls in ENTITY_PIPELINE:
        objects = _rows_for_model(_dedupe_slugs(catalog[key]), model_cls, schema_cls)
        session.add_all(objects)
        session.flush()
        counts[key] = len(objects)
    session.merge(CatalogMetadataModel(key="import_version", value=IMPORT_VERSION))
    session.merge(CatalogMetadataModel(key="attribution", value=ATTRIBUTION))
    session.merge(CatalogMetadataModel(key="counts", value=json.dumps(counts)))
    session.commit()
    return counts


def current_import_version(session: Session) -> str | None:
    row = session.get(CatalogMetadataModel, "import_version")
    return row.value if row else None
