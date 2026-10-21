# API de Catálogo D&D 5e (Regras de 2024 / SRD 5.2.1)

API RESTful **somente leitura** em **Python (FastAPI + Pydantic v2 + SQLAlchemy 2.0)** com o catálogo completo do **System Reference Document 5.2.1** — o conjunto oficial e aberto (CC-BY 4.0) das regras de 2024 de Dungeons & Dragons 5ª Edição.

## Conteúdo do catálogo

| Entidade | Rota | Registros |
| :--- | :--- | ---: |
| Classes (com tabela de níveis 1–20, espaços de magia e multiclasse) | `/api/v1/classes` | 12 |
| Subclasses | `/api/v1/subclasses/{slug}` · `/api/v1/classes/{slug}/subclasses` | 12 |
| Opções de classe (Invocações Místicas, Metamagia) | `/api/v1/class-feature-options` | 37 |
| Espécies (com linhagens/legados) | `/api/v1/species` | 9 |
| Antecedentes | `/api/v1/backgrounds` | 4 |
| Talentos (Origem, Geral, Estilo de Luta, Dádiva Épica) | `/api/v1/feats` | 17 |
| Magias | `/api/v1/spells` | 339 |
| Maestrias de arma | `/api/v1/equipment/weapon-masteries` | 8 |
| Armas | `/api/v1/equipment/weapons` | 38 |
| Armaduras e escudo | `/api/v1/equipment/armor` | 13 |
| Ferramentas | `/api/v1/equipment/tools` | 37 |
| Equipamento de aventura, kits, montarias e veículos | `/api/v1/equipment/gear` | 115 |
| Itens mágicos (inclui variantes por arma/armadura base) | `/api/v1/magic-items` | 760 |
| Monstros e animais | `/api/v1/monsters` | 331 |
| Glossário de Regras (condições, ações, áreas de efeito, perigos…) e capítulos de regras | `/api/v1/rules` | 222 |

Também há `GET /api/v1/search?q=...` (busca por nome em todas as entidades) e `GET /api/v1/about` (fonte, licença, texto de atribuição e contagens).

> Bastiões não fazem parte do SRD 5.2.1 e por isso não existem neste catálogo.

## Fonte dos dados e licença

Os dados ficam versionados em `data/srd_5_2_1/` e são importados para o banco no primeiro start:

