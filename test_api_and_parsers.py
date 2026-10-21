"""
Suíte de Testes Automatizados (Pytest) para a API de Catálogo D&D 5e 2024
e para os Parsers HTML do Wikidot (BeautifulSoup4).
"""

from __future__ import annotations

from bs4 import BeautifulSoup
from fastapi.testclient import TestClient

from main_api import app, init_db_and_seed
from wikidot_etl_scraper import (
    extract_wikidot_spell_index_links,
    parse_wikidot_background_detail,
    parse_wikidot_class_progression_table,
    parse_wikidot_feat_detail,
    parse_wikidot_spell_detail,
)

# Inicializa o banco SQLite local e o seed de 2024 antes dos testes
init_db_and_seed()
client = TestClient(app)


# =====================================================================
# 1. TESTES DOS PARSERS HTML DO WIKIDOT (FIXTURES REAIS DO DOM WIKIDOT)
# =====================================================================


def test_parse_wikidot_spell_index_yui_tabs() -> None:
    html = """
    <div id="page-content">
      <div class="yui-navset">
        <ul class="yui-nav">
          <li class="selected"><a href="#wiki-tab-0-0"><em>Cantrip</em></a></li>
          <li><a href="#wiki-tab-0-1"><em>1st Level</em></a></li>
        </ul>
        <div class="yui-content">
          <div id="wiki-tab-0-0">
            <table class="wiki-content-table">
              <tr><th>Spell Name</th><th>School</th></tr>
              <tr><td><a href="/spell:sorcerous-burst">Sorcerous Burst</a></td><td>Evocation</td></tr>
            </table>
          </div>
          <div id="wiki-tab-0-1">
            <table class="wiki-content-table">
              <tr><th>Spell Name</th><th>School</th></tr>
              <tr><td><a href="/spell:cure-wounds">Cure Wounds</a></td><td>Abjuration</td></tr>
            </table>
          </div>
        </div>
      </div>
    </div>
    """
    links = extract_wikidot_spell_index_links(html)
    assert len(links) == 2
    assert links[0]["slug"] == "sorcerous-burst"
    assert links[0]["level"] == 0
    assert links[1]["slug"] == "cure-wounds"
    assert links[1]["level"] == 1


def test_parse_wikidot_spell_detail_emanation_and_refs() -> None:
    html = """
    <div id="page-title">Spirit Guardians</div>
    <div id="page-content">
      <p><em>Source: Player's Handbook (2024)</em></p>
      <p><em>Level 3 Conjuration (Cleric)</em></p>
      <p><strong>Casting Time:</strong> Action<br/>
      <strong>Range:</strong> Self (15-foot Emanation)<br/>
      <strong>Components:</strong> V, S, M (a prayer scroll)<br/>
      <strong>Duration:</strong> Concentration, up to 10 minutes</p>
      <p>Protective spirits flit around you in a 15-foot Emanation. A target makes a Wisdom saving throw, taking 3d8 Radiant damage or <a href="/condition:prone">Prone</a>.</p>
      <p><strong>Using a Higher-Level Spell Slot.</strong> The damage increases by 1d8 for each spell slot level above 3.</p>
    </div>
    """
    spell = parse_wikidot_spell_detail(html, "spirit-guardians", "http://dnd2024.wikidot.com/spell:spirit-guardians")
    assert spell.name == "Spirit Guardians"
    assert spell.level == 3
    assert spell.school.value == "Conjuration"
    assert spell.class_lists == ["cleric"]
    assert spell.concentration is True
    assert spell.area_of_effect == {"type": "Emanation", "size_ft": 15}
    assert spell.saving_throw_ability == "WIS"
    assert any(d.value == "Radiant" for d in spell.damage_types)
    assert len(spell.referenced_entities) == 1
    assert spell.referenced_entities[0].slug == "prone"


def test_parse_wikidot_class_table_with_colspan_and_weapon_mastery() -> None:
    html = """
    <table class="wiki-content-table">
      <tr>
        <th colspan="6">The Barbarian</th>
      </tr>
      <tr>
        <th>Level</th>
        <th>Proficiency Bonus</th>
        <th>Class Features</th>
        <th>Rages</th>
        <th>Rage Damage</th>
        <th>Weapon Mastery</th>
      </tr>
      <tr>
        <td>1st</td>
        <td>+2</td>
        <td>Rage, Unarmored Defense, Weapon Mastery</td>
        <td>2</td>
        <td>+2</td>
        <td>2</td>
      </tr>
      <tr>
        <td>3rd</td>
        <td>+2</td>
        <td>Barbarian Subclass, Primal Knowledge</td>
        <td>3</td>
        <td>+2</td>
        <td>2</td>
      </tr>
    </table>
    """
    soup = BeautifulSoup(html, "lxml")
    table = soup.find("table")
    assert table is not None
    rows = parse_wikidot_class_progression_table(table)
    assert len(rows) == 2
    assert rows[0].level == 1
    assert rows[0].weapon_masteries_known == 2
    assert rows[0].class_specific_columns["rages"] == 2
    assert "weapon-mastery" in rows[0].feature_slugs


