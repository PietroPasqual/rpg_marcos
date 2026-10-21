"""
CLI para manter o catálogo do SRD 5.2.1 no banco local (SQLite ou PostgreSQL).

Exemplos de uso:
  python sync_srd_cli.py              # cria/atualiza o banco se o importador mudou de versão
  python sync_srd_cli.py --reimport   # apaga e reimporta todo o catálogo
  python sync_srd_cli.py --download   # baixa os dados mais recentes (Open5e + PDF do SRD) e reimporta
  python sync_srd_cli.py --stats      # mostra a contagem de registros por entidade
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

from main_api import SessionLocal, init_db_and_seed
from schemas_and_models import CatalogMetadataModel

ROOT = Path(__file__).resolve().parent


def print_stats() -> None:
    with SessionLocal() as session:
        version = session.get(CatalogMetadataModel, "import_version")
        counts = session.get(CatalogMetadataModel, "counts")
    print(f"Versão do importador: {version.value if version else '-'}")
    for key, total in (json.loads(counts.value) if counts else {}).items():
        print(f"  {key:<24}{total:>6}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Sincroniza o catálogo D&D 5e (SRD 5.2.1) com o banco local")
    parser.add_argument("--download", action="store_true", help="Baixa os dados de origem antes de reimportar")
    parser.add_argument("--skip-pdf", action="store_true", help="Com --download: não baixa o PDF do SRD")
    parser.add_argument("--reimport", action="store_true", help="Recria todas as tabelas e reimporta o catálogo")
    parser.add_argument("--stats", action="store_true", help="Mostra a contagem de registros por entidade")
    args = parser.parse_args()

    if args.download:
        cmd = [sys.executable, str(ROOT / "scripts" / "download_srd_data.py")] + (["--skip-pdf"] if args.skip_pdf else [])
        subprocess.run(cmd, check=True)

    counts = init_db_and_seed(force_reimport=args.reimport or args.download)
    if counts is None:
        print("[OK] Banco de dados já está atualizado com o catálogo do SRD 5.2.1.")
    else:
        print(f"[OK] Catálogo do SRD 5.2.1 importado: {sum(counts.values())} registros.")
    if args.stats or counts is not None:
        print_stats()


if __name__ == "__main__":
    main()
