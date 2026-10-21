"""
Script CLI para sincronizar páginas do Wikidot (http://dnd2024.wikidot.com)
para o cache HTML local (data/raw_html/) e atualizar o banco de dados SQLite/PostgreSQL.

Exemplos de uso:
  python sync_wikidot_cli.py --seed-only
  python sync_wikidot_cli.py --spell fireball
  python sync_wikidot_cli.py --feat alert
  python sync_wikidot_cli.py --background acolyte
  python sync_wikidot_cli.py --sync-spells-index
"""

from __future__ import annotations

import argparse
import asyncio
import os
import httpx
from sqlalchemy import select

from main_api import SessionLocal, init_db_and_seed
from schemas_and_models import BackgroundModel, FeatModel, SpellModel
from wikidot_etl_scraper import (
    WikidotCrawler,
    extract_wikidot_spell_index_links,
    parse_wikidot_background_detail,
    parse_wikidot_feat_detail,
    parse_wikidot_spell_detail,
)


async def sync_single_spell(crawler: WikidotCrawler, slug: str, force: bool = False) -> None:
    page_path = f"spell:{slug}"
    async with httpx.AsyncClient(headers={"User-Agent": "DnD5e2024CatalogCLI/1.0"}) as client:
        html, html_hash = await crawler.fetch_page(client, "spells", page_path, force_refresh=force)
        source_url = f"{crawler.base_url}/{page_path}"
        parsed = parse_wikidot_spell_detail(html, slug, source_url)

    with SessionLocal() as session:
        existing = session.execute(select(SpellModel).where(SpellModel.slug == slug)).scalar_one_or_none()
        payload = parsed.model_dump()
        payload["raw_html_hash"] = html_hash
        if existing:
            for k, v in payload.items():
                setattr(existing, k, v)
        else:
            session.add(SpellModel(**payload))
        session.commit()
    print(f"[OK] Magia sincronizada: {parsed.name} (Nível {parsed.level}, {parsed.school.value})")


async def sync_single_feat(crawler: WikidotCrawler, slug: str, force: bool = False) -> None:
    page_path = f"feat:{slug}"
    async with httpx.AsyncClient(headers={"User-Agent": "DnD5e2024CatalogCLI/1.0"}) as client:
        html, html_hash = await crawler.fetch_page(client, "feats", page_path, force_refresh=force)
        source_url = f"{crawler.base_url}/{page_path}"
        parsed = parse_wikidot_feat_detail(html, slug, source_url)

    with SessionLocal() as session:
        existing = session.execute(select(FeatModel).where(FeatModel.slug == slug)).scalar_one_or_none()
        payload = parsed.model_dump()
        payload["raw_html_hash"] = html_hash
        if existing:
            for k, v in payload.items():
                setattr(existing, k, v)
        else:
            session.add(FeatModel(**payload))
        session.commit()
    print(f"[OK] Talento sincronizado: {parsed.name} ({parsed.category.value})")


async def sync_single_background(crawler: WikidotCrawler, slug: str, force: bool = False) -> None:
    page_path = f"background:{slug}"
    async with httpx.AsyncClient(headers={"User-Agent": "DnD5e2024CatalogCLI/1.0"}) as client:
        html, html_hash = await crawler.fetch_page(client, "backgrounds", page_path, force_refresh=force)
        source_url = f"{crawler.base_url}/{page_path}"
        parsed = parse_wikidot_background_detail(html, slug, source_url)

    with SessionLocal() as session:
        existing = session.execute(select(BackgroundModel).where(BackgroundModel.slug == slug)).scalar_one_or_none()
        payload = parsed.model_dump()
        payload["raw_html_hash"] = html_hash
        if existing:
            for k, v in payload.items():
                setattr(existing, k, v)
        else:
            session.add(BackgroundModel(**payload))
        session.commit()
    print(f"[OK] Antecedente sincronizado: {parsed.name} (Talento: {parsed.origin_feat_name})")


async def sync_spells_index(crawler: WikidotCrawler, limit: int = 25, force: bool = False) -> None:
    async with httpx.AsyncClient(headers={"User-Agent": "DnD5e2024CatalogCLI/1.0"}) as client:
        index_html, _ = await crawler.fetch_page(client, "indexes", "spells", force_refresh=force)
        links = extract_wikidot_spell_index_links(index_html)
        print(f"Encontradas {len(links)} magias no índice '/spells'. Sincronizando as primeiras {limit}...")
        for item in links[:limit]:
            try:
                await sync_single_spell(crawler, item["slug"], force=force)
            except Exception as exc:
                print(f"[WARN] Falha ao sincronizar {item['slug']}: {exc}")


def main() -> None:
    parser = argparse.ArgumentParser(description="CLI de Sincronização Wikidot -> Banco D&D 5e 2024")
    parser.add_argument("--base-url", default=os.getenv("WIKIDOT_BASE_URL", "http://dnd2024.wikidot.com"))
    parser.add_argument("--seed-only", action="store_true", help="Popula o banco apenas com o Seed Inicial 2024 offline")
    parser.add_argument("--spell", help="Sincroniza uma magia específica pelo slug (ex.: fireball)")
    parser.add_argument("--feat", help="Sincroniza um talento específico pelo slug (ex.: alert)")
    parser.add_argument("--background", help="Sincroniza um antecedente pelo slug (ex.: acolyte)")
    parser.add_argument("--sync-spells-index", action="store_true", help="Baixa o índice /spells e sincroniza magias em lote")
    parser.add_argument("--limit", type=int, default=25, help="Limite de itens no modo em lote")
    parser.add_argument("--force", action="store_true", help="Ignora o cache HTML local e baixa novamente do Wikidot")
    args = parser.parse_args()

    init_db_and_seed()
    if args.seed_only:
        print("[OK] Banco de dados inicializado e populado com o Seed D&D 5e 2024 (SRD 5.2.1).")
        return

    crawler = WikidotCrawler(base_url=args.base_url)
    if args.spell:
        asyncio.run(sync_single_spell(crawler, args.spell, force=args.force))
    elif args.feat:
        asyncio.run(sync_single_feat(crawler, args.feat, force=args.force))
    elif args.background:
        asyncio.run(sync_single_background(crawler, args.background, force=args.force))
    elif args.sync_spells_index:
        asyncio.run(sync_spells_index(crawler, limit=args.limit, force=args.force))
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
