"""
Baixa (ou atualiza) os dados do SRD 5.2.1 usados pelo importador do catálogo:

1. Os arquivos estruturados do documento "srd-2024" do projeto Open5e
   (https://github.com/open5e/open5e-api, pasta data/v2/wizards-of-the-coast/srd-2024).
2. O PDF oficial do SRD 5.2.1 da Wizards of the Coast, do qual são extraídos o
   Glossário de Regras e as proficiências de multiclasse (scripts/extract_srd_pdf.py).

Uso:
  python scripts/download_srd_data.py              # baixa tudo e regenera data/srd_5_2_1/
  python scripts/download_srd_data.py --skip-pdf   # só os arquivos do Open5e
Depois, reimporte o banco com: python sync_srd_cli.py --reimport
"""

from __future__ import annotations

import argparse
import subprocess
import sys
import tempfile
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data" / "srd_5_2_1"
OPEN5E_DIR = DATA_DIR / "open5e"
OPEN5E_BASE_URL = "https://raw.githubusercontent.com/open5e/open5e-api/main/data/v2/wizards-of-the-coast/srd-2024"
SRD_PDF_URL = "https://media.dndbeyond.com/compendium-images/srd/5.2/SRD_CC_v5.2.1.pdf"

OPEN5E_FILES = [
    "Document",
    "Background",
    "BackgroundBenefit",
    "CharacterClass",
    "ClassFeature",
    "ClassFeatureItem",
    "Creature",
    "CreatureAction",
    "CreatureActionAttack",
    "CreatureTrait",
    "Feat",
    "FeatBenefit",
    "Item",
    "ItemCategory",
    "MagicItem",
    "Species",
    "SpeciesTrait",
    "Spell",
    "SpellCastingOption",
    "Weapon",
    "Armor",
    "WeaponProperty",
    "WeaponPropertyAssignment",
]


def download(client: httpx.Client, url: str, dest: Path) -> None:
    response = client.get(url, follow_redirects=True, timeout=120.0)
    response.raise_for_status()
    dest.write_bytes(response.content)
    print(f"[OK] {dest.relative_to(ROOT) if dest.is_relative_to(ROOT) else dest} ({len(response.content):,} bytes)")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--skip-pdf", action="store_true", help="Não baixa o PDF nem regenera o extrato do glossário")
    args = parser.parse_args()

    OPEN5E_DIR.mkdir(parents=True, exist_ok=True)
    with httpx.Client(headers={"User-Agent": "DnD5e2024CatalogAPI/2.0"}) as client:
        for name in OPEN5E_FILES:
            download(client, f"{OPEN5E_BASE_URL}/{name}.json", OPEN5E_DIR / f"{name}.json")

        if args.skip_pdf:
            return
        with tempfile.TemporaryDirectory() as tmp:
            pdf_path = Path(tmp) / "SRD_CC_v5.2.1.pdf"
            download(client, SRD_PDF_URL, pdf_path)
            subprocess.run(
                [sys.executable, str(ROOT / "scripts" / "extract_srd_pdf.py"), str(pdf_path), str(DATA_DIR / "srd_pdf_extract.json")],
                check=True,
            )


if __name__ == "__main__":
    main()
