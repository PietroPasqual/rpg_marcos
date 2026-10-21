"""
Suíte de Testes Automatizados (Pytest) para a API de Catálogo D&D 5e 2024:
importador do SRD 5.2.1, integridade dos dados importados e rotas da API.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from main_api import SessionLocal, app, init_db_and_seed
from schemas_and_models import CatalogMetadataModel
from srd_importer import (
    IMPORT_VERSION,
    ItemIndex,
    build_catalog,
    clean_text,
    cost_from_gp,
    parse_equipment_options,
    parse_markdown_tables,
    split_list,
)

init_db_and_seed(force_reimport=True)
client = TestClient(app)
CATALOG = build_catalog()


# =====================================================================
# 1. TESTES DOS UTILITÁRIOS DO IMPORTADOR
# =====================================================================


def test_markdown_table_with_caption_and_empty_header() -> None:
    text = "Intro.\n\nTable: Life Domain Spells\n\n|Cleric Level|Prepared Spells|\n|---|---|\n|3|Aid, Bless|\n|5|Revivify|"
    [table] = parse_markdown_tables(text)
    assert table == {"caption": "Life Domain Spells", "headers": ["Cleric Level", "Prepared Spells"], "rows": [["3", "Aid, Bless"], ["5", "Revivify"]]}

    [core] = parse_markdown_tables("|||\n|---|---|\n|Primary Ability|Strength|\n|Hit Point Die|D12 per Barbarian level|")
    assert core["rows"][0] == ["Primary Ability", "Strength"]


def test_equipment_options_with_quantities_and_three_choices() -> None:
    options = parse_equipment_options(
        "Choose A, B, or C: (A) Chain Mail, 8 Javelins, Dungeoneer's Pack, and 4 GP; (B) Book (prayers), 11 GP; or (C) 155 GP"
    )
    assert [o["option_label"] for o in options] == ["A", "B", "C"]
    assert options[0]["items"][1] == {"item_slug": "javelins", "item_name": "Javelins", "quantity": 8, "item_type": None, "choose_from": []}
    assert options[0]["gold_gp"] == 4
    assert options[1]["items"][0]["item_name"] == "Book (prayers)"
    assert options[2] == {"option_label": "C", "items": [], "gold_gp": 155}


def test_item_index_resolves_plurals_packs_and_generic_choices() -> None:
    index = ItemIndex({
        "weapons": [{"slug": "handaxe"}, {"slug": "dagger"}, {"slug": "quarterstaff"}],
        "armor": [{"slug": "leather-armor"}],
        "tools": [{"slug": "musical-instrument-lute"}, {"slug": "musical-instrument-flute"}],
        "gear": [{"slug": "arrows-20"}, {"slug": "clothes-travelers"}, {"slug": "book"}, {"slug": "parchment"}, {"slug": "holy-symbol-amulet"}, {"slug": "pouch"}],
    })
    assert index.resolve("Handaxes", 4)["item_slug"] == "handaxe"
    assert index.resolve("Pouches", 2)["item_slug"] == "pouch"
    assert index.resolve("Leather Armor", 1)["item_type"] == "armor"
    assert index.resolve("Travelers' Clothes", 1)["item_slug"] == "clothes-travelers"
    assert (index.resolve("Arrows", 20)["item_slug"], index.resolve("Arrows", 20)["quantity"]) == ("arrows-20", 1)
    assert index.resolve("Book (prayers)", 1)["item_slug"] == "book"
    assert index.resolve("Parchment (10 sheets)", 1)["quantity"] == 10
    assert index.resolve("Arcane Focus (Quarterstaff)", 1)["item_slug"] == "quarterstaff"
    assert index.resolve("Holy Symbol", 1)["choose_from"] == ["holy-symbol-amulet"]
    assert index.resolve("Musical Instrument of your choice", 1)["choose_from"] == ["musical-instrument-flute", "musical-instrument-lute"]
    assert index.resolve("Spellbook", 1)["item_slug"] is None


def test_text_helpers() -> None:
    assert split_list("Insight and Religion") == ["Insight", "Religion"]
    assert split_list("Arcana, History, or Religion") == ["Arcana", "History", "Religion"]
    assert cost_from_gp("15.00") == ("15 GP", 1500)
    assert cost_from_gp("0.10") == ("1 SP", 10)
    assert cost_from_gp("0.01") == ("1 CP", 1)
    assert clean_text("a 20-foot-radius Sphere [Area of Effect]|XPHB|Sphere centered") == "a 20-foot-radius Sphere centered"
    assert clean_text("it has Cover|XPHB|Total Cover against") == "it has Total Cover against"


# =====================================================================
# 2. INTEGRIDADE DO CATÁLOGO IMPORTADO DO SRD 5.2.1
# =====================================================================


def test_catalog_counts_and_version() -> None:
    counts = {key: len(rows) for key, rows in CATALOG.items()}
    assert counts["classes"] == 12
    assert counts["subclasses"] == 12
    assert counts["species"] == 9
    assert counts["backgrounds"] == 4
    assert counts["feats"] == 17
    assert counts["weapon_masteries"] == 8
    assert counts["weapons"] == 38
    assert counts["armor"] == 13
    assert counts["spells"] >= 330
    assert counts["monsters"] >= 320
    assert counts["magic_items"] >= 700
    assert counts["rules"] >= 200
    with SessionLocal() as session:
        assert session.get(CatalogMetadataModel, "import_version").value == IMPORT_VERSION


def test_cross_references_point_to_existing_records() -> None:
    slugs = {key: {row["slug"] for row in rows} for key, rows in CATALOG.items()}
    for spell in CATALOG["spells"]:
        assert set(spell["class_lists"]) <= slugs["classes"], spell["slug"]
    for background in CATALOG["backgrounds"]:
        assert background["origin_feat_slug"] in slugs["feats"]
    for weapon in CATALOG["weapons"]:
        assert weapon["mastery_slug"] in slugs["weapon_masteries"]
    for subclass in CATALOG["subclasses"]:
        assert subclass["parent_class_slug"] in slugs["classes"]
    for rule in CATALOG["rules"]:
        assert set(rule["see_also_slugs"]) <= slugs["rules"], rule["slug"]
        assert all(ref["slug"] in slugs["rules"] for ref in rule.get("referenced_entities", []))
    assert "XPHB" not in str(CATALOG)


def test_starting_equipment_resolves_to_catalog_items() -> None:
    catalog_slugs = {r["slug"] for key in ("weapons", "armor", "tools", "gear") for r in CATALOG[key]}
    unresolved = set()
    for owner in CATALOG["classes"] + CATALOG["backgrounds"]:
        for option in owner.get("starting_equipment_options") or owner["equipment_options"]:
            for item in option["items"]:
                if item["choose_from"]:
                    assert set(item["choose_from"]) <= catalog_slugs, item
                elif item["item_slug"] is None:
                    unresolved.add(item["item_name"])
                else:
                    assert item["item_slug"] in catalog_slugs, item
                    assert item["item_type"] in {"weapon", "armor", "tool", "gear"}
    # Itens que o SRD cita mas não descreve na tabela de equipamentos
    assert unresolved == {"Spellbook", "Arcane Focus (crystal)", "Arcane Focus (orb)"}


def test_tool_proficiency_choices_are_structured() -> None:
    soldier = next(b for b in CATALOG["backgrounds"] if b["slug"] == "soldier")
    assert soldier["tool_slug"] is None
    assert "gaming-set-dice" in soldier["tool_choose_from"]
    acolyte = next(b for b in CATALOG["backgrounds"] if b["slug"] == "acolyte")
    assert (acolyte["tool_slug"], acolyte["tool_choose_from"]) == ("calligraphers-supplies", [])

    classes = {c["slug"]: c for c in CATALOG["classes"]}
    [bard_choice] = classes["bard"]["tool_proficiency_choices"]
    assert bard_choice["count"] == 3
    assert all(s.startswith("musical-instrument-") for s in bard_choice["choose_from"])
    [monk_choice] = classes["monk"]["tool_proficiency_choices"]
    assert monk_choice["count"] == 1
    assert "smiths-tools" in monk_choice["choose_from"] and "musical-instrument-lute" in monk_choice["choose_from"]
    assert classes["rogue"]["tool_proficiency_choices"] == []


def test_species_choices_are_exposed_as_lineages() -> None:
    species = {sp["slug"]: sp for sp in CATALOG["species"]}
    assert [lin["slug"] for lin in species["gnome"]["lineages"]] == ["forest-gnome", "rock-gnome"]
    assert species["gnome"]["lineages"][1]["benefits_by_level"][0]["granted_spells"] == ["mending", "prestidigitation"]
    assert len(species["goliath"]["lineages"]) == 6
    assert len(species["dragonborn"]["lineages"]) == 10
    assert species["dragonborn"]["lineages"][0]["name"] == "Black"
    assert [lin["slug"] for lin in species["tiefling"]["lineages"]] == ["abyssal", "chthonic", "infernal"]
    for slug in ("dwarf", "halfling", "human", "orc"):
        assert species[slug]["lineages"] == []


def test_every_class_has_complete_level_table() -> None:
    for cls in CATALOG["classes"]:
        assert [row["level"] for row in cls["level_table"]] == list(range(1, 21)), cls["slug"]
        assert cls["primary_abilities"], cls["slug"]
        assert cls["level_table"][0]["proficiency_bonus"] == 2
        assert cls["level_table"][19]["proficiency_bonus"] == 6
        assert cls["multiclassing"]["proficiencies_gained"]["description"], cls["slug"]


# =====================================================================
# 3. TESTES DE INTEGRAÇÃO DOS ENDPOINTS FASTAPI (CATÁLOGO V1)
# =====================================================================


def test_health_about_and_classes() -> None:
    assert client.get("/health").json()["status"] == "ok"

    about = client.get("/api/v1/about").json()
    assert about["license"] == "CC-BY-4.0"
    assert "System Reference Document 5.2.1" in about["attribution"]
    assert about["counts"]["classes"] == 12

    mastery_classes = client.get("/api/v1/classes?has_weapon_mastery=true&size=100").json()
    assert {c["slug"] for c in mastery_classes["items"]} == {"barbarian", "fighter", "paladin", "ranger", "rogue"}

    wizard = client.get("/api/v1/classes/wizard").json()
    assert wizard["primary_abilities"] == ["INT"]
    assert wizard["spellcasting_ability"] == "INT"
    assert wizard["skill_options"].count("Insight") == 1

    lvl5 = client.get("/api/v1/classes/wizard/levels/5").json()
    assert lvl5["spellcasting"]["slots_by_level"] == {"1": 4, "2": 3, "3": 2}
    assert lvl5["proficiency_bonus"] == 3

    warlock11 = client.get("/api/v1/classes/warlock/levels/11").json()
    assert warlock11["spellcasting"]["pact_slots_count"] == 3
    assert warlock11["spellcasting"]["pact_slot_level"] == 5

    barbarian1 = client.get("/api/v1/classes/barbarian/levels/1").json()
    assert barbarian1["class_specific_columns"]["rages"] == 2
    assert barbarian1["weapon_masteries_known"] == 2
    assert "Rage" in barbarian1["feature_names"]

    subclasses = client.get("/api/v1/classes/barbarian/subclasses").json()
    assert [s["slug"] for s in subclasses] == ["path-of-the-berserker"]

    life = client.get("/api/v1/subclasses/life-domain").json()
    assert life["always_prepared_spells"][0]["spell_slugs"] == ["aid", "bless", "cure-wounds", "lesser-restoration"]


def test_subclass_listing() -> None:
    everything = client.get("/api/v1/subclasses?size=100").json()
    assert everything["meta"]["total"] == 12
    wizard = client.get("/api/v1/subclasses?class_slug=wizard").json()
    assert [s["slug"] for s in wizard["items"]] == ["evoker"]


def test_origins_and_feats() -> None:
    bg = client.get("/api/v1/backgrounds/acolyte").json()
    assert bg["ability_scores"] == ["INT", "WIS", "CHA"]
    assert bg["origin_feat_slug"] == "magic-initiate"
    assert bg["skill_proficiencies"] == ["Insight", "Religion"]
    assert [o["gold_gp"] for o in bg["equipment_options"]] == [8, 50]

    elf = client.get("/api/v1/species/elf")
    assert elf.status_code == 200
    assert "ETag" in elf.headers
    assert [lin["slug"] for lin in elf.json()["lineages"]] == ["drow", "high-elf", "wood-elf"]

    grappler = client.get("/api/v1/feats/grappler").json()
    assert grappler["category"] == "General"
    assert grappler["level_prerequisite"] == 4
    assert grappler["ability_score_increase_options"] == ["STR", "DEX"]

    epic = client.get("/api/v1/feats?category=Epic%20Boon&size=100").json()
    assert epic["meta"]["total"] == 7
    assert all(f["level_prerequisite"] == 19 for f in epic["items"])


def test_spells_and_filters() -> None:
    fireball = client.get("/api/v1/spells/fireball").json()
    assert fireball["level"] == 3
    assert fireball["school"] == "Evocation"
    assert fireball["area_of_effect"] == {"type": "Sphere", "size_ft": 20}
    assert fireball["saving_throw_ability"] == "DEX"
    assert fireball["damage_types"] == ["Fire"]

    guardians = client.get("/api/v1/spells/spirit-guardians").json()
    assert guardians["concentration"] is True
    assert guardians["duration"] == "Concentration, up to 10 minutes"

    wizard_cantrips = client.get("/api/v1/spells?level=0&class_slug=wizard&size=100").json()
    assert wizard_cantrips["meta"]["total"] >= 10
    assert "fire-bolt" in [s["slug"] for s in wizard_cantrips["items"]]

    evocation3 = client.get("/api/v1/spells?level=3&school=Evocation&size=100").json()
    assert "fireball" in [s["slug"] for s in evocation3["items"]]


def test_equipment_monsters_rules_and_omnisearch() -> None:
    masteries = client.get("/api/v1/equipment/weapon-masteries").json()
    assert len(masteries) == 8
    assert "longsword" in next(m for m in masteries if m["slug"] == "sap")["compatible_weapons"]

    longsword = client.get("/api/v1/equipment/weapons/longsword").json()
    assert longsword["mastery_slug"] == "sap"
    assert longsword["versatile_damage_dice"] == "1d10"
    assert longsword["cost_cp"] == 1500

    longbow = client.get("/api/v1/equipment/weapons/longbow").json()
    assert (longbow["range_type"], longbow["range_normal_ft"], longbow["range_long_ft"]) == ("Ranged", 150, 600)

    chain = client.get("/api/v1/equipment/armor/chain-mail").json()
    assert (chain["category"], chain["base_ac"], chain["strength_requirement"]) == ("Heavy Armor", 16, 13)

    thieves = client.get("/api/v1/equipment/tools/thieves-tools").json()
    assert thieves["ability"] == "DEX"
    assert thieves["utilize_actions"][0] == {"action_description": "Pick a lock", "dc": 15}

    pack = client.get("/api/v1/equipment/gear/explorers-pack").json()
    assert {"item_slug": "rations", "item_name": "Rations", "quantity": 10} in pack["pack_contents"]

    owlbear = client.get("/api/v1/monsters/owlbear").json()
    assert owlbear["challenge_rating"] == "3"
    assert owlbear["xp"] == 700
    assert owlbear["initiative_passive"] == 11
    assert owlbear["abilities"]["STR"] == {"score": 20, "modifier": 5, "saving_throw": 5}

    dragon = client.get("/api/v1/monsters/adult-red-dragon").json()
    breath = next(a for a in dragon["actions"] if a["name"] == "Fire Breath")
    assert breath["recharge"] == "Recharge 5–6"
    assert (breath["saving_throw_ability"], breath["saving_throw_dc"]) == ("DEX", 21)
    assert dragon["legendary_actions"]

    exhaustion = client.get("/api/v1/rules/exhaustion").json()
    assert exhaustion["tag"] == "Condition"
    assert len(exhaustion["bullet_effects"]) == 4

    conditions = client.get("/api/v1/rules?tag=Condition&size=100").json()
    assert conditions["meta"]["total"] == 15

    bag = client.get("/api/v1/magic-items/bag-of-holding").json()
    assert (bag["rarity"], bag["item_category"]) == ("Uncommon", "Wondrous Item")

    search = client.get("/api/v1/search?q=fire").json()
    assert search["total_matches"] >= 1
    assert "spells" in search["results_by_type"]


def test_rfc7807_not_found_with_fuzzy_suggestions() -> None:
    not_found = client.get("/api/v1/spells/firebal")
    assert not_found.status_code == 404
    body = not_found.json()
    assert body["title"] == "Resource Not Found"
    assert "fireball" in body["suggestions"]


def test_every_list_endpoint_and_sample_details() -> None:
    routes = [
        "classes", "class-feature-options", "species", "backgrounds", "feats", "spells", "equipment/weapons",
        "equipment/armor", "equipment/tools", "equipment/gear", "magic-items", "monsters", "rules",
    ]
    for route in routes:
        listing = client.get(f"/api/v1/{route}?size=100")
        assert listing.status_code == 200, route
        items = listing.json()["items"]
        assert items, route
        for item in items[:: max(1, len(items) // 10)]:
            assert client.get(f"/api/v1/{route}/{item['slug']}").status_code == 200, (route, item["slug"])


# =====================================================================
# 4. TESTES DE REGRESSÃO: PAGINAÇÃO, CACHE, ERROS E BUSCA
# =====================================================================


def test_json_filters_are_applied_before_pagination() -> None:
    # Antecedentes do SRD com INT: acolyte, criminal, sage (3 no total), 1 por página
    page2 = client.get("/api/v1/backgrounds?ability=INT&size=1&page=2").json()
    assert page2["meta"]["total"] == 3
    assert page2["meta"]["pages"] == 3
    assert page2["meta"]["has_next"] is True
    assert [b["slug"] for b in page2["items"]] == ["criminal"]

    all_sorcerer = client.get("/api/v1/spells?class_slug=sorcerer&size=100").json()
    paged = client.get("/api/v1/spells?class_slug=sorcerer&size=10&page=2").json()
    assert paged["meta"]["total"] == all_sorcerer["meta"]["total"] > 100
    assert [s["slug"] for s in paged["items"]] == [s["slug"] for s in all_sorcerer["items"][10:20]]

    empty_page = client.get("/api/v1/backgrounds?ability=INT&size=1&page=9").json()
    assert empty_page["meta"]["total"] == 3
    assert empty_page["items"] == []


def test_etag_if_none_match_returns_304() -> None:
    first = client.get("/api/v1/spells/fireball")
    etag = first.headers["ETag"]
    cached = client.get("/api/v1/spells/fireball", headers={"If-None-Match": etag})
    assert cached.status_code == 304
    assert cached.headers["ETag"] == etag
    assert cached.content == b""

    stale = client.get("/api/v1/spells/fireball", headers={"If-None-Match": 'W/"outdated"'})
    assert stale.status_code == 200


def test_all_errors_use_rfc7807_problem_details() -> None:
    out_of_range_level = client.get("/api/v1/classes/barbarian/levels/21")
    assert out_of_range_level.status_code == 422
    assert out_of_range_level.headers["content-type"].startswith("application/problem+json")

    invalid = client.get("/api/v1/spells?level=42")
    assert invalid.status_code == 422
    assert invalid.headers["content-type"].startswith("application/problem+json")
    body = invalid.json()
    assert body["title"] == "Invalid Request Parameters"
    assert body["errors"][0]["loc"] == ["query", "level"]

    unknown_route = client.get("/api/v1/does-not-exist")
    assert unknown_route.status_code == 404
    assert unknown_route.headers["content-type"].startswith("application/problem+json")

    assert client.get("/api/v1/bastion-facilities").status_code == 404


def test_like_wildcards_are_literal_and_search_covers_all_types() -> None:
    assert client.get("/api/v1/spells?q=%25").json()["meta"]["total"] == 0
    literal_underscore = sum(1 for s in CATALOG["spells"] if "_" in s["name"] + s["description"])
    assert client.get("/api/v1/spells?q=_&size=1").json()["meta"]["total"] == literal_underscore < len(CATALOG["spells"])

    search = client.get("/api/v1/search?q=bag%20of%20holding").json()
    assert "magic_items" in search["results_by_type"]
    assert search["results_by_type"]["magic_items"][0]["api_path"] == "/api/v1/magic-items/bag-of-holding"

    assert client.get("/api/v1/search?q=%20%20%20").status_code == 422


def test_built_web_app_is_served_without_shadowing_the_api(tmp_path) -> None:
    from pathlib import Path

    from fastapi import FastAPI

    from main_api import mount_web_app

    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text("<title>site</title>")
    probe = FastAPI()

    @probe.get("/api/v1/ping")
    def ping() -> dict[str, str]:
        return {"ok": "api"}

    assert mount_web_app(probe, dist) is True
    site = TestClient(probe)
    assert site.get("/").text == "<title>site</title>"
    assert site.get("/api/v1/ping").json() == {"ok": "api"}  # a API não é sobreposta pelo site
    assert mount_web_app(FastAPI(), Path(tmp_path / "nao-existe")) is False
    # A API real continua respondendo em /health e /docs, com ou sem site compilado
    assert client.get("/health").status_code == 200
    assert client.get("/docs").status_code == 200


def test_cors_allows_public_read_only_access() -> None:
    preflight = client.options(
        "/api/v1/spells",
        headers={"Origin": "http://example.com", "Access-Control-Request-Method": "GET"},
    )
    assert preflight.status_code == 200
    assert preflight.headers["access-control-allow-origin"] == "*"
    assert "access-control-allow-credentials" not in preflight.headers
