# API de Catálogo D&D 5e (Edição 2024 / SRD 5.2.1)

API RESTful em **Python (FastAPI + Pydantic v2 + SQLAlchemy 2.0)** para consulta do catálogo do **Dungeons & Dragons 5ª Edição (Regras de 2024 / 5.5e)**, incluindo pipeline ETL de extração para o **Wikidot** e banco de dados pré-populado com o **SRD 5.2.1**.

## Arquivos do Projeto

* `main_api.py` — Aplicação principal FastAPI com todos os endpoints `/api/v1/...`, busca global (`/api/v1/search`), cabeçalhos `ETag` e erros padronizados RFC 7807.
* `schemas_and_models.py` — Todos os modelos ORM (SQLAlchemy 2.0) e schemas de validação (Pydantic v2) cobrindo Classes, Subclasses, Opções de Classe, Espécies, Antecedentes, Talentos, Magias, Armas, Maestrias de Arma, Armaduras, Ferramentas, Equipamentos, Itens Mágicos, Monstros, Bastiões e Glossário de Regras.
* `wikidot_etl_scraper.py` — Crawler assíncrono (`WikidotCrawler`), parsers HTML (`BeautifulSoup4`) para páginas e tabelas do Wikidot e dataset de *seed* automático de 2024.
* `sync_wikidot_cli.py` — Utilitário de linha de comando (CLI) para baixar e sincronizar páginas do Wikidot para o banco local.
* `test_api_and_parsers.py` — Suíte de testes automatizados (`pytest`) cobrindo os parsers HTML do Wikidot e todas as rotas da API.
* `documentacao_api_dnd5e_2024.md` — Especificação técnica completa da arquitetura, modelagem e contratos REST.

## Como Executar Localmente (Passo a Passo)

### 1. Criar ambiente virtual e instalar dependências

```bash
python -m venv .venv
# No Windows:
.venv\Scripts\activate
# No Linux/macOS:
source .venv/bin/activate

pip install -r requirements.txt
```

### 2. Rodar os testes automatizados

```bash
pytest -v test_api_and_parsers.py
```

### 3. Iniciar o servidor da API

```bash
uvicorn main_api:app --reload --port 8000
```

Na primeira execução, a API cria automaticamente o arquivo SQLite `dnd5e_2024_catalog.db` e popula todas as tabelas com o catálogo inicial de 2024.

* **Swagger UI (Interativo):** `http://localhost:8000/docs`
* **ReDoc:** `http://localhost:8000/redoc`
* **Health Check:** `http://localhost:8000/health`

### 4. Sincronizar novos dados do Wikidot via CLI

```bash
# Sincronizar uma magia específica do Wikidot:
python sync_wikidot_cli.py --spell fireball

# Sincronizar um talento ou antecedente específico:
python sync_wikidot_cli.py --feat alert
python sync_wikidot_cli.py --background acolyte

# Sincronizar um lote de magias a partir do índice /spells do Wikidot:
python sync_wikidot_cli.py --sync-spells-index --limit 50
```
