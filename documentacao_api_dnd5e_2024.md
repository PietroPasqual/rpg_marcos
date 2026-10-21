# Especificação Técnica Completa — API de Catálogo D&D 5e (Edição 2024 / SRD 5.2.1)

> **Atualização (v2.0):** a fonte de dados passou a ser exclusivamente o **SRD 5.2.1** (CC-BY 4.0), via o dataset estruturado do Open5e e o PDF oficial — veja a seção "Fonte dos dados e licença" do `README.md`. O pipeline de raspagem do Wikidot (`wikidot_etl_scraper.py`, `sync_wikidot_cli.py`) e o domínio de Bastiões (que não faz parte do SRD) foram removidos, e a coluna `raw_html_hash` virou `source_hash`. As seções abaixo que descrevem o Wikidot ou os Bastiões são mantidas apenas como referência histórica do desenho original.

## 1. Visão Geral, Escopo e Arquitetura do Sistema

Esta documentação define a especificação de engenharia ponta a ponta para a construção de uma **API RESTful de Catálogo do Dungeons & Dragons 5ª Edição (Revisão 2024 / 5.5e)** em **Python**. O sistema é projetado para servir como fonte única de verdade (*Single Source of Truth*) para aplicações de ficha de personagem, Virtual Tabletops (VTTs), bots de Discord, geradores de encontros e ferramentas de consulta rápida.

