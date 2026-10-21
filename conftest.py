"""Configuração do pytest: os testes usam bancos SQLite temporários (catálogo e contas), isolados dos bancos locais."""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

_TEST_DB = Path(tempfile.mkdtemp(prefix="dnd5e-catalog-tests-")) / "catalog.db"
os.environ["DATABASE_URL"] = f"sqlite:///{_TEST_DB}"

_ACCOUNTS_DB = Path(tempfile.mkdtemp(prefix="dnd5e-accounts-tests-")) / "accounts.db"
os.environ["ACCOUNTS_DATABASE_URL"] = f"sqlite:///{_ACCOUNTS_DB}"
