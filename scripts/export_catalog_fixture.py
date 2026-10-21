"""
Exporta o catálogo, com o mesmo formato que o front-end carrega da API, para os testes do montador de ficha
(web/src/test/catalog.fixture.json). Os textos longos são esvaziados, exceto os que a lógica de regras lê.

Uso: python scripts/export_catalog_fixture.py
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
os.environ["DATABASE_URL"] = f"sqlite:///{Path(tempfile.mkdtemp()) / 'fixture.db'}"

from fastapi.testclient import TestClient  # noqa: E402

from main_api import app, init_db_and_seed  # noqa: E402

OUTPUT = ROOT / "web" / "src" / "test" / "catalog.fixture.json"
# Textos que o cálculo da ficha lê (não podem ser esvaziados).
KEEP_FEATURES = {"Divine Order", "Primal Order"}


def get_all(client: TestClient, path: str) -> list[dict]:
    items, page = [], 1
    while True:
        body = client.get(f"{path}?size=100&page={page}").json()
        items += body["items"]
        if not body["meta"]["has_next"]:
            return items
        page += 1


def slim(catalog: dict) -> dict:
    for spell in catalog["spells"]:
        spell["description"], spell["higher_levels"] = "", None
    for feat in catalog["feats"]:
        feat["description"] = ""
        for benefit in feat["benefits"]:
            benefit["description"] = ""
    for key in ("gear", "tools"):
        for item in catalog[key]:
            item["description"] = ""
    for option in catalog["featureOptions"]:
        option["description"] = ""
    for cls in catalog["classes"]:
        for feature in cls["features"]:
            if feature["name"] not in KEEP_FEATURES:
                feature["description"], feature["tables"] = "", []
        cls["starting_equipment_options"] = cls["starting_equipment_options"]
    for sub in catalog["subclasses"]:
        for feature in sub["features"]:
            feature["description"], feature["tables"] = "", []
    return catalog


def main() -> None:
    init_db_and_seed()
    client = TestClient(app)
    about = client.get("/api/v1/about").json()
    catalog = {
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
    }
    OUTPUT.write_text(json.dumps(slim(catalog), ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"[OK] {OUTPUT.relative_to(ROOT)} ({OUTPUT.stat().st_size / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