* `data/srd_5_2_1/open5e/*.json` — transcrição estruturada do SRD 5.2 feita pelo projeto [Open5e](https://open5e.com) (documento `srd-2024`). Comparada ao PDF oficial 5.2.1, 99% das descrições de magias e itens mágicos e 100% das habilidades de classe, talentos e traços de espécie batem palavra por palavra.
* `data/srd_5_2_1/srd_pdf_extract.json` — Glossário de Regras (155 entradas) e proficiências de multiclasse extraídos do [PDF oficial do SRD 5.2.1](https://media.dndbeyond.com/compendium-images/srd/5.2/SRD_CC_v5.2.1.pdf) por `scripts/extract_srd_pdf.py`.

O importador (`srd_importer.py`) converte esses arquivos para os modelos da API, corrige pequenos erros do dataset de origem e valida cada registro com os schemas Pydantic antes de gravar.

**Atribuição obrigatória (CC-BY 4.0).** Qualquer site ou app que use estes dados precisa exibir:

> This work includes material from the System Reference Document 5.2.1 ("SRD 5.2.1") by Wizards of the Coast LLC, available at https://www.dndbeyond.com/srd. The SRD 5.2.1 is licensed under the Creative Commons Attribution 4.0 International License, available at https://creativecommons.org/licenses/by/4.0/legalcode.

A Wizards pede que não seja incluída nenhuma outra atribuição a ela; é permitido dizer que o trabalho é "compatible with fifth edition" ou "5E compatible". O mesmo texto é retornado em `GET /api/v1/about`.

Limitações conhecidas dos dados: tabelas do glossário (ex.: *Damage Types*, *Carrying Capacity*) não são extraídas, só o texto; o número de usos de Ações Lendárias dos monstros não existe no dataset de origem; algumas descrições curtas de montarias, veículos e munições foram escritas pelo Open5e e não pelo SRD.

## Arquivos do Projeto

* `main_api.py` — Aplicação FastAPI com todos os endpoints `/api/v1/...`, busca global, `ETag`/`304` e erros RFC 7807.
* `schemas_and_models.py` — Modelos ORM (SQLAlchemy 2.0) e schemas de resposta (Pydantic v2).
* `srd_importer.py` — Importador do SRD 5.2.1 para o banco.
* `sync_srd_cli.py` — CLI para reimportar ou atualizar os dados.
* `scripts/download_srd_data.py` — Baixa os dados de origem (Open5e + PDF oficial) para `data/srd_5_2_1/`.
* `scripts/extract_srd_pdf.py` — Extrai o Glossário de Regras e a multiclasse do PDF do SRD 5.2.1.
* `test_api_and_parsers.py` — Testes (`pytest`) do importador, da integridade dos dados e das rotas.
* `documentacao_api_dnd5e_2024.md` — Especificação técnica original da arquitetura e dos contratos REST.

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

Os testes usam um banco SQLite temporário e não mexem no seu banco local.

### 3. Iniciar o servidor da API

```bash
uvicorn main_api:app --reload --port 8000
```

Na primeira execução, a API cria o arquivo SQLite `dnd5e_2024_catalog.db` e importa o catálogo completo (cerca de 2 segundos). Bancos criados por versões anteriores são recriados automaticamente.

* **Swagger UI (Interativo):** `http://localhost:8000/docs`
* **ReDoc:** `http://localhost:8000/redoc`
* **Health Check:** `http://localhost:8000/health`
* **Exemplos:** `/api/v1/classes/wizard/levels/5`, `/api/v1/species/elf`, `/api/v1/spells?level=3&school=Evocation`, `/api/v1/monsters?min_cr=5&max_cr=8`, `/api/v1/rules?tag=Condition`

### 4. Atualizar os dados do SRD (opcional)

```bash
python sync_srd_cli.py --stats      # contagem de registros por entidade
python sync_srd_cli.py --reimport   # recria o banco a partir de data/srd_5_2_1/

# Baixar a versão mais recente dos dados de origem e reimportar
# (o PDF exige: pip install -r requirements-dev.txt)
python sync_srd_cli.py --download
python sync_srd_cli.py --download --skip-pdf   # só os arquivos do Open5e
```

### 5. Executar via Docker (opcional)

```bash
docker compose up --build
```

## Consumindo a API (somente leitura)

* **Paginação:** toda listagem aceita `page` e `size` (máx. 100) e devolve `meta.total`, `meta.pages`, `has_next` e `has_prev`. Todos os filtros, inclusive os de listas como `ability`, `class_slug`, `skill` e `damage_type`, são aplicados antes da paginação, então `total` sempre reflete o resultado completo.
* **Busca textual (`q`):** não diferencia maiúsculas/minúsculas; `%` e `_` são tratados como texto literal.
* **Cache HTTP:** os endpoints de detalhe (`/{slug}`) retornam `ETag`. Reenvie-o em `If-None-Match` para receber `304 Not Modified` sem corpo quando nada mudou.
* **Erros:** todas as respostas de erro (404, 422, rotas inexistentes) usam `application/problem+json` (RFC 7807). Os 404 de slug trazem `suggestions` com slugs parecidos; os 422 trazem `errors` com o parâmetro inválido.
* **CORS:** liberado para qualquer origem com `GET` e `OPTIONS`, sem credenciais, para ser consumido direto do navegador.
* **Busca global:** `/api/v1/search?q=...` procura por nome em todas as entidades do catálogo (magias, talentos, classes, subclasses, opções de classe, espécies, antecedentes, armas, armaduras, ferramentas, equipamentos, itens mágicos, monstros e regras).
* **Textos:** descrições vêm em inglês, como no SRD, com formatação Markdown (negrito, itálico e tabelas); as tabelas também são entregues estruturadas em campos `tables` quando existem.