def test_parse_wikidot_feat_and_background_2024() -> None:
    feat_html = """
    <div id="page-title">Grappler</div>
    <div id="page-content">
      <p><em>Source: Player's Handbook (2024)</em></p>
      <p><em>General Feat (Prerequisite: Level 4+, Strength or Dexterity 13+)</em></p>
      <p>You gain the following benefits.</p>
      <p><strong><em>Ability Score Increase.</em></strong> Increase your Strength or Dexterity score by 1, to a maximum of 20.</p>
      <p><strong><em>Punch and Grab.</em></strong> When you hit a creature with an Unarmed Strike, you can use both Damage and Grapple.</p>
    </div>
    """
    feat = parse_wikidot_feat_detail(feat_html, "grappler", "http://dnd2024.wikidot.com/feat:grappler")
    assert feat.category.value == "General"
    assert feat.level_prerequisite == 4
    assert [a.value for a in feat.ability_score_increase_options] == ["STR", "DEX"]
    assert len(feat.benefits) == 2

    bg_html = """
    <div id="page-title">Soldier</div>
    <div id="page-content">
      <p><em>Source: Player's Handbook (2024)</em></p>
      <p><strong>Ability Scores:</strong> Strength, Dexterity, Constitution<br/>
      <strong>Feat:</strong> Savage Attacker<br/>
      <strong>Skill Proficiencies:</strong> Athletics and Intimidation<br/>
      <strong>Tool Proficiency:</strong> Gaming Set<br/>
      <strong>Equipment:</strong> Choose A or B: (A) Spear, Shortbow, 14 GP; or (B) 50 GP</p>
      <p>You began training for war as soon as you reached adulthood.</p>
    </div>
    """
    bg = parse_wikidot_background_detail(bg_html, "soldier", "http://dnd2024.wikidot.com/background:soldier")
    assert [a.value for a in bg.ability_scores] == ["STR", "DEX", "CON"]
    assert bg.origin_feat_slug == "savage-attacker"
    assert bg.skill_proficiencies == ["Athletics", "Intimidation"]
    assert len(bg.equipment_options) == 2
    assert bg.equipment_options[1].gold_gp == 50


# =====================================================================
# 2. TESTES DE INTEGRAÇÃO DOS ENDPOINTS FASTAPI (CATÁLOGO V1)
# =====================================================================


def test_health_and_classes_endpoints() -> None:
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"

    classes_resp = client.get("/api/v1/classes?has_weapon_mastery=true")
    assert classes_resp.status_code == 200
    data = classes_resp.json()
    assert data["meta"]["total"] >= 1
    assert data["items"][0]["slug"] == "barbarian"

    lvl_resp = client.get("/api/v1/classes/barbarian/levels/3")
    assert lvl_resp.status_code == 200
    assert "Barbarian Subclass" in lvl_resp.json()["feature_names"]

    sub_resp = client.get("/api/v1/classes/barbarian/subclasses")
    assert sub_resp.status_code == 200
    assert sub_resp.json()[0]["slug"] == "path-of-the-berserker"


def test_origins_feats_and_spells_filters() -> None:
    bg_resp = client.get("/api/v1/backgrounds?ability=INT")
    assert bg_resp.status_code == 200
    slugs = [b["slug"] for b in bg_resp.json()["items"]]
    assert "acolyte" in slugs
    assert "sage" in slugs

    elf_resp = client.get("/api/v1/species/elf")
    assert elf_resp.status_code == 200
    assert len(elf_resp.json()["lineages"]) == 3
    assert "ETag" in elf_resp.headers

    spells_resp = client.get("/api/v1/spells?level=0&class_slug=sorcerer")
    assert spells_resp.status_code == 200
    assert spells_resp.json()["items"][0]["slug"] == "sorcerous-burst"


def test_equipment_monsters_bastions_rules_and_omnisearch() -> None:
    wm_resp = client.get("/api/v1/equipment/weapon-masteries")
    assert wm_resp.status_code == 200
    assert len(wm_resp.json()) == 8

    w_resp = client.get("/api/v1/equipment/weapons?mastery=sap")
    assert w_resp.status_code == 200
    assert w_resp.json()["items"][0]["slug"] == "longsword"

    t_resp = client.get("/api/v1/equipment/tools/thieves-tools")
    assert t_resp.status_code == 200
    assert t_resp.json()["utilize_actions"][0]["dc"] == 15

    m_resp = client.get("/api/v1/monsters/owlbear")
    assert m_resp.status_code == 200
    assert m_resp.json()["initiative_passive"] == 11

    r_resp = client.get("/api/v1/rules/exhaustion")
    assert r_resp.status_code == 200
    assert r_resp.json()["tag"] == "Condition"

    search_resp = client.get("/api/v1/search?q=fire")
    assert search_resp.status_code == 200
    assert search_resp.json()["total_matches"] >= 1


def test_rfc7807_not_found_with_fuzzy_suggestions() -> None:
    not_found = client.get("/api/v1/spells/firebal")
    assert not_found.status_code == 404
    body = not_found.json()
    assert body["title"] == "Resource Not Found"
    assert "fireball" in body["suggestions"]