A base de conhecimento combina a organização comunitária do ecossistema Wikidot — especificamente o [One D&D Wikidot](https://onednd.wikidot.com/) e o [D&D 5e Wikidot](https://dnd5e.wikidot.com/quick-characters-ua) — com a referência oficial aberta do [System Reference Document v5.2.1 (SRD 5.2)](https://www.dndbeyond.com/srd), distribuído sob a licença [Creative Commons Attribution 4.0 (PDF Oficial)](https://media.dndbeyond.com/compendium-images/srd/5.2/SRD_CC_v5.2.1.pdf) e estruturado em repositórios de dados abertos como o [dnd-5e-srd-markdown](https://github.com/downfallx/dnd-5e-srd-markdown), o portal [5e24srd.com](https://5e24srd.com/) e o [Compêndio D&D 2024 no Roll20](https://roll20.net/compendium/dnd5e/Rules:Rules%20Definitions?expansion=33335).

### 1.1. Stack Tecnológica Detalhada

| Camada | Pacote / Versão | Justificativa Técnica e Papel no Sistema |
| :--- | :--- | :--- |
| **Runtime** | Python `>=3.12` | Uso de `enum.StrEnum`, sintaxe nativa de genéricos (`class Paginated[T]:`), `TypeAlias` e ganhos de performance no loop assíncrono `asyncio`. |
| **Framework API** | FastAPI `>=0.115` | Geração nativa de schemas OpenAPI 3.1.0, validação automática de query/path parameters, injeção de dependências (`Depends`) e suporte assíncrono completo. |
| **Serialização e Validação** | Pydantic `>=2.9` + `pydantic-settings` | Núcleo de validação em Rust (`pydantic-core`), serialização rápida de modelos ORM (`from_attributes=True`), validadores customizados (`@field_validator`, `@model_validator`) e gestão de variáveis de ambiente. |
| **ORM e Persistência** | SQLAlchemy `>=2.0.35` (Async) + `asyncpg` / `aiosqlite` | Sintaxe tipada moderna (`Mapped[...]`, `mapped_column(...)`), carregamento ansioso otimizado (`selectinload`, `joinedload`) e suporte a colunas `JSONB` e índices Full-Text (`GIN` / `tsvector`). |
| **Migrações de Schema** | Alembic `>=1.13` | Versionamento determinístico do banco de dados com suporte a autogenerate assíncrono. |
| **Coleta Web (Crawler)** | `httpx[http2]` + `tenacity` | Cliente HTTP assíncrono com suporte a HTTP/2, *connection pooling*, controle de concorrência (`asyncio.Semaphore`) e *exponential backoff* automático em falhas de rede. |
| **Parsing HTML (Wikidot)** | `beautifulsoup4` + `lxml` | Extração rápida da árvore DOM do Wikidot (`#page-content`, `table.wiki-content-table`, abas `div.yui-navset`) usando seletores CSS e XPath. |
| **Cache e Rate Limiting** | Redis (`redis-py` async) + HTTP `ETag` | Cache de respostas JSON de catálogo (que mudam raramente) e proteção contra abuso via cabeçalhos `Cache-Control` e `ETag`. |
| **Qualidade e Testes** | `pytest` + `pytest-asyncio` + `ruff` + `mypy` | Testes unitários dos parsers HTML usando *fixtures* reais do Wikidot, testes de integração das rotas FastAPI e checagem estática de tipos. |

### 1.2. Fluxo Arquitetural (Separação entre Pipeline ETL e API de Leitura)

O sistema é dividido em dois subsistemas independentes para garantir **latência sub-15ms** nas consultas da API e **zero dependência em tempo real** da disponibilidade do Wikidot:

1. **Subsistema ETL Offline (`etl/`):**
   * **Etapa 1 — Discovery & Crawling (`etl/crawler.py`):** Varre os índices do Wikidot (`/spells`, `/feats`, `/classes`, `/species`, `/backgrounds`, `/equipment`, `/monsters`), baixa o HTML bruto apenas se o hash/ETag mudou e salva em `data/raw_html/<category>/<slug>.html`.
   * **Etapa 2 — Parsing & Normalization (`etl/parsers/`):** Processa os arquivos HTML locais com `BeautifulSoup4`, resolve links internos (`/spell:fireball` -> `slug: "fireball"`), limpa tags visuais e valida cada registro contra os schemas Pydantic v2, exportando para `data/seed_json/<category>.json`.
   * **Etapa 3 — Database Seeding (`etl/seed.py`):** Executa *upserts* idempotentes (`INSERT ... ON CONFLICT (slug) DO UPDATE`) no PostgreSQL/SQLite, atualizando tabelas relacionais e índices de busca textual.
2. **Subsistema API Online (`app/`):**
   * Recebe requisições REST (`GET /api/v1/...`), valida filtros via Pydantic, executa queries assíncronas otimizadas no banco de dados e retorna payloads JSON paginados com cabeçalhos de cache (`ETag`).

## 2. Mapeamento Profundo das Regras D&D 5e 2024 (Diferenças Críticas de Domínio)

Para que o catálogo represente fielmente a edição de 2024 (e não misture conceitos legados de 2014), todos os schemas seguem as diretrizes do [Guia Geral D&D 5.5 do RPGBOT](https://rpgbot.net/2024-dnd/), das [Regras de Antecedentes e Talentos de Origem](https://www.dnddiceroller.com/blog/dnd-2024-backgrounds-origin-feats/) e do [Glossário de Regras 2024 no Roll20](https://roll20.net/compendium/dnd5e/Rules:Rules%20Definitions?expansion=33335):

| Domínio do Catálogo | Como era em 2014 (5e Clássico) | Como funciona em 2024 (5.5e / SRD 5.2) | Impacto no Schema da API |
| :--- | :--- | :--- | :--- |
| **Espécies (`species`)** | Chamadas de *Races*; concediam bônus fixos de atributo (+2/+1) e sub-raças separadas. | Chamadas de **Species**; **não** concedem bônus de atributo. Podem ter tamanho flexível (`Medium` ou `Small`) e linhagens embutidas (*Elven Lineages*, *Fiendish Legacies*, *Goliaths Giant Ancestry*). | Campo `sizes: list[str]`, remoção de `ability_bonuses` da espécie e adição de `lineages: list[SpeciesLineageSchema]`. |
| **Antecedentes (`backgrounds`)** | Concediam 2 perícias, idiomas/ferramentas e uma habilidade narrativa (*Feature*). | São o núcleo mecânico da origem: definem **3 atributos elegíveis** (para distribuir +2/+1 ou +1/+1/+1), **1 Talento de Origem fixo**, **2 perícias**, **1 proficiência em ferramenta** e **2 opções de pacote inicial** (A: itens + ouro residual; B: 50 GP). | Campos obrigatórios `ability_scores` (3 itens), `origin_feat_slug`, `skill_proficiencies` (2 itens), `tool_proficiency` e `equipment_options` (Opções A e B). |
| **Talentos (`feats`)** | Opcionais, sem categoria formal ou nível mínimo padronizado, escolhidos no lugar de ASI. | Divididos em 4 categorias estritas: **Origin** (Nível 1, sem ASI), **General** (Nível 4+, sempre incluem +1 em atributo ou escolha de atributo), **Fighting Style** (para classes com a habilidade *Fighting Style*) e **Epic Boon** (Nível 19+, incluem +1 em atributo até máximo de 30). | Campos `category`, `level_prerequisite`, `ability_score_increase`, `repeatable: bool` e `repeatable_rule`. |
| **Classes e Subclasses (`classes`)** | Subclasses escolhidas nos níveis 1, 2 ou 3 dependendo da classe. | **Todas as 12 classes** escolhem subclasse no **Nível 3**. Classes marciais e híbridas recebem **Weapon Mastery** no Nível 1. Novas mecânicas modulares como *Cunning Strike* (Rogue) e *Brutal Strike* (Barbarian), conforme analisado no [Guia de Classes 2024 do RPGBOT](https://rpgbot.net/2024-dnd/classes/). | Tabela `class_levels` com coluna `weapon_masteries_count`, `subclass_level = 3` padronizado e tabela `class_feature_options` para opções selecionáveis (Invocações, Metamagia, Manobras, Golpes Astutos). |
| **Armas e Maestrias (`weapons`)** | Armas possuíam apenas propriedades básicas (*Finesse, Light, Heavy, Versatile*). | Cada arma possui uma propriedade tática de **Weapon Mastery** (*Cleave, Graze, Nick, Push, Sap, Slow, Topple, Vex*), com regras próprias de ativação no acerto ou erro. | Enum e tabela dedicada `weapon_masteries` vinculada por chave estrangeira a cada registro em `weapons`. |
| **Ferramentas (`tools`)** | Descrições genéricas sem CDs padronizadas de uso em cena. | Cada ferramenta declara explicitamente seu **Atributo Associado**, ações **Utilize** (com CDs exatas, ex.: *Pick a lock DC 15*) e lista de **Itens Fabricáveis (Craft)**. | Campos estruturados `ability: AbilityScoreEnum`, `utilize_actions: list[ToolUtilizeAction]` e `craft_items: list[str]`. |
| **Magias (`spells`)** | *Healing* baixo, invocação de múltiplos monstros (ex.: *Conjure Animals*) e áreas centradas em ponto. | Nova área de efeito **Emanation** (emana das bordas do conjurador, ex.: *Spirit Guardians*, *Conjure Minor Elementals*), magias de cura dobradas e magias de reação/ação bônus como *Divine Smite* (agora magia de Ação Bônus). | Campo `area_of_effect` suportando `Emanation`, estrutura detalhada de gatilho de reação (`reaction_trigger`) e `scaling_type` (`slot_level` vs `character_level`). |
| **Monstros (`monsters`)** | Iniciativa implícita apenas pelo modificador de Destreza; salvaguardas listadas em linha de texto. | Bloco de estatísticas 2024 ([Bestiário D&D 2024 no AideDD](https://www.aidedd.org/monster/)) traz **Iniciativa explícita com valor passivo** (ex.: `+4 (14)`), tabela de 6 atributos já contendo `Score`, `Mod` e `Save`, e substituição de *Spellcasting* por usos diários (`3/Day`, `At Will`) dentro de `Actions` e `Bonus Actions`. | Campos `initiative_bonus: int`, `initiative_passive: int`, `ability_table: dict[Ability, AbilityStatBlock]` e separação clara entre `traits`, `actions`, `bonus_actions`, `reactions` e `legendary_actions`. |
| **Bastiões (`bastions`)** | Inexistente nas regras básicas de 2014. | Sistema oficial de gerenciamento de bases para personagens de Nível 5+ (*Basic Facilities* e *Special Facilities* de níveis 5, 9, 13 e 17, com *Hirelings* e *Bastion Orders*). | Novo módulo de catálogo `/api/v1/bastion-facilities` com espaço (*Cramped, Roomy, Vast*), pré-requisitos e ordens de bastião. |

## 3. Anatomia HTML do Wikidot e Estratégia de Extração (ETL)

Para extrair dados com 100% de precisão dos sites Wikidot ([One D&D Wikidot](https://onednd.wikidot.com/) e [D&D 5e Wikidot](https://dnd5e.wikidot.com/quick-characters-ua)), o parser precisa lidar com as convenções específicas do motor de templates do Wikidot.

### 3.1. Padrões de URLs e Seletores CSS por Categoria no Wikidot

| Entidade | Padrão de URL no Wikidot | Seletor do Título | Seletores de Metadados e Tabelas | Particularidades e *Edge Cases* do HTML |
| :--- | :--- | :--- | :--- | :--- |
| **Índice de Magias** | `/spells` ou `/spells:<class>` | `#page-title` | `div.yui-navset > ul.yui-nav > li` (abas de nível 0 a 9) e `div.yui-content > div > table.wiki-content-table` | O Wikidot agrupa magias por nível dentro de abas YUI (`#wiki-tab-0-0` = Cantrip, `#wiki-tab-0-1` = 1st Level, etc.). As colunas da tabela de índice são: *Spell Name*, *School*, *Casting Time*, *Range*, *Duration*, *Components*. |
| **Página de Magia** | `/spell:<slug>` | `#page-title` | `#page-content > p:nth-of-type(1)` (*Source*), `p:nth-of-type(2)` (*Level/School*), `p:nth-of-type(3)` (*Casting Time/Range/Components/Duration*) | Magias com tabelas internas (ex.: *Teleport*, *Summon Dragon*, *Prismatic Spray*) possuem `<table class="wiki-content-table">` no meio da descrição que devem ser convertidas em Markdown Table ou array JSON estruturado. |
| **Página de Classe** | `/<class-slug>` | `#page-title` | `table.wiki-content-table` (Tabela de progressão 1–20), `h2` / `h3` / `h4` para cada *Class Feature* | A primeira linha (`tr`) da tabela da classe para conjuradores possui `<th colspan="9">Spell Slots per Spell Level</th>`. O parser deve detectar `colspan` antes de mapear os índices das células `<td>`. |
| **Página de Subclasse** | `/<class-slug>:<subclass-slug>` | `#page-title` | `#page-content > p` (descrição), `h3` (habilidades de nível 3, 6, 10, 14) | Algumas subclasses de conjuradores (ex.: *Circle of the Land*, *Life Domain*, *Draconic Sorcery*) possuem tabelas de *Always Prepared Spells* por nível de classe. |
| **Antecedentes** | `/background:<slug>` | `#page-title` | `#page-content > p` ou listas `ul > li` com `<strong>Ability Scores:</strong>`, `<strong>Feat:</strong>`, `<strong>Skill Proficiencies:</strong>` | Os pacotes de equipamento usam o formato *"Choose A or B: (A) ... or (B) 50 GP"*, exigindo regex para separar a lista de itens do ouro residual. |
| **Espécies** | `/lineage:<slug>` ou `/species:<slug>` | `#page-title` | `#page-content` com `<strong>Creature Type:</strong>`, `<strong>Size:</strong>`, `<strong>Speed:</strong>` e parágrafos com `<strong><em>Trait Name.</em></strong>` | Espécies com linhagens (ex.: *Elf*, *Tiefling*, *Dragonborn*, *Goliath*) exibem uma `table.wiki-content-table` comparando os benefícios de Nível 1, 3 e 5 de cada linhagem. |
| **Talentos (Feats)** | `/feat:<slug>` | `#page-title` | `#page-content > p > em` (Categoria e Pré-requisito, ex.: *General Feat (Prerequisite: Level 4+, Dexterity 13+)*) | Os benefícios secundários de um talento aparecem como parágrafos iniciados por `<strong><em>Benefit Name.</em></strong>` ou itens de lista `<ul><li>`. |

### 3.2. Tratamento de *Edge Cases* no Parser HTML

1. **Normalização de Caracteres e Unicode:** O Wikidot frequentemente mistura travessões (`–`, `—`), sinais de menos matemáticos (`−`) e aspas curvas (`“`, `”`, `’`) em fórmulas de dados (ex.: `1d8 − 1` ou `2d6 + 3`). O pipeline aplica uma função de sanitização `normalize_text()` antes da validação Pydantic.
2. **Resolução de Hiperlinks Internos:** Links como `<a href="/spell:cure-wounds">Cure Wounds</a>` ou `<a href="/condition:prone">Prone</a>` são preservados em dois formatos:
   * `description_text`: texto puro ou Markdown limpo (`[Cure Wounds](/api/v1/spells/cure-wounds)`).
   * `referenced_entities`: lista estruturada de referências cruzadas (`[{"type": "spell", "slug": "cure-wounds", "name": "Cure Wounds"}]`), permitindo que o front-end exiba *tooltips* instantâneos ao passar o mouse!
3. **Conformidade Legal e Filtro SRD (`is_srd`):** Respeitando os [Termos de Uso do Wikidot](https://dnd5e.wikidot.com/legal:_home) e a licença [CC-BY 4.0 do SRD 5.2.1](https://media.dndbeyond.com/compendium-images/srd/5.2/SRD_CC_v5.2.1.pdf), cada registro é cruzado com a lista oficial de entidades do SRD 5.2.1. Isso permite que a API opere em **Modo Público (Apenas SRD 5.2)** com `?is_srd=true` ou **Modo Completo (Catálogo Local)** em ambientes privados.

## 4. Modelagem do Banco de Dados (SQLAlchemy 2.0 & Índices PostgreSQL)

A modelagem combina **colunas relacionais indexadas** (para todos os campos usados em filtros `WHERE` e `ORDER BY`) com **colunas `JSONB`** (para estruturas aninhadas de leitura rápida, como progressão de níveis, tabelas internas de descrições e opções de equipamentos), evitando *joins* excessivos de 5 ou 6 tabelas por consulta.

### 4.1. Diagrama Lógico de Tabelas e Relacionamentos

| Tabela Principal | Chave Primária | Chaves Estrangeiras / Tabelas Associativas | Índices de Performance (`B-Tree` / `GIN`) |
| :--- | :--- | :--- | :--- |
| `classes` | `id (UUID)` / `slug (Unique)` | `1:N` com `subclasses`, `1:N` com `class_levels`, `1:N` com `class_feature_options`, `N:M` com `spells` (via `spell_classes`) | `ix_classes_slug` (Unique), `ix_classes_is_srd` |
| `subclasses` | `id (UUID)` / `slug (Unique)` | `class_id -> classes.id (ON DELETE CASCADE)` | `ix_subclasses_slug` (Unique), `ix_subclasses_class_id` |
| `class_feature_options` | `id (UUID)` / `slug (Unique)` | `class_id -> classes.id` (Invocações, Metamagias, Manobras, Golpes Astutos) | `ix_feature_opts_category`, `ix_feature_opts_min_level` |
| `species` | `id (UUID)` / `slug (Unique)` | — (linhagens em `lineages JSONB`) | `ix_species_slug` (Unique), `ix_species_creature_type` |
| `backgrounds` | `id (UUID)` / `slug (Unique)` | `origin_feat_slug -> feats.slug` | `ix_backgrounds_slug` (Unique), `ix_backgrounds_abilities` (GIN) |
| `feats` | `id (UUID)` / `slug (Unique)` | — | `ix_feats_slug` (Unique), `ix_feats_category`, `ix_feats_level_prereq` |
| `spells` | `id (UUID)` / `slug (Unique)` | `N:M` com `classes` via tabela associativa `spell_classes(spell_id, class_slug)` | `ix_spells_slug` (Unique), `ix_spells_level_school`, `ix_spells_concentration`, `ix_spells_ritual`, `ix_spells_fts` (GIN `tsvector`) |
| `weapon_masteries` | `slug (PK)` | `1:N` com `weapons` | `pk_weapon_masteries_slug` |
| `weapons` | `id (UUID)` / `slug (Unique)` | `mastery_slug -> weapon_masteries.slug` | `ix_weapons_category`, `ix_weapons_mastery_slug`, `ix_weapons_damage_type` |
| `armors` | `id (UUID)` / `slug (Unique)` | — | `ix_armors_category`, `ix_armors_base_ac` |
| `tools` | `id (UUID)` / `slug (Unique)` | — | `ix_tools_category`, `ix_tools_ability` |
| `adventuring_gear` | `id (UUID)` / `slug (Unique)` | — | `ix_gear_category`, `ix_gear_cost_cp` |
| `magic_items` | `id (UUID)` / `slug (Unique)` | — | `ix_magic_items_rarity`, `ix_magic_items_category`, `ix_magic_items_attunement` |
| `monsters` | `id (UUID)` / `slug (Unique)` | — | `ix_monsters_cr_numeric`, `ix_monsters_creature_type`, `ix_monsters_size` |
| `rules_glossary` | `id (UUID)` / `slug (Unique)` | — | `ix_rules_tag`, `ix_rules_fts` (GIN `tsvector`) |
| `bastion_facilities` | `id (UUID)` / `slug (Unique)` | — | `ix_bastions_min_level`, `ix_bastions_type` |

### 4.2. Implementação dos Modelos ORM (`app/models/catalog.py`)

```python
import uuid
from datetime import datetime
from sqlalchemy import (
    Boolean, DateTime, Float, ForeignKey, Index, Integer, String, Text, UniqueConstraint, func
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class CatalogMixin:
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    slug: Mapped[str] = mapped_column(String(120), unique=True, index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(200), index=True, nullable=False)
    source_book: Mapped[str] = mapped_column(String(120), default="Player's Handbook (2024)", nullable=False)
    source_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    is_srd: Mapped[bool] = mapped_column(Boolean, default=True, index=True, nullable=False)
    raw_html_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class SpellClassAssociation(Base):
    __tablename__ = "spell_classes"
    spell_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("spells.id", ondelete="CASCADE"), primary_key=True
    )
    class_slug: Mapped[str] = mapped_column(String(60), primary_key=True, index=True)


class SpellModel(CatalogMixin, Base):
    __tablename__ = "spells"

    level: Mapped[int] = mapped_column(Integer, index=True, nullable=False)
    school: Mapped[str] = mapped_column(String(40), index=True, nullable=False)
    casting_time: Mapped[str] = mapped_column(String(120), index=True, nullable=False)
    reaction_trigger: Mapped[str | None] = mapped_column(Text, nullable=True)
    ritual: Mapped[bool] = mapped_column(Boolean, default=False, index=True, nullable=False)
    range_text: Mapped[str] = mapped_column(String(120), nullable=False)
    area_of_effect: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    verbal: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    somatic: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    material: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    material_description: Mapped[str | None] = mapped_column(Text, nullable=True)
    material_cost_gp: Mapped[int | None] = mapped_column(Integer, nullable=True)
    material_consumed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    duration: Mapped[str] = mapped_column(String(120), nullable=False)
    concentration: Mapped[bool] = mapped_column(Boolean, default=False, index=True, nullable=False)
    saving_throw_ability: Mapped[str | None] = mapped_column(String(10), index=True, nullable=True)
    attack_type: Mapped[str | None] = mapped_column(String(40), nullable=True)
    damage_types: Mapped[list[str]] = mapped_column(ARRAY(String(30)), default=list)
    conditions_inflicted: Mapped[list[str]] = mapped_column(ARRAY(String(40)), default=list)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    higher_levels: Mapped[str | None] = mapped_column(Text, nullable=True)
    tables: Mapped[list[dict]] = mapped_column(JSONB, default=list)
    referenced_entities: Mapped[list[dict]] = mapped_column(JSONB, default=list)

    classes: Mapped[list["SpellClassAssociation"]] = relationship(
        backref="spell", cascade="all, delete-orphan", lazy="selectin"
    )

    __table_args__ = (
        Index("ix_spells_level_school", "level", "school"),
        Index("ix_spells_damage_types_gin", "damage_types", postgresql_using="gin"),
    )


class FeatModel(CatalogMixin, Base):
    __tablename__ = "feats"

    category: Mapped[str] = mapped_column(String(40), index=True, nullable=False)
    level_prerequisite: Mapped[int] = mapped_column(Integer, default=1, index=True, nullable=False)
    prerequisite_text: Mapped[str | None] = mapped_column(String(250), nullable=True)
    ability_score_increases: Mapped[list[str]] = mapped_column(ARRAY(String(10)), default=list)
    repeatable: Mapped[bool] = mapped_column(Boolean, default=False, index=True, nullable=False)
    repeatable_note: Mapped[str | None] = mapped_column(String(250), nullable=True)
    benefits: Mapped[list[dict]] = mapped_column(JSONB, default=list, nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)


class BackgroundModel(CatalogMixin, Base):
    __tablename__ = "backgrounds"

    ability_scores: Mapped[list[str]] = mapped_column(ARRAY(String(10)), nullable=False)
    origin_feat_slug: Mapped[str] = mapped_column(
        String(120), ForeignKey("feats.slug", onupdate="CASCADE"), index=True, nullable=False
    )
    origin_feat_name: Mapped[str] = mapped_column(String(200), nullable=False)
    skill_proficiencies: Mapped[list[str]] = mapped_column(ARRAY(String(60)), nullable=False)
    tool_proficiency: Mapped[str] = mapped_column(String(150), nullable=False)
    equipment_options: Mapped[list[dict]] = mapped_column(JSONB, nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)


class WeaponMasteryModel(Base):
    __tablename__ = "weapon_masteries"

    slug: Mapped[str] = mapped_column(String(60), primary_key=True)
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    trigger_condition: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)


class WeaponModel(CatalogMixin, Base):
    __tablename__ = "weapons"

    category: Mapped[str] = mapped_column(String(40), index=True, nullable=False)
    range_type: Mapped[str] = mapped_column(String(20), index=True, nullable=False)
    damage_dice: Mapped[str] = mapped_column(String(30), nullable=False)
    damage_type: Mapped[str] = mapped_column(String(30), index=True, nullable=False)
    properties: Mapped[list[str]] = mapped_column(ARRAY(String(60)), default=list)
    range_normal_ft: Mapped[int | None] = mapped_column(Integer, nullable=True)
    range_long_ft: Mapped[int | None] = mapped_column(Integer, nullable=True)
    versatile_damage_dice: Mapped[str | None] = mapped_column(String(30), nullable=True)
    ammunition_type: Mapped[str | None] = mapped_column(String(60), nullable=True)
    mastery_slug: Mapped[str] = mapped_column(
        String(60), ForeignKey("weapon_masteries.slug"), index=True, nullable=False
    )
    weight_lb: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    cost_display: Mapped[str] = mapped_column(String(40), nullable=False)
    cost_cp: Mapped[int] = mapped_column(Integer, index=True, nullable=False)
```

## 5. Contratos de Dados Completos (Schemas Pydantic v2)

Abaixo estão todos os schemas Pydantic v2 do catálogo, incluindo validadores, metadados de documentação OpenAPI e modelos que cobrem **Classes, Subclasses, Opções de Habilidades de Classe, Espécies, Antecedentes, Talentos, Magias, Armas, Maestrias, Armaduras, Ferramentas, Equipamentos de Aventura, Itens Mágicos, Monstros, Bastiões e Glossário de Regras**.

### 5.1. Enumerações, Referências Cruzadas e Respostas Paginadas (`app/schemas/common.py`)

```python
from enum import StrEnum
from typing import Generic, TypeVar
from pydantic import BaseModel, ConfigDict, Field

T = TypeVar("T")


class AbilityScoreEnum(StrEnum):
    STR = "STR"
    DEX = "DEX"
    CON = "CON"
    INT = "INT"
    WIS = "WIS"
    CHA = "CHA"


class SizeEnum(StrEnum):
    TINY = "Tiny"
    SMALL = "Small"
    MEDIUM = "Medium"
    LARGE = "Large"
    HUGE = "Huge"
    GARGANTUAN = "Gargantuan"


class DamageTypeEnum(StrEnum):
    ACID = "Acid"
    BLUDGEONING = "Bludgeoning"
    COLD = "Cold"
    FIRE = "Fire"
    FORCE = "Force"
    LIGHTNING = "Lightning"
    NECROTIC = "Necrotic"
    PIERCING = "Piercing"
    POISON = "Poison"
    PSYCHIC = "Psychic"
    RADIANT = "Radiant"
    SLASHING = "Slashing"
    THUNDER = "Thunder"


class ConditionEnum(StrEnum):
    BLINDED = "Blinded"
    BLOODIED = "Bloodied"
    CHARMED = "Charmed"
    DEAFENED = "Deafened"
    EXHAUSTION = "Exhaustion"
    FRIGHTENED = "Frightened"
    GRAPPLED = "Grappled"
    INCAPACITATED = "Incapacitated"
    INVISIBLE = "Invisible"
    PARALYZED = "Paralyzed"
    PETRIFIED = "Petrified"
    POISONED = "Poisoned"
    PRONE = "Prone"
    RESTRAINED = "Restrained"
    STUNNED = "Stunned"
    UNCONSCIOUS = "Unconscious"


class EntityReferenceSchema(BaseModel):
    entity_type: str = Field(..., examples=["spell", "condition", "feat", "rule", "weapon-mastery"])
    slug: str = Field(..., examples=["prone"])
    name: str = Field(..., examples=["Prone"])
    api_path: str = Field(..., examples=["/api/v1/rules/prone"])


class EmbeddedTableSchema(BaseModel):
    caption: str | None = Field(default=None, examples=["Teleportation Familiarity"])
    headers: list[str] = Field(..., examples=[["Familiarity", "Mishap", "Similar Area", "Off Target", "On Target"]])
    rows: list[list[str]] = Field(..., examples=[[["Permanent circle", "—", "—", "—", "01-00"]]])


class CatalogBaseSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    slug: str = Field(..., pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$", examples=["fireball"])
    name: str = Field(..., min_length=1, max_length=200, examples=["Fireball"])
    source_book: str = Field(default="Player's Handbook (2024)", examples=["Player's Handbook (2024)"])
    source_url: str | None = Field(default=None, examples=["http://dnd2024.wikidot.com/spell:fireball"])
    is_srd: bool = Field(default=True, description="True se disponível sob licença CC-BY 4.0 do SRD 5.2.1")
    referenced_entities: list[EntityReferenceSchema] = Field(
        default_factory=list,
        description="Entidades referenciadas no texto para renderização de tooltips no cliente"
    )


class PaginationMetaSchema(BaseModel):
    total: int = Field(..., ge=0, examples=[391])
    page: int = Field(..., ge=1, examples=[1])
    size: int = Field(..., ge=1, le=100, examples=[20])
    pages: int = Field(..., ge=0, examples=[20])
    has_next: bool = Field(..., examples=[True])
    has_prev: bool = Field(..., examples=[False])


class PaginatedResponse(BaseModel, Generic[T]):
    meta: PaginationMetaSchema
    items: list[T]


class ProblemDetailsSchema(BaseModel):
    type: str = Field(default="about:blank", examples=["https://api.dnd2024.dev/errors/not-found"])
    title: str = Field(..., examples=["Resource Not Found"])
    status: int = Field(..., examples=[404])
    detail: str = Field(..., examples=["Spell with slug 'firebal' was not found in the 2024 catalog."])
    instance: str = Field(..., examples=["/api/v1/spells/firebal"])
    suggestions: list[str] = Field(
        default_factory=list,
        examples=[["fireball", "fire-bolt", "fire-shield"]],
        description="Slugs similares sugeridos por distância de Levenshtein / Trigram"
    )
```

### 5.2. Origens: Espécies, Linhagens e Antecedentes (`app/schemas/origins.py`)

```python
from pydantic import BaseModel, Field
from app.schemas.common import AbilityScoreEnum, CatalogBaseSchema, SizeEnum


class SpeciesTraitSchema(BaseModel):
    slug: str = Field(..., examples=["fey-ancestry"])
    name: str = Field(..., examples=["Fey Ancestry"])
    description: str = Field(..., examples=["You have Advantage on saving throws you make to avoid or end the Charmed condition."])


class SpeciesLineageBenefitSchema(BaseModel):
    character_level: int = Field(..., examples=[1, 3, 5])
    description: str = Field(..., examples=["Darkvision 120 ft. and the Dancing Lights cantrip."])
    granted_spells: list[str] = Field(default_factory=list, examples=[["dancing-lights", "faerie-fire", "darkness"]])


class SpeciesLineageSchema(BaseModel):
    slug: str = Field(..., examples=["drow"])
    name: str = Field(..., examples=["Drow"])
    description: str
    benefits_by_level: list[SpeciesLineageBenefitSchema]


class SpeciesSchema(CatalogBaseSchema):
    creature_type: str = Field(default="Humanoid", examples=["Humanoid"])
    sizes: list[SizeEnum] = Field(..., examples=[[SizeEnum.MEDIUM]])
    size_description: str = Field(..., examples=["Medium (about 5–6 feet tall)"])
    speed_ft: int = Field(default=30, ge=0, examples=[30])
    special_speeds: dict[str, int] = Field(default_factory=dict, examples=[{"fly": 30, "climb": 30, "swim": 30}])
    darkvision_ft: int | None = Field(default=60, examples=[60])
    traits: list[SpeciesTraitSchema]
    lineage_table_title: str | None = Field(default=None, examples=["Elven Lineages", "Fiendish Legacies", "Draconic Ancestors"])
    lineages: list[SpeciesLineageSchema] = Field(default_factory=list)
    description: str


class EquipmentItemQuantitySchema(BaseModel):
    item_slug: str = Field(..., examples=["parchment"])
    item_name: str = Field(..., examples=["Parchment"])
    quantity: int = Field(default=1, ge=1, examples=[10])


class BackgroundEquipmentOptionSchema(BaseModel):
    option_label: str = Field(..., pattern=r"^[AB]$", examples=["A"])
    items: list[EquipmentItemQuantitySchema] = Field(default_factory=list)
    gold_gp: int = Field(default=0, ge=0, examples=[8, 50])


class BackgroundSchema(CatalogBaseSchema):
    ability_scores: list[AbilityScoreEnum] = Field(
        ...,
        min_length=3,
        max_length=3,
        examples=[[AbilityScoreEnum.INT, AbilityScoreEnum.WIS, AbilityScoreEnum.CHA]],
        description="Exatamente 3 atributos elegíveis para +2/+1 ou +1/+1/+1 nas regras de 2024"
    )
    origin_feat_slug: str = Field(..., examples=["magic-initiate-cleric"])
    origin_feat_name: str = Field(..., examples=["Magic Initiate (Cleric)"])
    skill_proficiencies: list[str] = Field(..., min_length=2, max_length=2, examples=[["Insight", "Religion"]])
    tool_proficiency: str = Field(..., examples=["Calligrapher's Supplies"])
    tool_slug: str | None = Field(default=None, examples=["calligraphers-supplies"])
    equipment_options: list[BackgroundEquipmentOptionSchema] = Field(..., min_length=2, max_length=2)
    description: str
```

### 5.3. Classes, Subclasses e Opções de Recursos de Classe (`app/schemas/classes.py`)

```python
from enum import StrEnum
from pydantic import BaseModel, Field
from app.schemas.common import AbilityScoreEnum, CatalogBaseSchema, EmbeddedTableSchema


class FeatureOptionCategoryEnum(StrEnum):
    ELDRITCH_INVOCATION = "Eldritch Invocation"
    METAMAGIC = "Metamagic"
    BATTLE_MASTER_MANEUVER = "Battle Master Maneuver"
    CUNNING_STRIKE = "Cunning Strike"
    BRUTAL_STRIKE = "Brutal Strike"
    ARCANE_SHOT = "Arcane Shot"
    ELEMENTAL_DISCIPLINE = "Elemental Discipline"


class ClassFeatureOptionSchema(CatalogBaseSchema):
    parent_class_slug: str = Field(..., examples=["warlock", "rogue", "barbarian"])
    parent_subclass_slug: str | None = Field(default=None, examples=["battle-master"])
    category: FeatureOptionCategoryEnum
    level_prerequisite: int = Field(default=1, ge=1, le=20, examples=[2, 5])
    prerequisite_text: str | None = Field(default=None, examples=["Level 5+ Warlock, Pact of the Blade Invocation"])
    cost_text: str | None = Field(default=None, examples=["1d6 Sneak Attack dice", "2 Sorcery Points"])
    description: str


class ClassFeatureSchema(BaseModel):
    slug: str = Field(..., examples=["barbarian-weapon-mastery"])
    name: str = Field(..., examples=["Weapon Mastery"])
    level: int = Field(..., ge=1, le=20, examples=[1])
    is_subclass_feature: bool = Field(default=False)
    action_economy: str | None = Field(default=None, examples=["Bonus Action", "Reaction", "Free"])
    uses_formula: str | None = Field(default=None, examples=["See Rages column of the Barbarian table"])
    recharge: str | None = Field(default=None, examples=["Short Rest (+1 use) / Long Rest (All)"])
    description: str
    tables: list[EmbeddedTableSchema] = Field(default_factory=list)


class SpellcastingProgressionRowSchema(BaseModel):
    cantrips_known: int | None = Field(default=None, examples=[3])
    prepared_spells: int = Field(..., examples=[4])
    slots_by_level: dict[str, int] = Field(
        default_factory=dict,
        examples=[{"1": 2, "2": 0, "3": 0, "4": 0, "5": 0, "6": 0, "7": 0, "8": 0, "9": 0}],
        description="Quantidade de espaços de magia por círculo (1 a 9) ou Pact Magic"
    )
    pact_slots_count: int | None = Field(default=None, examples=[2])
    pact_slot_level: int | None = Field(default=None, examples=[3])


class ClassLevelProgressionSchema(BaseModel):
    level: int = Field(..., ge=1, le=20, examples=[1])
    proficiency_bonus: int = Field(..., ge=2, le=6, examples=[2])
    feature_names: list[str] = Field(..., examples=[["Rage", "Unarmored Defense", "Weapon Mastery"]])
    feature_slugs: list[str] = Field(..., examples=[["rage", "unarmored-defense", "weapon-mastery"]])
    weapon_masteries_known: int = Field(default=0, ge=0, examples=[2])
    class_specific_columns: dict[str, int | str] = Field(
        default_factory=dict,
        examples=[{"rages": 2, "rage_damage": "+2"}],
        description="Colunas exclusivas da classe no Wikidot (ex.: Focus Points, Martial Arts Die, Sneak Attack, Bardic Die)"
    )
    spellcasting: SpellcastingProgressionRowSchema | None = None


class SubclassPreparedSpellsRowSchema(BaseModel):
    class_level: int = Field(..., ge=3, le=20, examples=[3, 5, 7, 9])
    spell_slugs: list[str] = Field(..., examples=[["aid", "Lesser-restoration"]])
    spell_names: list[str] = Field(..., examples=[["Aid", "Lesser Restoration"]])


class SubclassSchema(CatalogBaseSchema):
    parent_class_slug: str = Field(..., examples=["cleric"])
    parent_class_name: str = Field(..., examples=["Cleric"])
    unlock_level: int = Field(default=3, description="No D&D 2024 todas as subclasses são desbloqueadas no nível 3")
    short_description: str
    always_prepared_spells: list[SubclassPreparedSpellsRowSchema] = Field(default_factory=list)
    features: list[ClassFeatureSchema]


class MulticlassRulesSchema(BaseModel):
    ability_score_minimum: dict[AbilityScoreEnum, int] = Field(..., examples=[{AbilityScoreEnum.STR: 13}])
    proficiencies_gained: dict[str, list[str]] = Field(
        ...,
        examples=[{"armor": ["Shields"], "weapons": ["Martial weapons"], "skills": []}]
    )


class ClassSchema(CatalogBaseSchema):
    primary_abilities: list[AbilityScoreEnum] = Field(..., examples=[[AbilityScoreEnum.STR]])
    primary_ability_logic: str = Field(default="OR", examples=["AND", "OR"])
    hit_point_die: str = Field(..., pattern=r"^d(?:6|8|10|12)$", examples=["d12"])
    hp_at_level_1: str = Field(..., examples=["12 + Con. modifier"])
    hp_per_level_after_1st: str = Field(..., examples=["1d12 (or 7) + Con. modifier"])
    saving_throw_proficiencies: list[AbilityScoreEnum] = Field(
        ..., min_length=2, max_length=2, examples=[[AbilityScoreEnum.STR, AbilityScoreEnum.CON]]
    )
    skill_choices_count: int = Field(..., ge=2, le=4, examples=[2])
    skill_options: list[str] = Field(..., examples=[["Animal Handling", "Athletics", "Intimidation", "Nature", "Perception", "Survival"]])
    weapon_proficiencies: list[str] = Field(..., examples=[["Simple weapons", "Martial weapons"]])
    tool_proficiencies: list[str] = Field(default_factory=list)
    armor_training: list[str] = Field(..., examples=[["Light armor", "Medium armor", "Shields"]])
    starting_equipment_options: list[dict] = Field(
        ...,
        examples=[[
            {"option_label": "A", "items": ["Greataxe", "4 Handaxes", "Explorer's Pack"], "gold_gp": 15},
            {"option_label": "B", "items": [], "gold_gp": 75}
        ]]
    )
    multiclassing: MulticlassRulesSchema
    spellcasting_ability: AbilityScoreEnum | None = Field(default=None)
    spellcasting_focus_type: str | None = Field(default=None, examples=["Arcane Focus", "Holy Symbol", "Druidic Focus"])
    level_table: list[ClassLevelProgressionSchema] = Field(..., min_length=20, max_length=20)
    features: list[ClassFeatureSchema]
    subclass_unlock_level: int = Field(default=3)
    subclass_feature_levels: list[int] = Field(..., examples=[[3, 6, 10, 14]])
    subclasses_summary: list[dict[str, str]] = Field(
        ...,
        examples=[[{"slug": "path-of-the-berserker", "name": "Path of the Berserker"}]]
    )
```

### 5.4. Equipamentos Completos: Armas, Maestrias, Armaduras, Ferramentas, Itens de Aventura e Itens Mágicos (`app/schemas/equipment.py`)

```python
from enum import StrEnum
from pydantic import BaseModel, Field
from app.schemas.common import AbilityScoreEnum, CatalogBaseSchema, DamageTypeEnum


class WeaponMasteryEnum(StrEnum):
    CLEAVE = "Cleave"
    GRAZE = "Graze"
    NICK = "Nick"
    PUSH = "Push"
    SAP = "Sap"
    SLOW = "Slow"
    TOPPLE = "Topple"
    VEX = "Vex"


class WeaponMasterySchema(BaseModel):
    slug: str = Field(..., examples=["sap"])
    name: WeaponMasteryEnum = Field(..., examples=[WeaponMasteryEnum.SAP])
    trigger_condition: str = Field(..., examples=["On a hit with this weapon"])
    effect_summary: str = Field(..., examples=["Target has Disadvantage on its next attack roll before the start of your next turn."])
    description: str
    compatible_weapons: list[str] = Field(..., examples=[["mace", "spear", "flail", "longsword", "morningstar", "war-pick"]])


class WeaponSchema(CatalogBaseSchema):
    category: str = Field(..., examples=["Simple Melee", "Simple Ranged", "Martial Melee", "Martial Ranged"])
    range_type: str = Field(..., examples=["Melee", "Ranged"])
    damage_dice: str = Field(..., examples=["1d8"])
    damage_type: DamageTypeEnum = Field(..., examples=[DamageTypeEnum.SLASHING])
    properties: list[str] = Field(default_factory=list, examples=[["Versatile (1d10)"]])
    range_normal_ft: int | None = Field(default=None, examples=[80])
    range_long_ft: int | None = Field(default=None, examples=[320])
    versatile_damage_dice: str | None = Field(default=None, examples=["1d10"])
    ammunition_type: str | None = Field(default=None, examples=["Arrows", "Bolts", "Firearm Bullets", "Needles", "Sling Bullets"])
    mastery_slug: str = Field(..., examples=["sap"])
    mastery_name: WeaponMasteryEnum = Field(..., examples=[WeaponMasteryEnum.SAP])
    weight_lb: float = Field(default=0.0, ge=0.0, examples=[3.0])
    cost_display: str = Field(..., examples=["15 GP"])
    cost_cp: int = Field(..., ge=0, examples=[1500])


class ArmorCategoryEnum(StrEnum):
    LIGHT = "Light Armor"
    MEDIUM = "Medium Armor"
    HEAVY = "Heavy Armor"
    SHIELD = "Shield"


class ArmorSchema(CatalogBaseSchema):
    category: ArmorCategoryEnum
    base_ac: int = Field(..., ge=2, le=20, examples=[14])
    ac_formula_display: str = Field(..., examples=["14 + Dex modifier (max 2)"])
    adds_dex_modifier: bool = Field(default=True)
    max_dex_modifier: int | None = Field(default=2, examples=[2])
    strength_requirement: int | None = Field(default=None, examples=[13, 15])
    stealth_disadvantage: bool = Field(default=False)
    don_time: str = Field(..., examples=["1 minute", "5 minutes", "10 minutes", "Utilize Action"])
    doff_time: str = Field(..., examples=["1 minute", "5 minutes", "Utilize Action"])
    weight_lb: float = Field(..., ge=0.0, examples=[20.0])
    cost_display: str = Field(..., examples=["50 GP"])
    cost_cp: int = Field(..., ge=0, examples=[5000])


class ToolUtilizeActionSchema(BaseModel):
    action_description: str = Field(..., examples=["Pick a lock", "Disarm a trap"])
    dc: int = Field(..., ge=5, le=30, examples=[15])


class ToolSchema(CatalogBaseSchema):
    category: str = Field(..., examples=["Artisan's Tools", "Gaming Set", "Musical Instrument", "Other Tools"])
    ability: AbilityScoreEnum = Field(..., examples=[AbilityScoreEnum.DEX])
    weight_lb: float = Field(default=0.0, ge=0.0, examples=[1.0])
    cost_display: str = Field(..., examples=["25 GP"])
    cost_cp: int = Field(..., ge=0, examples=[2500])
    utilize_actions: list[ToolUtilizeActionSchema] = Field(default_factory=list)
    craftable_items: list[str] = Field(default_factory=list, examples=[["Acid", "Alchemist's Fire", "Component Pouch", "Oil", "Paper", "Perfume"]])
    variants: list[dict[str, str]] = Field(default_factory=list)
    description: str


class AdventuringGearSchema(CatalogBaseSchema):
    category: str = Field(
        ...,
        examples=["Adventuring Gear", "Ammunition", "Arcane Focus", "Druidic Focus", "Holy Symbol", "Equipment Pack", "Mount", "Vehicle", "Poison"]
    )
    weight_lb: float = Field(default=0.0, ge=0.0, examples=[2.0])
    cost_display: str = Field(..., examples=["25 GP"])
    cost_cp: int = Field(..., ge=0, examples=[2500])
    action_type_Required: str | None = Field(default=None, examples=["Utilize", "Magic", "Bonus Action", "Attack"])
    pack_contents: list[dict[str, int | str]] = Field(
        default_factory=list,
        description="Lista de itens incluídos caso seja um Pacote de Equipamento (ex.: Explorer's Pack)"
    )
    description: str


class MagicItemRarityEnum(StrEnum):
    COMMON = "Common"
    UNCOMMON = "Uncommon"
    RARE = "Rare"
    VERY_RARE = "Very Rare"
    LEGENDARY = "Legendary"
    ARTIFACT = "Artifact"
    VARIES = "Varies"


class MagicItemSchema(CatalogBaseSchema):
    item_category: str = Field(..., examples=["Armor", "Potion", "Ring", "Rod", "Scroll", "Staff", "Wand", "Weapon", "Wondrous Item"])
    rarity: MagicItemRarityEnum
    requires_attunement: bool = Field(default=False)
    attunement_requirement: str | None = Field(default=None, examples=["by a Spellcaster", "by a Cleric or Paladin"])
    base_weapon_or_armor_slug: str | None = Field(default=None, examples=["longsword", "plate-armor"])
    bonus_value: int | None = Field(default=None, examples=[1, 2, 3])
    charges_max: int | None = Field(default=None, examples=[7])
    recharge_formula: str | None = Field(default=None, examples=["1d6 + 1 expended charges daily at dawn"])
    crafting_time_days: int | None = Field(default=None, examples=[10], description="Tempo de fabricação no DMG 2024")
    crafting_cost_gp: int | None = Field(default=None, examples=[200], description="Custo de materiais no DMG 2024")
    description: str
```

### 5.5. Monstros (Stat Block 2024), Bastiões e Glossário de Regras (`app/schemas/monsters_rules.py`)

```python
from enum import StrEnum
from pydantic import BaseModel, Field
from app.schemas.common import AbilityScoreEnum, CatalogBaseSchema, SizeEnum


class MonsterAbilityEntrySchema(BaseModel):
    score: int = Field(..., ge=1, le=30, examples=[19])
    modifier: int = Field(..., ge=-5, le=10, examples=[4])
    saving_throw: int = Field(..., ge=-5, le=19, examples=[7])


class MonsterTraitOrActionSchema(BaseModel):
    name: str = Field(..., examples=["Multiattack", "Rend", "Spellcasting"])
    recharge: str | None = Field(default=None, examples=["Recharge 5–6", "3/Day", "1/Day"])
    action_type: str = Field(..., examples=["Trait", "Action", "Bonus Action", "Reaction", "Legendary Action"])
    attack_roll_type: str | None = Field(default=None, examples=["Melee Attack Roll", "Ranged Attack Roll", "Melee or Ranged Attack Roll"])
    attack_bonus: int | None = Field(default=None, examples=[7])
    reach_or_range: str | None = Field(default=None, examples=["reach 10 ft.", "range 60/240 ft."])
    saving_throw_dc: int | None = Field(default=None, examples=[15])
    saving_throw_ability: AbilityScoreEnum | None = Field(default=None)
    hit_or_fail_effect: str | None = Field(
        default=None,
        examples=["15 (2d10 + 4) Slashing damage plus 4 (1d8) Fire damage, and the target has the Prone condition."]
    )
    description: str


class MonsterSchema(CatalogBaseSchema):
    size: list[SizeEnum] = Field(..., examples=[[SizeEnum.LARGE]])
    creature_type: str = Field(..., examples=["Fiend (Demon)"])
    alignment: str = Field(..., examples=["Chaotic Evil"])
    armor_class: int = Field(..., ge=1, examples=[15])
    armor_notes: str | None = Field(default=None, examples=["natural armor"])
    initiative_bonus: int = Field(..., examples=[5], description="Modificador explícito de Iniciativa do bloco 2024")
    initiative_passive: int = Field(..., examples=[15], description="Valor de Iniciativa estática entre parênteses no bloco 2024")
    hit_points: int = Field(..., ge=1, examples=[68])
    hit_dice_formula: str = Field(..., examples=["8d10 + 24"])
    speeds: dict[str, str] = Field(..., examples=[{"walk": "40 ft.", "climb": "30 ft.", "fly": "60 ft. (hover)"}])
    abilities: dict[AbilityScoreEnum, MonsterAbilityEntrySchema]
    skills: dict[str, int] = Field(default_factory=dict, examples=[{"Perception": 5, "Stealth": 6}])
    gear: list[str] = Field(default_factory=list, examples=[["Chain Shirt", "Longsword"]])
    damage_vulnerabilities: list[str] = Field(default_factory=list)
    damage_resistances: list[str] = Field(default_factory=list)
    damage_immunities: list[str] = Field(default_factory=list)
    condition_immunities: list[str] = Field(default_factory=list)
    senses: dict[str, int | str] = Field(..., examples=[{"darkvision": "120 ft.", "passive_perception": 15}])
    languages: list[str] = Field(default_factory=list, examples=[["Abyssal", "Telepathy 120 ft."]])
    challenge_rating: str = Field(..., examples=["5", "1/2", "1/4"])
    cr_numeric: float = Field(..., examples=[5.0, 0.5, 0.25])
    xp: int = Field(..., examples=[1800])
    xp_in_lair: int | None = Field(default=None, examples=[2300])
    proficiency_bonus: int = Field(..., ge=2, le=9, examples=[3])
    habitat: list[str] = Field(default_factory=list, examples=[["Planar (Abyss)", "Underdark"]])
    treasure_theme: str | None = Field(default=None, examples=["Armaments", "Arcana", "Relics", "Individual"])
    traits: list[MonsterTraitOrActionSchema] = Field(default_factory=list)
    actions: list[MonsterTraitOrActionSchema] = Field(default_factory=list)
    bonus_actions: list[MonsterTraitOrActionSchema] = Field(default_factory=list)
    reactions: list[MonsterTraitOrActionSchema] = Field(default_factory=list)
    legendary_actions_uses: int | None = Field(default=None, examples=[3])
    legendary_actions_in_lair: int | None = Field(default=None, examples=[4])
    legendary_actions: list[MonsterTraitOrActionSchema] = Field(default_factory=list)


class BastionSpaceEnum(StrEnum):
    CRAMPED = "Cramped (4 squares)"
    ROOMY = "Roomy (16 squares)"
    VAST = "Vast (36 squares)"


class BastionFacilitySchema(CatalogBaseSchema):
    facility_type: str = Field(..., examples=["Basic", "Special"])
    level_prerequisite: int = Field(default=5, examples=[5, 9, 13, 17])
    prerequisite_text: str | None = Field(default=None, examples=["Ability to use an Arcane Focus or Tool as a Spellcasting Focus"])
    space: BastionSpaceEnum
    hirelings_count: int = Field(default=1, ge=0, examples=[1, 2])
    bastion_order: str | None = Field(default=None, examples=["Craft", "Empower", "Harvest", "Maintain", "Recruit", "Research", "Trade"])
    passive_benefit: str | None = Field(default=None)
    order_options: list[dict[str, str]] = Field(default_factory=list)
    description: str


class RuleGlossaryTagEnum(StrEnum):
    ACTION = "Action"
    AREA_OF_EFFECT = "Area of Effect"
    ATTITUDE = "Attitude"
    CONDITION = "Condition"
    HAZARD = "Hazard"
    GENERAL_RULE = "General Rule"


class RuleGlossarySchema(CatalogBaseSchema):
    tag: RuleGlossaryTagEnum = Field(default=RuleGlossaryTagEnum.GENERAL_RULE)
    summary: str = Field(..., examples=["While Bloodied, a creature has half its Hit Points or fewer remaining."])
    bullet_effects: list[str] = Field(
        default_factory=list,
        description="Lista de efeitos mecânicos diretos (ex.: os 3 efeitos da condição Prone ou Exhaustion)"
    )
    description: str
    see_also_slugs: list[str] = Field(default_factory=list, examples=[["d20-test", "advantage", "disadvantage"]])
```

## 6. Especificação Exaustiva de Endpoints REST (OpenAPI 3.1)

Todas as rotas estão sob `/api/v1`, suportam compressão `GZip`, retornam `application/json` (ou `application/problem+json` em erros, seguindo a **RFC 7807**) e incluem cabeçalhos HTTP `ETag` e `Cache-Control: public, max-age=3600, stale-while-revalidate=86400`.

### 6.1. Parâmetros Globais de Paginação, Ordenação e Filtro

| Query Parameter | Tipo | Padrão | Aplicável em | Comportamento |
| :--- | :--- | :--- | :--- | :--- |
| `page` | `int` | `1` | Todas as listagens | Número da página (1-indexed). |
| `size` | `int` | `20` | Todas as listagens | Quantidade de itens por página (`1` a `100`). |
| `q` | `str` | `None` | Todas as listagens | Busca textual (`ILIKE` no nome + `websearch_to_tsquery` na descrição). |
| `is_srd` | `bool` | `None` | Todas as listagens | Se `true`, retorna apenas conteúdo oficial do SRD 5.2.1 (CC-BY 4.0). |
| `source_book` | `str` | `None` | Todas as listagens | Filtra pelo livro-fonte (ex.: `Player's Handbook (2024)`). |
| `sort_by` | `str` | `"name"` | Todas as listagens | Ordenação multi-coluna separada por vírgula; prefixo `-` para decrescente (ex.: `level,name` ou `-cr_numeric,name`). |
| `include_refs` | `bool` | `true` | Rotas de detalhe `/{slug}` | Se `true`, inclui o array `referenced_entities` resolvido. |

### 6.2. Catálogo Detalhado de Endpoints por Domínio

#### Domínio 1: Classes, Subclasses e Opções de Habilidades (`/api/v1/classes`)

| Método e Rota | Descrição Funcional | Filtros Específicos (Query Params) |
| :--- | :--- | :--- |
| `GET /api/v1/classes` | Lista resumo das 12 classes de 2024 (`barbarian`, `bard`, `cleric`, `druid`, `fighter`, `monk`, `paladin`, `ranger`, `rogue`, `sorcerer`, `warlock`, `wizard`). | `primary_ability` (`STR`, `DEX`, etc.), `hit_die` (`d6`, `d8`, `d10`, `d12`), `has_spellcasting` (`bool`), `has_weapon_mastery` (`bool`). |
| `GET /api/v1/classes/{slug}` | Retorna a classe completa com tabela 1–20, proficiências, equipamentos iniciais, regras de multiclasse e todas as *Class Features*. | `include_subclasses` (`bool`, padrão `false`). |
| `GET /api/v1/classes/{slug}/levels` | Retorna a tabela de progressão de nível 1 a 20 da classe, incluindo espaços de magia e colunas específicas. | `min_level` (`1–20`), `max_level` (`1–20`). |
| `GET /api/v1/classes/{slug}/levels/{level}` | Retorna os recursos, bônus de proficiência, maestrias e espaços de magia de um único nível exato (`1` a `20`). | — |
| `GET /api/v1/classes/{slug}/subclasses` | Lista todas as subclasses da classe especificada (todas iniciando no Nível 3). | `is_srd`, `source_book`. |
| `GET /api/v1/subclasses/{slug}` | Retorna detalhes completos de uma subclasse (ex.: `/api/v1/subclasses/path-of-the-berserker` ou `/api/v1/subclasses/college-of-lore`). | — |
| `GET /api/v1/class-feature-options` | Lista opções selecionáveis de classe (*Eldritch Invocations*, *Metamagic*, *Battle Master Maneuvers*, *Cunning Strike*, *Brutal Strike*). | `class_slug`, `subclass_slug`, `category`, `max_level_prerequisite`, `q`. |
| `GET /api/v1/class-feature-options/{slug}` | Detalhes de uma opção específica (ex.: `/api/v1/class-feature-options/agonizing-blast`). | — |

#### Domínio 2: Origens — Espécies e Antecedentes (`/api/v1/species` e `/api/v1/backgrounds`)

| Método e Rota | Descrição Funcional | Filtros Específicos (Query Params) |
| :--- | :--- | :--- |
| `GET /api/v1/species` | Lista todas as espécies jogáveis de 2024 (`aasimar`, `dragonborn`, `dwarf`, `elf`, `gnome`, `goliath`, `halfling`, `human`, `orc`, `tiefling`). | `size` (`Small`, `Medium`), `creature_type`, `min_darkvision_ft`, `has_lineages` (`bool`). |
| `GET /api/v1/species/{slug}` | Detalhes completos da espécie, incluindo seus traços e tabela de linhagens (ex.: Drow, High Elf, Wood Elf). | — |
| `GET /api/v1/backgrounds` | Lista todos os antecedentes de 2024 (`acolyte`, `artisan`, `charlatan`, `criminal`, `entertainer`, `farmer`, `guard`, `guide`, `hermit`, `merchant`, `noble`, `sage`, `sailor`, `scribe`, `soldier`, `wayfarer`). | `ability` (filtra antecedentes que permitem subir aquele atributo, ex.: `?ability=INT`), `origin_feat_slug`, `skill` (ex.: `?skill=Stealth`), `tool`. |
| `GET /api/v1/backgrounds/{slug}` | Detalhes do antecedente, os 3 atributos, o Talento de Origem vinculado e os pacotes A e B. | — |

#### Domínio 3: Talentos / Feats (`/api/v1/feats`)

| Método e Rota | Descrição Funcional | Filtros Específicos (Query Params) |
| :--- | :--- | :--- |
| `GET /api/v1/feats` | Lista talentos de todas as 4 categorias de 2024 (*Origin, General, Fighting Style, Epic Boon*). | `category` (`Origin`, `General`, `Fighting Style`, `Epic Boon`), `max_level` (ex.: `4`), `ability_increase` (ex.: `DEX` para buscar General Feats que dão +1 DEX), `repeatable` (`bool`). |
| `GET /api/v1/feats/{slug}` | Detalhes completos do talento, pré-requisitos e lista de benefícios estruturados. | — |

#### Domínio 4: Magias (`/api/v1/spells`)

| Método e Rota | Descrição Funcional | Filtros Específicos (Query Params) |
| :--- | :--- | :--- |
| `GET /api/v1/spells` | Busca avançada no catálogo de magias de 2024 (incluindo novas magias como *Sorcerous Burst*, *Starry Wisp* e versões revisadas de 2024). | `level` (aceita múltiplos separados por vírgula, ex.: `0,1,2`), `min_level`, `max_level`, `school`, `class_slug` (`bard`, `cleric`, `druid`, `paladin`, `ranger`, `sorcerer`, `warlock`, `wizard`), `concentration` (`bool`), `ritual` (`bool`), `casting_time` (`Action`, `Bonus Action`, `Reaction`), `damage_type`, `saving_throw`, `area_type` (`Cone`, `Cube`, `Cylinder`, `Emanation`, `Line`, `Sphere`), `has_costly_material` (`bool`). |
| `GET /api/v1/spells/{slug}` | Retorna o registro completo da magia, componentes detalhados, classes que a possuem e tabelas embutidas. | — |

#### Domínio 5: Equipamentos, Armas, Maestrias, Ferramentas e Itens Mágicos (`/api/v1/equipment` e `/api/v1/magic-items`)

| Método e Rota | Descrição Funcional | Filtros Específicos (Query Params) |
| :--- | :--- | :--- |
| `GET /api/v1/equipment/weapon-masteries` | Lista todas as 8 propriedades de Maestria de Arma de 2024 (*Cleave, Graze, Nick, Push, Sap, Slow, Topple, Vex*) e armas compatíveis. | — |
| `GET /api/v1/equipment/weapon-masteries/{slug}` | Detalhe mecânico de uma Maestria de Arma específica (ex.: `/api/v1/equipment/weapon-masteries/vex`). | — |
| `GET /api/v1/equipment/weapons` | Lista armas simples e marciais de 2024. | `category` (`Simple Melee`, `Martial Melee`, etc.), `range_type` (`Melee`, `Ranged`), `mastery` (`cleave`, `vex`, `nick`, etc.), `property` (`Finesse`, `Light`, `Heavy`, `Reach`, `Thrown`, `Two-Handed`, `Versatile`), `damage_type`, `max_cost_gp`. |
| `GET /api/v1/equipment/weapons/{slug}` | Detalhes completos de uma arma (ex.: `/api/v1/equipment/weapons/longsword`). | — |
| `GET /api/v1/equipment/armor` | Lista armaduras leves, médias, pesadas e escudos. | `category` (`Light Armor`, `Medium Armor`, `Heavy Armor`, `Shield`), `stealth_disadvantage` (`bool`), `max_strength_req`, `min_ac`. |
| `GET /api/v1/equipment/armor/{slug}` | Detalhes de uma armadura específica. | — |
| `GET /api/v1/equipment/tools` | Lista ferramentas de artesão, kits, jogos e instrumentos com atributos e CDs de *Utilize* e *Craft*. | `category`, `ability` (`DEX`, `INT`, `WIS`, `CHA`), `craftable_item` (busca qual ferramenta fabrica determinado item). |
| `GET /api/v1/equipment/tools/{slug}` | Detalhes completos de uma ferramenta (ex.: `/api/v1/equipment/tools/thieves-tools`). | — |
| `GET /api/v1/equipment/gear` | Lista itens de aventura, focos de conjuração, munições, pacotes iniciais, montarias, veículos e venenos. | `category`, `action_type` (`Utilize`, `Magic`, `Bonus Action`), `max_cost_gp`, `q`. |
| `GET /api/v1/equipment/gear/{slug}` | Detalhes de um equipamento de aventura ou pacote inicial. | — |
| `GET /api/v1/magic-items` | Lista itens mágicos do catálogo 2024. | `rarity` (`Common` a `Artifact`), `item_category`, `requires_attunement` (`bool`), `max_crafting_cost_gp`, `q`. |
| `GET /api/v1/magic-items/{slug}` | Detalhes completos de um item mágico. | — |

#### Domínio 6: Monstros, Bastiões, Glossário de Regras e Busca Global

| Método e Rota | Descrição Funcional | Filtros Específicos (Query Params) |
| :--- | :--- | :--- |
| `GET /api/v1/monsters` | Lista criaturas e monstros no formato de bloco 2024. | `cr` (ex.: `1/4`, `5`), `min_cr`, `max_cr`, `creature_type` (`Aberration`, `Beast`, `Celestial`, `Construct`, `Dragon`, `Elemental`, `Fey`, `Fiend`, `Giant`, `Humanoid`, `Monstrosity`, `Ooze`, `Plant`, `Undead`), `size`, `habitat`, `has_legendary_actions` (`bool`). |
| `GET /api/v1/monsters/{slug}` | Bloco de estatísticas completo de um monstro 2024. | — |
| `GET /api/v1/bastion-facilities` | Lista instalações básicas e especiais do sistema de Bastiões (2024). | `facility_type` (`Basic`, `Special`), `max_level` (`5`, `9`, `13`, `17`), `order` (`Craft`, `Empower`, `Harvest`, `Recruit`, `Research`, `Trade`), `space`. |
| `GET /api/v1/bastion-facilities/{slug}` | Detalhes de uma instalação de Bastião. | — |
| `GET /api/v1/rules` | Lista termos do Glossário de Regras 2024, incluindo todas as Ações, Condições, Áreas de Efeito, Atitudes e Perigos. | `tag` (`Action`, `Area of Effect`, `Attitude`, `Condition`, `Hazard`, `General Rule`), `q`. |
| `GET /api/v1/rules/{slug}` | Definição completa do termo (ex.: `/api/v1/rules/exhaustion`, `/api/v1/rules/emanation`, `/api/v1/rules/bloodied`). | — |
| `GET /api/v1/search` | Busca global unificada (`Omni-Search`) em todas as tabelas do catálogo simultaneamente, ideal para barras de comando (`Ctrl+K`). | `q` (obrigatório, mín. 2 caracteres), `types` (lista separada por vírgula, ex.: `spell,feat,class,rule,weapon`), `limit_per_type` (padrão `5`). |

### 6.3. Exemplos Completos de Payloads JSON (Request & Response)

#### Exemplo A: Detalhe de Espécie com Linhagens (`GET /api/v1/species/elf`)

```json
{
  "slug": "elf",
  "name": "Elf",
  "source_book": "Player's Handbook (2024)",
  "source_url": "http://dnd2024.wikidot.com/species:elf",
  "is_srd": true,
  "creature_type": "Humanoid",
  "sizes": ["Medium"],
  "size_description": "Medium (about 5–6 feet tall)",
  "speed_ft": 30,
  "special_speeds": {},
  "darkvision_ft": 60,
  "traits": [
    {
      "slug": "darkvision",
      "name": "Darkvision",
      "description": "You have Darkvision with a range of 60 feet."
    },
    {
      "slug": "elven-lineage",
      "name": "Elven Lineage",
      "description": "You are part of a lineage that grants you supernatural abilities. Choose a lineage from the Elven Lineages table. You gain the level 1 benefit of that lineage. When you reach character levels 3 and 5, you learn a higher-level spell, as shown on the table. You always have that spell prepared. You can cast it once without a spell slot, and you regain the ability to cast it in that way when you finish a Long Rest. You can also cast the spell using any spell slots you have of the appropriate level. Intelligence, Wisdom, or Charisma is your spellcasting ability for the spells you cast with this trait (choose the ability when you select the lineage)."
    },
    {
      "slug": "fey-ancestry",
      "name": "Fey Ancestry",
      "description": "You have Advantage on saving throws you make to avoid or end the Charmed condition."
    },
    {
      "slug": "keen-senses",
      "name": "Keen Senses",
      "description": "You have proficiency in the Insight, Perception, or Survival skill."
    },
    {
      "slug": "trance",
      "name": "Trance",
      "description": "You don't need to sleep, and magic can't put you to sleep. You can finish a Long Rest in 4 hours if you spend those hours in a trancelike meditation, during which you retain consciousness."
    }
  ],
  "lineage_table_title": "Elven Lineages",
  "lineages": [
    {
      "slug": "drow",
      "name": "Drow",
      "description": "The range of your Darkvision increases to 120 feet.",
      "benefits_by_level": [
        {"character_level": 1, "description": "Darkvision 120 ft. and the Dancing Lights cantrip.", "granted_spells": ["dancing-lights"]},
        {"character_level": 3, "description": "You learn the Faerie Fire spell.", "granted_spells": ["faerie-fire"]},
        {"character_level": 5, "description": "You learn the Darkness spell.", "granted_spells": ["darkness"]}
      ]
    },
    {
      "slug": "high-elf",
      "name": "High Elf",
      "description": "You know the Prestidigitation cantrip, which you can swap on a Long Rest for another Wizard cantrip.",
      "benefits_by_level": [
        {"character_level": 1, "description": "Prestidigitation cantrip (can replace with another Wizard cantrip after a Long Rest).", "granted_spells": ["prestidigitation"]},
        {"character_level": 3, "description": "You learn the Detect Magic spell.", "granted_spells": ["detect-magic"]},
        {"character_level": 5, "description": "You learn the Misty Step spell.", "granted_spells": ["misty-step"]}
      ]
    },
    {
      "slug": "wood-elf",
      "name": "Wood Elf",
      "description": "Your Speed increases to 35 feet.",
      "benefits_by_level": [
        {"character_level": 1, "description": "Speed increases to 35 feet, and you know the Druidcraft cantrip.", "granted_spells": ["druidcraft"]},
        {"character_level": 3, "description": "You learn the Longstrider spell.", "granted_spells": ["longstrider"]},
        {"character_level": 5, "description": "You learn the Pass without Trace spell.", "granted_spells": ["pass-without-trace"]}
      ]
    }
  ],
  "description": "Created by the god Corellon, the first elves could change their forms at will.",
  "referenced_entities": [
    {"entity_type": "condition", "slug": "charmed", "name": "Charmed", "api_path": "/api/v1/rules/charmed"},
    {"entity_type": "spell", "slug": "faerie-fire", "name": "Faerie Fire", "api_path": "/api/v1/spells/faerie-fire"}
  ]
}
```

#### Exemplo B: Detalhe de Talento Geral 2024 (`GET /api/v1/feats/grappler`)

```json
{
  "slug": "grappler",
  "name": "Grappler",
  "source_book": "Player's Handbook (2024)",
  "source_url": "http://dnd2024.wikidot.com/feat:grappler",
  "is_srd": true,
  "category": "General",
  "level_prerequisite": 4,
  "prerequisite_text": "Level 4+, Strength or Dexterity 13+",
  "ability_score_increase_options": ["STR", "DEX"],
  "repeatable": false,
  "repeatable_note": null,
  "benefits": [
    {
      "name": "Ability Score Increase",
      "description": "Increase your Strength or Dexterity score by 1, to a maximum of 20."
    },
    {
      "name": "Punch and Grab",
      "description": "When you hit a creature with an Unarmed Strike as part of the Attack action on your turn, you can use both the Damage and the Grapple option. You can use this benefit only once per turn."
    },
    {
      "name": "Attack Advantage",
      "description": "You have Advantage on attack rolls against a creature Grappled by you."
    },
    {
      "name": "Fast Wrestler",
      "description": "You don't have to spend extra movement to move a creature Grappled by you if the creature is your size or smaller."
    }
  ],
  "referenced_entities": [
    {"entity_type": "rule", "slug": "unarmed-strike", "name": "Unarmed Strike", "api_path": "/api/v1/rules/unarmed-strike"},
    {"entity_type": "condition", "slug": "grappled", "name": "Grappled", "api_path": "/api/v1/rules/grappled"}
  ]
}
```

#### Exemplo C: Detalhe de Ferramenta 2024 (`GET /api/v1/equipment/tools/thieves-tools`)

```json
{
  "slug": "thieves-tools",
  "name": "Thieves' Tools",
  "source_book": "Player's Handbook (2024)",
  "source_url": "http://dnd2024.wikidot.com/equipment:tools",
  "is_srd": true,
  "category": "Other Tools",
  "ability": "DEX",
  "weight_lb": 1.0,
  "cost_display": "25 GP",
  "cost_cp": 2500,
  "utilize_actions": [
    {"action_description": "Pick a lock", "dc": 15},
    {"action_description": "Disarm a trap", "dc": 15}
  ],
  "craftable_items": [],
  "variants": [],
  "description": "This set of tools includes a small file, a set of lock picks, a small mirror mounted on a metal handle, a set of narrow-bladed scissors, and a pair of pliers.",
  "referenced_entities": [
    {"entity_type": "rule", "slug": "utilize", "name": "Utilize [Action]", "api_path": "/api/v1/rules/utilize"}
  ]
}
```

#### Exemplo D: Erro Padronizado RFC 7807 com Sugestão de Slug (`GET /api/v1/spells/eldritch-blst`)

```json
{
  "type": "https://api.dnd2024.dev/errors/not-found",
  "title": "Resource Not Found",
  "status": 404,
  "detail": "No spell found with slug 'eldritch-blst'.",
  "instance": "/api/v1/spells/eldritch-blst",
  "suggestions": [
    "eldritch-blast"
  ]
}
```

## 7. Implementação Completa do Pipeline ETL do Wikidot (`etl/`)

### 7.1. Crawler Assíncrono com Cache em Disco e Rate Limit (`etl/crawler.py`)

```python
import asyncio
import hashlib
from pathlib import Path
import httpx
from tenacity import retry, stop_after_attempt, wait_exponential

RAW_HTML_DIR = Path("data/raw_html")
DEFAULT_HEADERS = {
    "User-Agent": "DnD5e2024CatalogBot/1.0 (Local Catalog Indexer; +https://github.com/your-org/dnd5e-2024-api)",
    "Accept": "text/html,application/xhtml+xml",
    "Accept-Language": "en-US,en;q=0.9",
}


class WikidotCrawler:
    def __init__(self, base_url: str = "http://dnd2024.wikidot.com", max_concurrency: int = 2, delay_seconds: float = 1.2):
        self.base_url = base_url.rstrip("/")
        self.semaphore = asyncio.Semaphore(max_concurrency)
        self.delay_seconds = delay_seconds
        RAW_HTML_DIR.mkdir(parents=True, exist_ok=True)

    def _cache_path(self, category: str, slug: str) -> Path:
        cat_dir = RAW_HTML_DIR / category
        cat_dir.mkdir(parents=True, exist_ok=True)
        safe_slug = slug.replace(":", "__").replace("/", "_")
        return cat_dir / f"{safe_slug}.html"

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1.5, min=2, max=10))
    async def _download_url(self, client: httpx.AsyncClient, url: str) -> str:
        async with self.semaphore:
            response = await client.get(url, follow_redirects=True, timeout=20.0)
            response.raise_for_status()
            await asyncio.sleep(self.delay_seconds)
            return response.text

    async def fetch_page(self, client: httpx.AsyncClient, category: str, page_path: str, force_refresh: bool = False) -> tuple[str, str]:
        slug = page_path.lstrip("/").split(":")[-1]
        cache_file = self._cache_path(category, slug)
        full_url = f"{self.base_url}/{page_path.lstrip('/')}"

        if cache_file.exists() and not force_refresh:
            html = cache_file.read_text(encoding="utf-8")
            html_hash = hashlib.sha256(html.encode("utf-8")).hexdigest()
            return html, html_hash

        html = await self._download_url(client, full_url)
        cache_file.write_text(html, encoding="utf-8")
        html_hash = hashlib.sha256(html.encode("utf-8")).hexdigest()
        return html, html_hash
```

### 7.2. Parser de Índice de Magias com Abas YUI e Tabelas (`etl/parsers/spell_parser.py`)

```python
import re
from bs4 import BeautifulSoup, Tag
from app.schemas.common import EmbeddedTableSchema, EntityReferenceSchema
from app.schemas.spells import SpellComponentsSchema, SpellSchema, SpellSchoolEnum

LEVEL_SCHOOL_RE = re.compile(
    r"^(?:Level\s+(?P<level>\d+)\s+(?P<school>[A-Za-z]+)|(?P<cantrip_school>[A-Za-z]+)\s+Cantrip)\s*(?:\((?P<classes>[^)]+)\))?",
    re.IGNORECASE,
)
COST_GP_RE = re.compile(r"worth\s+([\d,]+)\+?\s*GP", re.IGNORECASE)
AREA_RE = re.compile(
    r"(?P<size>\d+)-foot(?:-radius)?\s+(?P<shape>Cone|Cube|Cylinder|Emanation|Line|Sphere)",
    re.IGNORECASE,
)


def extract_wikidot_spell_index_links(index_html: str) -> list[dict[str, str | int]]:
    """
    Extrai todos os links de magias da página '/spells' do Wikidot,
    iterando pelas abas YUI (#wiki-tab-0-0 até #wiki-tab-0-9) para capturar o nível exato.
    """
    soup = BeautifulSoup(index_html, "lxml")
    results: list[dict[str, str | int]] = []

    navset = soup.select_one("div.yui-navset")
    if not navset:
        return results

    tab_divs = navset.select("div.yui-content > div")
    for level_idx, tab_div in enumerate(tab_divs):
        for row in tab_div.select("table.wiki-content-table tr"):
            cells = row.find_all("td")
            if not cells:
                continue
            link = cells[0].find("a", href=True)
            if not link:
                continue
            href = link["href"]
            slug = href.split(":")[-1].strip("/")
            results.append({
                "slug": slug,
                "name": link.get_text(strip=True),
                "href": href,
                "level_hint": level_idx,
            })
    return results


def extract_internal_references(container: Tag) -> list[EntityReferenceSchema]:
    refs: dict[str, EntityReferenceSchema] = {}
    route_map = {
        "spell": "/api/v1/spells",
        "feat": "/api/v1/feats",
        "background": "/api/v1/backgrounds",
        "species": "/api/v1/species",
        "lineage": "/api/v1/species",
        "condition": "/api/v1/rules",
    }
    for a in container.find_all("a", href=True):
        href = a["href"].strip("/")
        if ":" in href and not href.startswith("http"):
            prefix, target_slug = href.split(":", 1)
            prefix = prefix.lower()
            if prefix in route_map and target_slug not in refs:
                refs[target_slug] = EntityReferenceSchema(
                    entity_type="species" if prefix == "lineage" else prefix,
                    slug=target_slug,
                    name=a.get_text(strip=True),
                    api_path=f"{route_map[prefix]}/{target_slug}",
                )
    return list(refs.values())


def parse_html_table(table_tag: Tag) -> EmbeddedTableSchema:
    headers = [th.get_text(" ", strip=True) for th in table_tag.select("tr th")]
    rows: list[list[str]] = []
    for tr in table_tag.select("tr"):
        tds = tr.find_all("td")
        if tds:
            rows.append([td.get_text(" ", strip=True) for td in tds])
    return EmbeddedTableSchema(headers=headers, rows=rows)


def parse_wikidot_spell_detail(html: str, slug: str, source_url: str) -> SpellSchema:
    soup = BeautifulSoup(html, "lxml")
    title_el = soup.select_one("#page-title")
    content_el = soup.select_one("#page-content")

    if not title_el or not content_el:
        raise ValueError(f"Página Wikidot inválida para a magia: {slug}")

    name = title_el.get_text(strip=True)
    source_book = "Player's Handbook (2024)"
    level = 0
    school = SpellSchoolEnum.EVOCATION
    class_lists: list[str] = []
    casting_time = "Action"
    ritual = False
    spell_range = "Self"
    area_of_effect: dict | None = None
    components = SpellComponentsSchema()
    duration = "Instantaneous"
    concentration = False
    description_parts: list[str] = []
    higher_levels: str | None = None
    embedded_tables: list[EmbeddedTableSchema] = []

    for child in content_el.children:
        if not isinstance(child, Tag):
            continue

        if child.name == "table" and "wiki-content-table" in child.get("class", []):
            embedded_tables.append(parse_html_table(child))
            continue

        if child.name in ("p", "ul", "ol", "blockquote"):
            text = child.get_text(" ", strip=True)
            if not text:
                continue

            if text.startswith("Source:"):
                source_book = text.replace("Source:", "").strip()
                continue

            match = LEVEL_SCHOOL_RE.search(text)
            if match and child.name == "p":
                if match.group("cantrip_school"):
                    level = 0
                    school = SpellSchoolEnum(match.group("cantrip_school").capitalize())
                else:
                    level = int(match.group("level"))
                    school = SpellSchoolEnum(match.group("school").capitalize())
                if match.group("classes"):
                    class_lists = [c.strip().lower() for c in match.group("classes").split(",")]
                continue

            if "Casting Time:" in text and "Range:" in text:
                for line in child.get_text("
", strip=True).splitlines():
                    if line.startswith("Casting Time:"):
                        raw_ct = line.replace("Casting Time:", "").strip()
                        ritual = "ritual" in raw_ct.lower()
                        casting_time = re.sub(r"\s*or\s+Ritual", "", raw_ct, flags=re.IGNORECASE).strip()
                    elif line.startswith("Range:"):
                        spell_range = line.replace("Range:", "").strip()
                        area_match = AREA_RE.search(spell_range)
                        if area_match:
                            area_of_effect = {
                                "type": area_match.group("shape").capitalize(),
                                "size_ft": int(area_match.group("size")),
                            }
                    elif line.startswith("Components:"):
                        raw_comp = line.replace("Components:", "").strip()
                        flags_part = raw_comp.split("(")[0]
                        components.verbal = "V" in flags_part
                        components.somatic = "S" in flags_part
                        components.material = "M" in flags_part
                        mat_match = re.search(r"\((.+)\)", raw_comp)
                        if mat_match:
                            mat_desc = mat_match.group(1).strip()
                            components.material_description = mat_desc
                            components.material_consumed = "consume" in mat_desc.lower()
                            cost_match = COST_GP_RE.search(mat_desc)
                            if cost_match:
                                components.material_cost_gp = int(cost_match.group(1).replace(",", ""))
                    elif line.startswith("Duration:"):
                        duration = line.replace("Duration:", "").strip()
                        concentration = "concentration" in duration.lower()
                continue

            if text.startswith(("Using a Higher-Level Spell Slot.", "Cantrip Upgrade.")):
                higher_levels = text
            else:
                description_parts.append(text)

    refs = extract_internal_references(content_el)

    return SpellSchema(
        slug=slug,
        name=name,
        source_book=source_book,
        source_url=source_url,
        level=level,
        school=school,
        class_lists=class_lists,
        casting_time=casting_time,
        ritual=ritual,
        range=spell_range,
        area_of_effect=area_of_effect,
        components=components,
        duration=duration,
        concentration=concentration,
        description="

".join(description_parts),
        higher_levels=higher_levels,
        referenced_entities=refs,
    )
```

### 7.3. Parser de Tabelas de Progressão de Classes (`etl/parsers/class_parser.py`)

```python
import re
from bs4 import BeautifulSoup, Tag
from app.schemas.classes import ClassLevelProgressionSchema, SpellcastingProgressionRowSchema

LEVEL_INT_RE = re.compile(r"(\d+)")


def parse_wikidot_class_progression_table(table_tag: Tag) -> list[ClassLevelProgressionSchema]:
    """
    Converte a tabela de nível 1–20 de uma classe do Wikidot em objetos ClassLevelProgressionSchema,
    tratando cabeçalhos com colspan (como 'Spell Slots per Spell Level').
    """
    rows = table_tag.find_all("tr")
    if not rows:
        return []

    header_row_idx = 0
    for idx, r in enumerate(rows):
        ths = [th.get_text(" ", strip=True).lower() for th in r.find_all("th")]
        if any("level" in h for h in ths) and any("proficiency" in h for h in ths):
            header_row_idx = idx
            break

    headers = [th.get_text(" ", strip=True) for th in rows[header_row_idx].find_all("th")]
    progression: list[ClassLevelProgressionSchema] = []

    for tr in rows[header_row_idx + 1 :]:
        cells = [td.get_text(" ", strip=True) for td in tr.find_all("td")]
        if len(cells) < 3:
            continue

        row_map = dict(zip(headers, cells))
        lvl_match = LEVEL_INT_RE.search(row_map.get("Level", ""))
        if not lvl_match:
            continue

        level = int(lvl_match.group(1))
        pb_text = row_map.get("Proficiency Bonus", "+2").replace("+", "").strip()
        proficiency_bonus = int(pb_text) if pb_text.isdigit() else 2

        raw_features = row_map.get("Class Features", row_map.get("Features", ""))
        feature_names = [f.strip() for f in raw_features.split(",") if f.strip() and f.strip() != "—"]
        feature_slugs = [re.sub(r"[^a-z0-9]+", "-", f.lower()).strip("-") for f in feature_names]

        weapon_masteries_known = 0
        if "Weapon Mastery" in row_map:
            wm_val = row_map["Weapon Mastery"].strip()
            weapon_masteries_known = int(wm_val) if wm_val.isdigit() else 0

        spell_slots: dict[str, int] = {}
        for slot_lvl in ("1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th"):
            if slot_lvl in row_map:
                val = row_map[slot_lvl].strip()
                spell_slots[slot_lvl[0]] = int(val) if val.isdigit() else 0

        spellcasting_obj = None
        if spell_slots or "Prepared Spells" in row_map or "Spell Slots" in row_map:
            cantrips = row_map.get("Cantrips")
            prep = row_map.get("Prepared Spells", "0")
            pact_slots = row_map.get("Spell Slots")
            pact_lvl = row_map.get("Slot Level")
            spellcasting_obj = SpellcastingProgressionRowSchema(
                cantrips_known=int(cantrips) if cantrips and cantrips.isdigit() else None,
                prepared_spells=int(prep) if prep.isdigit() else 0,
                slots_by_level=spell_slots,
                pact_slots_count=int(pact_slots) if pact_slots and pact_slots.isdigit() else None,
                pact_slot_level=int(LEVEL_INT_RE.search(pact_lvl).group(1)) if pact_lvl and LEVEL_INT_RE.search(pact_lvl) else None,
            )

        ignored_cols = {
            "Level", "Proficiency Bonus", "Class Features", "Features", "Weapon Mastery",
            "Cantrips", "Prepared Spells", "Spell Slots", "Slot Level",
            "1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th",
        }
        specific_cols: dict[str, int | str] = {}
        for col_name, col_val in row_map.items():
            if col_name not in ignored_cols:
                key = re.sub(r"[^a-z0-9]+", "_", col_name.lower()).strip("_")
                specific_cols[key] = int(col_val) if col_val.isdigit() else col_val

        progression.append(
            ClassLevelProgressionSchema(
                level=level,
                proficiency_bonus=proficiency_bonus,
                feature_names=feature_names,
                feature_slugs=feature_slugs,
                weapon_masteries_known=weapon_masteries_known,
                class_specific_columns=specific_cols,
                spellcasting=spellcasting_obj,
            )
        )

    return progression
```

## 8. Implementação de Referência das Rotas FastAPI (`app/api/v1/endpoints/spells.py`)

```python
import math
from typing import Annotated
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from sqlalchemy import Select, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_async_session
from app.models.catalog import SpellClassAssociation, SpellModel
from app.schemas.common import PaginatedResponse, PaginationMetaSchema, ProblemDetailsSchema
from app.schemas.spells import SpellSchema, SpellSchoolEnum

router = APIRouter(prefix="/spells", tags=["Spells (Catálogo 2024)"])


@router.get(
    "",
    response_model=PaginatedResponse[SpellSchema],
    summary="Listar e filtrar magias do D&D 5e 2024",
)
async def list_spells(
    session: Annotated[AsyncSession, Depends(get_async_session)],
    page: Annotated[int, Query(ge=1, description="Página atual")] = 1,
    size: Annotated[int, Query(ge=1, le=100, description="Itens por página")] = 20,
    q: Annotated[str | None, Query(min_length=2, description="Busca textual no nome ou descrição")] = None,
    levels: Annotated[str | None, Query(description="Níveis separados por vírgula (ex.: 0,1,3)")] = None,
    school: Annotated[SpellSchoolEnum | None, Query(description="Escola de magia")] = None,
    class_slug: Annotated[str | None, Query(description="Filtra pela lista de magias da classe (ex.: wizard, cleric)")] = None,
    concentration: Annotated[bool | None, Query(description="Requer Concentração")] = None,
    ritual: Annotated[bool | None, Query(description="Possui tag de Ritual")] = None,
    casting_time: Annotated[str | None, Query(description="Ex.: Action, Bonus Action, Reaction")] = None,
    damage_type: Annotated[str | None, Query(description="Tipo de dano causado (ex.: Fire, Radiant)")] = None,
    is_srd: Annotated[bool | None, Query(description="Filtra apenas conteúdo aberto do SRD 5.2.1")] = None,
) -> PaginatedResponse[SpellSchema]:
    stmt: Select = select(SpellModel)

    if q:
        pattern = f"%{q.strip()}%"
        stmt = stmt.where(or_(SpellModel.name.ilike(pattern), SpellModel.description.ilike(pattern)))

    if levels is not None:
        parsed_levels = [int(x.strip()) for x in levels.split(",") if x.strip().isdigit()]
        if parsed_levels:
            stmt = stmt.where(SpellModel.level.in_(parsed_levels))

    if school is not None:
        stmt = stmt.where(SpellModel.school == school.value)

    if class_slug is not None:
        stmt = stmt.join(SpellClassAssociation).where(SpellClassAssociation.class_slug == class_slug.lower().strip())

    if concentration is not None:
        stmt = stmt.where(SpellModel.concentration.is_(concentration))

    if ritual is not None:
        stmt = stmt.where(SpellModel.ritual.is_(ritual))

    if casting_time is not None:
        stmt = stmt.where(SpellModel.casting_time.ilike(f"%{casting_time.strip()}%"))

    if damage_type is not None:
        stmt = stmt.where(SpellModel.damage_types.any(damage_type.capitalize()))

    if is_srd is not None:
        stmt = stmt.where(SpellModel.is_srd.is_(is_srd))

    count_stmt = select(func.count()).select_from(stmt.subquery())
    total: int = (await session.execute(count_stmt)).scalar_one()

    stmt = stmt.order_by(SpellModel.level.asc(), SpellModel.name.asc()).offset((page - 1) * size).limit(size)
    rows = (await session.execute(stmt)).scalars().all()

    pages = math.ceil(total / size) if total > 0 else 0
    return PaginatedResponse[SpellSchema](
        meta=PaginationMetaSchema(
            total=total,
            page=page,
            size=size,
            pages=pages,
            has_next=page < pages,
            has_prev=page > 1,
        ),
        items=[SpellSchema.model_validate(row) for row in rows],
    )


@router.get(
    "/{slug}",
    response_model=SpellSchema,
    responses={404: {"model": ProblemDetailsSchema, "description": "Magia não encontrada"}},
    summary="Obter detalhes de uma magia pelo slug",
)
async def get_spell_by_slug(
    slug: str,
    request: Request,
    response: Response,
    session: Annotated[AsyncSession, Depends(get_async_session)],
) -> SpellSchema:
    stmt = select(SpellModel).where(SpellModel.slug == slug.lower().strip())
    spell = (await session.execute(stmt)).scalar_one_or_none()

    if not spell:
        similar_stmt = (
            select(SpellModel.slug)
            .where(SpellModel.slug.ilike(f"%{slug[:4]}%"))
            .limit(3)
        )
        suggestions = list((await session.execute(similar_stmt)).scalars().all())
        raise HTTPException(
            status_code=404,
            detail={
                "type": "https://api.dnd2024.dev/errors/not-found",
                "title": "Resource Not Found",
                "status": 404,
                "detail": f"No spell found with slug '{slug}'.",
                "instance": str(request.url.path),
                "suggestions": suggestions,
            },
        )

    if spell.raw_html_hash:
        response.headers["ETag"] = f'W/"{spell.raw_html_hash[:16]}"'
    response.headers["Cache-Control"] = "public, max-age=3600"
    return SpellSchema.model_validate(spell)
```

## 9. Configuração do Projeto, Dependências e Testes Automatizados

### 9.1. Arquivo `pyproject.toml`

```toml
[project]
name = "dnd5e-2024-catalog-api"
version = "1.0.0"
description = "API REST de Catálogo do Dungeons & Dragons 5e (Edição 2024 / SRD 5.2) com ETL Wikidot"
readme = "README.md"
requires-python = ">=3.12"
license = { text = "MIT (Code) / CC-BY-4.0 (SRD 5.2 Content)" }
dependencies = [
    "fastapi>=0.115.0",
    "uvicorn[standard]>=0.31.0",
    "pydantic>=2.9.0",
    "pydantic-settings>=2.5.0",
    "sqlalchemy[asyncio]>=2.0.35",
    "asyncpg>=0.29.0",
    "aiosqlite>=0.20.0",
    "alembic>=1.13.3",
    "httpx[http2]>=0.27.2",
    "beautifulsoup4>=4.12.3",
    "lxml>=5.3.0",
    "tenacity>=9.0.0",
]

[project.optional-dependencies]
dev = [
    "pytest>=8.3.0",
    "pytest-asyncio>=0.24.0",
    "ruff>=0.6.8",
    "mypy>=1.11.2",
]

[tool.ruff]
line-length = 110
target-version = "py312"

[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]
```

### 9.2. Estratégia de Testes e Validação de Integridade do Catálogo (`tests/test_catalog_integrity.py`)

Além dos testes de rotas HTTP (`TestClient` / `AsyncClient`), o pipeline de dados executa **4 verificações determinísticas de integridade** sempre que o `etl/seed.py` é rodado:

1. **Integridade de Chave Estrangeira de Origem:** Todo `Background.origin_feat_slug` deve existir na tabela `feats` com `category == "Origin"`.
2. **Integridade de Maestria de Arma:** Todo `Weapon.mastery_slug` deve corresponder a uma das 8 propriedades cadastradas em `weapon_masteries` (*cleave, graze, nick, push, sap, slow, topple, vex*).
3. **Completude de Progressão de Classe:** Toda classe em `classes` deve possuir exatamente 20 registros em `level_table` (`level` de `1` a `20`), e `subclass_unlock_level` deve ser `3`.
4. **Validação de Referências Cruzadas:** Todos os `referenced_entities` extraídos dos links HTML do Wikidot são verificados contra os slugs existentes no banco para evitar links quebrados (`404`) nos *tooltips* do cliente.
