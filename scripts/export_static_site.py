"""
Exporta o catálogo para arquivos JSON estáticos em web/public/data/, para publicar o site em hospedagem
estática (GitHub Pages) sem rodar a API. O site os lê quando compilado com VITE_STATIC_DATA=1.

Uso: python scripts/export_static_site.py
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
os.environ["DATABASE_URL"] = f"sqlite:///{Path(tempfile.mkdtemp()) / 'static_site.db'}"

from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import select  # noqa: E402

import main_api  # noqa: E402
from main_api import app, init_db_and_seed  # noqa: E402

OUTPUT = ROOT / "web" / "public" / "data"

# Mesmos tipos e mesma ordem da busca global da API (omni_search).
SEARCHABLE = [
    ("spells", "SpellModel"),
    ("feats", "FeatModel"),
    ("classes", "ClassModel"),
    ("subclasses", "SubclassModel"),
    ("class_feature_options", "ClassFeatureOptionModel"),
    ("species", "SpeciesModel"),
    ("backgrounds", "BackgroundModel"),
    ("weapons", "WeaponModel"),
    ("armor", "ArmorModel"),
    ("tools", "ToolModel"),
    ("gear", "AdventuringGearModel"),
    ("magic_items", "MagicItemModel"),
    ("monsters", "MonsterModel"),
    ("rules", "RuleGlossaryModel"),
]


def get_all(client: TestClient, path: str) -> list[dict]:
    items, page = [], 1
    separator = "&" if "?" in path else "?"
    while True:
        response = client.get(f"{path}{separator}size=100&page={page}")
        response.raise_for_status()
        body = response.json()
        items += body["items"]
        if not body["meta"]["has_next"]:
            return items
        page += 1


def write(name: str, data: Any) -> None:
    path = OUTPUT / name
    path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"[OK] web/public/data/{name} ({path.stat().st_size / 1024:.0f} KB)")


def search_index() -> list[dict]:
    index: list[dict] = []
    with main_api.SessionLocal() as session:
        for type_key, model_name in SEARCHABLE:
            model = getattr(main_api, model_name)
            for row in session.execute(select(model).order_by(model.name.asc())).scalars():
                summary = getattr(row, "summary", None) or getattr(row, "short_description", None) or (getattr(row, "description", None) or "")[:140]
                index.append({"t": type_key, "s": row.slug, "n": row.name, "d": summary})
    return index


def main() -> None:
    init_db_and_seed()
    client = TestClient(app)
    OUTPUT.mkdir(parents=True, exist_ok=True)

    about = client.get("/api/v1/about").json()
    write(
        "catalog.json",
        {
            "classes": get_all(client, "/api/v1/classes"),
            "subclasses": get_all(client, "/api/v1/subclasses"),
            "species": get_all(client, "/api/v1/species"),
            "backgrounds": get_all(client, "/api/v1/backgrounds"),
            "feats": get_all(client, "/api/v1/feats"),
            "spells": get_all(client, "/api/v1/spells"),
            "weapons": get_all(client, "/api/v1/equipment/weapons"),
            "armor": get_all(client, "/api/v1/equipment/armor"),
            "tools": get_all(client, "/api/v1/equipment/tools"),
            "gear": get_all(client, "/api/v1/equipment/gear"),
            "masteries": client.get("/api/v1/equipment/weapon-masteries").json(),
            "featureOptions": get_all(client, "/api/v1/class-feature-options"),
            "attribution": about["attribution"],
            "importVersion": about["import_version"],
        },
    )
    write("monsters.json", get_all(client, "/api/v1/monsters"))
    write("magic-items.json", get_all(client, "/api/v1/magic-items"))
    write("glossary.json", get_all(client, "/api/v1/rules?book=false"))

    toc = client.get("/api/v1/rules/toc").json()
    write("rules-toc.json", toc)
    from urllib.parse import quote

    write("rules-book.json", {part["name"]: get_all(client, f"/api/v1/rules?part={quote(part['name'])}") for part in toc["parts"]})
    write("search-index.json", search_index())


if __name__ == "__main__":
    main()
