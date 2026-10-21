"""Configuração do pytest: os testes usam um banco SQLite temporário, isolado do banco local."""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

_TEST_DB = Path(tempfile.mkdtemp(prefix="dnd5e-catalog-tests-")) / "catalog.db"
os.environ["DATABASE_URL"] = f"sqlite:///{_TEST_DB}"
