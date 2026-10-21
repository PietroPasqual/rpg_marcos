"""
Aplicação Principal FastAPI — Catálogo D&D 5e (Edição 2024 / SRD 5.2.1).
Implementa todos os 6 domínios do Catálogo v1, Paginação, Filtros Compostos,
Busca Global (Omni-Search), Cache HTTP (ETag) e Erros RFC 7807 com Sugestão de Slugs.
"""

from __future__ import annotations

import difflib
import hashlib
import math
import os
from contextlib import asynccontextmanager
from typing import Annotated, Any, Callable, Generator, Type, TypeVar

from fastapi import Depends, FastAPI, HTTPException, Path, Query, Request, Response
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import Select, create_engine, func, or_, select
from sqlalchemy.orm import Session, sessionmaker
from starlette.exceptions import HTTPException as StarletteHTTPException

from schemas_and_models import (
    AdventuringGearModel,
    AdventuringGearSchema,
    ArmorCategoryEnum,
    ArmorModel,
    ArmorSchema,
    BackgroundModel,
    BackgroundSchema,
    Base,
    BastionFacilityModel,
    BastionFacilitySchema,
    ClassFeatureOptionModel,
    ClassFeatureOptionSchema,
    ClassLevelProgressionSchema,
    ClassModel,
    ClassSchema,
    FeatCategoryEnum,
    FeatModel,
    FeatSchema,
    FeatureOptionCategoryEnum,
    MagicItemModel,
    MagicItemRarityEnum,
    MagicItemSchema,
    MonsterModel,
    MonsterSchema,
    OmniSearchResponseSchema,
    OmniSearchResultItemSchema,
    PaginatedResponse,
    PaginationMetaSchema,
    ProblemDetailsSchema,
    RuleGlossaryModel,
    RuleGlossarySchema,
    RuleGlossaryTagEnum,
    SpeciesModel,
    SpeciesSchema,
    SpellModel,
    SpellSchema,
    SpellSchoolEnum,
    SubclassModel,
    SubclassSchema,
    ToolModel,
    ToolSchema,
    WeaponMasteryModel,
    WeaponMasterySchema,
    WeaponModel,
    WeaponSchema,
)
from wikidot_etl_scraper import seed_database_with_2024_catalog

SchemaT = TypeVar("SchemaT")

# =====================================================================
# 1. CONFIGURAÇÃO DO BANCO DE DADOS E LIFESPAN
# =====================================================================

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./dnd5e_2024_catalog.db")
connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}

engine = create_engine(DATABASE_URL, connect_args=connect_args, future=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)


def init_db_and_seed() -> None:
    Base.metadata.create_all(bind=engine)
    with SessionLocal() as session:
        seed_database_with_2024_catalog(session)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db_and_seed()
    yield


def get_db() -> Generator[Session, None, None]:
    with SessionLocal() as session:
        yield session


# =====================================================================
# 2. INICIALIZAÇÃO DO FASTAPI E HANDLER RFC 7807 (PROBLEM DETAILS)
# =====================================================================

app = FastAPI(
    title="D&D 5e (2024 Edition / SRD 5.2.1) Catalog API",
    version="1.0.0",
    description=(
        "API RESTful de Catálogo do Dungeons & Dragons 5ª Edição (Regras de 2024 / 5.5e), "
        "estruturada sobre a base de dados do Wikidot D&D 2024 e o SRD v5.2.1 (CC-BY 4.0)."
    ),
    lifespan=lifespan,
)

# API pública somente leitura: qualquer origem pode consultar, sem cookies/credenciais
# (allow_credentials=True com allow_origins=["*"] é rejeitado pelos navegadores).
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["ETag", "Cache-Control"],
)


class CatalogNotFoundError(Exception):
    def __init__(self, entity_name: str, slug: str, instance_path: str, suggestions: list[str]) -> None:
        self.entity_name = entity_name
        self.slug = slug
        self.instance_path = instance_path
        self.suggestions = suggestions


class NotModifiedError(Exception):
    def __init__(self, etag: str) -> None:
        self.etag = etag


def problem_response(
    status: int,
    title: str,
    detail: str,
    instance: str,
    error_type: str,
    suggestions: list[str] | None = None,
    extra: dict[str, Any] | None = None,
) -> JSONResponse:
    problem = ProblemDetailsSchema(
        type=f"https://api.dnd2024.dev/errors/{error_type}",
        title=title,
        status=status,
        detail=detail,
        instance=instance,
        suggestions=suggestions or [],
    )
    content = problem.model_dump()
    if extra:
        content.update(extra)
    return JSONResponse(status_code=status, content=content, media_type="application/problem+json")


@app.exception_handler(CatalogNotFoundError)
async def catalog_not_found_handler(_request: Request, exc: CatalogNotFoundError) -> JSONResponse:
    return problem_response(
        status=404,
        title="Resource Not Found",
        detail=f"No {exc.entity_name} found with slug '{exc.slug}'.",
        instance=exc.instance_path,
        error_type="not-found",
        suggestions=exc.suggestions,
    )


@app.exception_handler(NotModifiedError)
async def not_modified_handler(_request: Request, exc: NotModifiedError) -> Response:
    return Response(
        status_code=304,
        headers={"ETag": exc.etag, "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400"},
    )


@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException) -> JSONResponse:
    title = "Resource Not Found" if exc.status_code == 404 else "HTTP Error"
    return problem_response(
        status=exc.status_code,
        title=title,
        detail=str(exc.detail),
        instance=str(request.url.path),
        error_type="not-found" if exc.status_code == 404 else "http-error",
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    return problem_response(
        status=422,
        title="Invalid Request Parameters",
        detail="One or more query/path parameters are invalid.",
        instance=str(request.url.path),
        error_type="validation",
        extra={"errors": jsonable_encoder(exc.errors())},
    )


# =====================================================================
# 3. HELPERS DE PAGINAÇÃO, CACHE HTTP (ETAG) E BUSCA POR SLUG
# =====================================================================


def like_pattern(term: str) -> str:
    """Padrão ILIKE '%termo%' com os curingas do usuário (%, _) tratados como texto literal."""
    escaped = term.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def ilike(column: Any, term: str) -> Any:
    return column.ilike(like_pattern(term), escape="\\")


def paginate_query(
    session: Session,
    stmt: Select[Any],
    page: int,
    size: int,
    schema_cls: Type[SchemaT],
    post_filters: list[Callable[[Any], bool]] | None = None,
) -> PaginatedResponse[SchemaT]:
    """
    Pagina a consulta. Filtros sobre colunas JSON (listas de atributos, classes, perícias...)
    são passados em `post_filters` e aplicados ANTES do corte da página, para que `total`,
    `pages` e o conteúdo de cada página considerem todos os registros.
    """
    active_filters = [f for f in (post_filters or []) if f is not None]
    if active_filters:
        all_items = [schema_cls.model_validate(row) for row in session.execute(stmt).scalars().all()]
        matched = [item for item in all_items if all(f(item) for f in active_filters)]
        total = len(matched)
        start = (page - 1) * size
        items = matched[start : start + size]
    else:
        count_stmt = select(func.count()).select_from(stmt.subquery())
        total = session.execute(count_stmt).scalar_one()
        rows = session.execute(stmt.offset((page - 1) * size).limit(size)).scalars().all()
        items = [schema_cls.model_validate(row) for row in rows]

    pages = math.ceil(total / size) if total > 0 else 0
    return PaginatedResponse[SchemaT](
        meta=PaginationMetaSchema(
            total=total,
            page=page,
            size=size,
            pages=pages,
            has_next=page < pages,
            has_prev=page > 1,
        ),
        items=items,
    )


def get_by_slug_or_404(
    session: Session,
    model_cls: Any,
    slug: str,
    entity_label: str,
    request: Request,
    response: Response,
) -> Any:
    clean_slug = slug.lower().strip()
    stmt = select(model_cls).where(model_cls.slug == clean_slug)
    obj = session.execute(stmt).scalar_one_or_none()

    if obj is None:
        all_slugs = list(session.execute(select(model_cls.slug)).scalars().all())
        suggestions = difflib.get_close_matches(clean_slug, all_slugs, n=3, cutoff=0.45)
        raise CatalogNotFoundError(
            entity_name=entity_label,
            slug=slug,
            instance_path=str(request.url.path),
            suggestions=suggestions,
        )

    etag_seed = f"{obj.slug}:{getattr(obj, 'raw_html_hash', None)}:{getattr(obj, 'updated_at', '')}"
    etag_hash = hashlib.sha256(etag_seed.encode("utf-8")).hexdigest()[:16]
    etag = f'W/"{etag_hash}"'

    if_none_match = request.headers.get("if-none-match", "")
    client_etags = {tag.strip() for tag in if_none_match.split(",") if tag.strip()}
    if "*" in client_etags or etag in client_etags or etag.removeprefix("W/") in client_etags:
        raise NotModifiedError(etag)

    response.headers["ETag"] = etag
    response.headers["Cache-Control"] = "public, max-age=3600, stale-while-revalidate=86400"
    return obj


# =====================================================================
# 4. ENDPOINTS DO CATÁLOGO V1
# =====================================================================


@app.get("/health", tags=["Health"])
def health_check() -> dict[str, str]:
    return {"status": "ok", "edition": "D&D 5e (2024 / SRD 5.2.1)"}


# --- DOMÍNIO 1: CLASSES, SUBCLASSES E FEATURE OPTIONS ---


@app.get("/api/v1/classes", response_model=PaginatedResponse[ClassSchema], tags=["1. Classes & Subclasses"])
def list_classes(
    session: Annotated[Session, Depends(get_db)],
    page: Annotated[int, Query(ge=1)] = 1,
    size: Annotated[int, Query(ge=1, le=100)] = 20,
    q: Annotated[str | None, Query(description="Busca por nome da classe")] = None,
    primary_ability: Annotated[str | None, Query(description="Ex.: STR, DEX, INT, WIS, CHA")] = None,
    hit_die: Annotated[str | None, Query(description="Ex.: d6, d8, d10, d12")] = None,
    has_weapon_mastery: Annotated[bool | None, Query()] = None,
    is_srd: Annotated[bool | None, Query()] = None,
) -> PaginatedResponse[ClassSchema]:
    stmt = select(ClassModel)
    if q:
        stmt = stmt.where(ilike(ClassModel.name, q))
    if hit_die:
        stmt = stmt.where(ClassModel.hit_point_die == hit_die.lower().strip())
    if has_weapon_mastery is not None:
        stmt = stmt.where(ClassModel.has_weapon_mastery.is_(has_weapon_mastery))
    if is_srd is not None:
        stmt = stmt.where(ClassModel.is_srd.is_(is_srd))

    post_filters: list[Callable[[Any], bool]] = []
    if primary_ability:
        ab_upper = primary_ability.upper().strip()
        post_filters.append(lambda c: ab_upper in [a.value for a in c.primary_abilities])
    return paginate_query(session, stmt.order_by(ClassModel.name.asc()), page, size, ClassSchema, post_filters)


@app.get(
    "/api/v1/classes/{slug}",
    response_model=ClassSchema,
    responses={404: {"model": ProblemDetailsSchema}},
    tags=["1. Classes & Subclasses"],
)
def get_class_detail(
    slug: str,
    request: Request,
    response: Response,
    session: Annotated[Session, Depends(get_db)],
) -> ClassSchema:
    obj = get_by_slug_or_404(session, ClassModel, slug, "class", request, response)
    return ClassSchema.model_validate(obj)


@app.get(
    "/api/v1/classes/{slug}/levels",
    response_model=list[ClassLevelProgressionSchema],
    responses={404: {"model": ProblemDetailsSchema}},
    tags=["1. Classes & Subclasses"],
)
def get_class_levels(
    slug: str,
    request: Request,
    response: Response,
    session: Annotated[Session, Depends(get_db)],
    min_level: Annotated[int, Query(ge=1, le=20)] = 1,
    max_level: Annotated[int, Query(ge=1, le=20)] = 20,
) -> list[ClassLevelProgressionSchema]:
    obj = get_by_slug_or_404(session, ClassModel, slug, "class", request, response)
    schema = ClassSchema.model_validate(obj)
    return [row for row in schema.level_table if min_level <= row.level <= max_level]


@app.get(
    "/api/v1/classes/{slug}/levels/{level}",
    response_model=ClassLevelProgressionSchema,
    responses={404: {"model": ProblemDetailsSchema}},
    tags=["1. Classes & Subclasses"],
)
def get_class_single_level(
    slug: str,
    level: Annotated[int, Path(ge=1, le=20)],
    request: Request,
    response: Response,
    session: Annotated[Session, Depends(get_db)],
) -> ClassLevelProgressionSchema:
    obj = get_by_slug_or_404(session, ClassModel, slug, "class", request, response)
    schema = ClassSchema.model_validate(obj)
    for row in schema.level_table:
        if row.level == level:
            return row
    raise HTTPException(status_code=404, detail=f"Level {level} not found in the level table of class '{slug}'.")


@app.get(
    "/api/v1/classes/{slug}/subclasses",
    response_model=list[SubclassSchema],
    responses={404: {"model": ProblemDetailsSchema}},
    tags=["1. Classes & Subclasses"],
)
def list_class_subclasses(
    slug: str,
    request: Request,
    response: Response,
    session: Annotated[Session, Depends(get_db)],
) -> list[SubclassSchema]:
    _ = get_by_slug_or_404(session, ClassModel, slug, "class", request, response)
    rows = session.execute(
        select(SubclassModel).where(SubclassModel.parent_class_slug == slug.lower().strip()).order_by(SubclassModel.name.asc())
    ).scalars().all()
    return [SubclassSchema.model_validate(r) for r in rows]


@app.get(
    "/api/v1/subclasses/{slug}",
    response_model=SubclassSchema,
    responses={404: {"model": ProblemDetailsSchema}},
    tags=["1. Classes & Subclasses"],
)
def get_subclass_detail(
    slug: str,
    request: Request,
    response: Response,
    session: Annotated[Session, Depends(get_db)],
) -> SubclassSchema:
    obj = get_by_slug_or_404(session, SubclassModel, slug, "subclass", request, response)
    return SubclassSchema.model_validate(obj)


@app.get(
    "/api/v1/class-feature-options",
    response_model=PaginatedResponse[ClassFeatureOptionSchema],
    tags=["1. Classes & Subclasses"],
)
def list_class_feature_options(
    session: Annotated[Session, Depends(get_db)],
    page: Annotated[int, Query(ge=1)] = 1,
    size: Annotated[int, Query(ge=1, le=100)] = 20,
    class_slug: Annotated[str | None, Query()] = None,
    category: Annotated[FeatureOptionCategoryEnum | None, Query()] = None,
    max_level_prerequisite: Annotated[int | None, Query(ge=1, le=20)] = None,
    q: Annotated[str | None, Query()] = None,
) -> PaginatedResponse[ClassFeatureOptionSchema]:
    stmt = select(ClassFeatureOptionModel)
    if class_slug:
        stmt = stmt.where(ClassFeatureOptionModel.parent_class_slug == class_slug.lower().strip())
    if category:
        stmt = stmt.where(ClassFeatureOptionModel.category == category.value)
    if max_level_prerequisite is not None:
        stmt = stmt.where(ClassFeatureOptionModel.level_prerequisite <= max_level_prerequisite)
    if q:
        stmt = stmt.where(or_(ilike(ClassFeatureOptionModel.name, q), ilike(ClassFeatureOptionModel.description, q)))
    return paginate_query(
        session,
        stmt.order_by(ClassFeatureOptionModel.level_prerequisite.asc(), ClassFeatureOptionModel.name.asc()),
        page,
        size,
        ClassFeatureOptionSchema,
    )


@app.get(
    "/api/v1/class-feature-options/{slug}",
    response_model=ClassFeatureOptionSchema,
    responses={404: {"model": ProblemDetailsSchema}},
    tags=["1. Classes & Subclasses"],
)
def get_class_feature_option_detail(
    slug: str,
    request: Request,
    response: Response,
    session: Annotated[Session, Depends(get_db)],
) -> ClassFeatureOptionSchema:
    obj = get_by_slug_or_404(session, ClassFeatureOptionModel, slug, "class feature option", request, response)
    return ClassFeatureOptionSchema.model_validate(obj)


# --- DOMÍNIO 2: ORIGENS (SPECIES & BACKGROUNDS) ---


@app.get("/api/v1/species", response_model=PaginatedResponse[SpeciesSchema], tags=["2. Origins (Species & Backgrounds)"])
def list_species(
    session: Annotated[Session, Depends(get_db)],
    page: Annotated[int, Query(ge=1)] = 1,
    size: Annotated[int, Query(ge=1, le=100)] = 20,
    creature_type: Annotated[str | None, Query()] = None,
    q: Annotated[str | None, Query()] = None,
) -> PaginatedResponse[SpeciesSchema]:
    stmt = select(SpeciesModel)
    if creature_type:
        stmt = stmt.where(func.lower(SpeciesModel.creature_type) == creature_type.lower().strip())
    if q:
        stmt = stmt.where(or_(ilike(SpeciesModel.name, q), ilike(SpeciesModel.description, q)))
    return paginate_query(session, stmt.order_by(SpeciesModel.name.asc()), page, size, SpeciesSchema)


@app.get(
    "/api/v1/species/{slug}",
    response_model=SpeciesSchema,
    responses={404: {"model": ProblemDetailsSchema}},
    tags=["2. Origins (Species & Backgrounds)"],
)
def get_species_detail(
    slug: str,
    request: Request,
    response: Response,
    session: Annotated[Session, Depends(get_db)],
) -> SpeciesSchema:
    obj = get_by_slug_or_404(session, SpeciesModel, slug, "species", request, response)
    return SpeciesSchema.model_validate(obj)


@app.get(
    "/api/v1/backgrounds",
    response_model=PaginatedResponse[BackgroundSchema],
    tags=["2. Origins (Species & Backgrounds)"],
)
def list_backgrounds(
    session: Annotated[Session, Depends(get_db)],
    page: Annotated[int, Query(ge=1)] = 1,
    size: Annotated[int, Query(ge=1, le=100)] = 20,
    ability: Annotated[str | None, Query(description="Filtra antecedentes que aumentam este atributo (ex.: INT, DEX)")] = None,
    origin_feat_slug: Annotated[str | None, Query()] = None,
    skill: Annotated[str | None, Query()] = None,
    q: Annotated[str | None, Query()] = None,
) -> PaginatedResponse[BackgroundSchema]:
    stmt = select(BackgroundModel)
    if origin_feat_slug:
        stmt = stmt.where(BackgroundModel.origin_feat_slug == origin_feat_slug.lower().strip())
    if q:
        stmt = stmt.where(or_(ilike(BackgroundModel.name, q), ilike(BackgroundModel.description, q)))

    post_filters: list[Callable[[Any], bool]] = []
    if ability:
        ab_up = ability.upper().strip()
        post_filters.append(lambda b: ab_up in [a.value for a in b.ability_scores])
    if skill:
        sk_low = skill.lower().strip()
        post_filters.append(lambda b: any(sk_low in s.lower() for s in b.skill_proficiencies))
    return paginate_query(
        session, stmt.order_by(BackgroundModel.name.asc()), page, size, BackgroundSchema, post_filters
    )


@app.get(
    "/api/v1/backgrounds/{slug}",
    response_model=BackgroundSchema,
    responses={404: {"model": ProblemDetailsSchema}},
    tags=["2. Origins (Species & Backgrounds)"],
)
def get_background_detail(
    slug: str,
    request: Request,
    response: Response,
    session: Annotated[Session, Depends(get_db)],
) -> BackgroundSchema:
    obj = get_by_slug_or_404(session, BackgroundModel, slug, "background", request, response)
    return BackgroundSchema.model_validate(obj)


# --- DOMÍNIO 3: TALENTOS / FEATS ---


@app.get("/api/v1/feats", response_model=PaginatedResponse[FeatSchema], tags=["3. Feats (Talentos 2024)"])
def list_feats(
    session: Annotated[Session, Depends(get_db)],
    page: Annotated[int, Query(ge=1)] = 1,
    size: Annotated[int, Query(ge=1, le=100)] = 20,
    category: Annotated[FeatCategoryEnum | None, Query()] = None,
    max_level: Annotated[int | None, Query(ge=1, le=20)] = None,
    repeatable: Annotated[bool | None, Query()] = None,
    ability_increase: Annotated[str | None, Query(description="Filtra talentos que concedem +1 no atributo (ex.: STR, DEX)")] = None,
    q: Annotated[str | None, Query()] = None,
) -> PaginatedResponse[FeatSchema]:
    stmt = select(FeatModel)
    if category:
        stmt = stmt.where(FeatModel.category == category.value)
    if max_level is not None:
        stmt = stmt.where(FeatModel.level_prerequisite <= max_level)
    if repeatable is not None:
        stmt = stmt.where(FeatModel.repeatable.is_(repeatable))
    if q:
        stmt = stmt.where(or_(ilike(FeatModel.name, q), ilike(FeatModel.description, q)))

    post_filters: list[Callable[[Any], bool]] = []
    if ability_increase:
        ab_up = ability_increase.upper().strip()
        post_filters.append(lambda f: ab_up in [a.value for a in f.ability_score_increase_options])
    return paginate_query(
        session,
        stmt.order_by(FeatModel.level_prerequisite.asc(), FeatModel.name.asc()),
        page,
        size,
        FeatSchema,
        post_filters,
    )


@app.get(
    "/api/v1/feats/{slug}",
    response_model=FeatSchema,
    responses={404: {"model": ProblemDetailsSchema}},
    tags=["3. Feats (Talentos 2024)"],
)
def get_feat_detail(
    slug: str,
    request: Request,
    response: Response,
    session: Annotated[Session, Depends(get_db)],
) -> FeatSchema:
    obj = get_by_slug_or_404(session, FeatModel, slug, "feat", request, response)
    return FeatSchema.model_validate(obj)


# --- DOMÍNIO 4: MAGIAS / SPELLS ---


@app.get("/api/v1/spells", response_model=PaginatedResponse[SpellSchema], tags=["4. Spells (Magias 2024)"])
def list_spells(
    session: Annotated[Session, Depends(get_db)],
    page: Annotated[int, Query(ge=1)] = 1,
    size: Annotated[int, Query(ge=1, le=100)] = 20,
    level: Annotated[int | None, Query(ge=0, le=9)] = None,
    school: Annotated[SpellSchoolEnum | None, Query()] = None,
    class_slug: Annotated[str | None, Query(description="Ex.: wizard, cleric, sorcerer")] = None,
    concentration: Annotated[bool | None, Query()] = None,
    ritual: Annotated[bool | None, Query()] = None,
    casting_time: Annotated[str | None, Query()] = None,
    damage_type: Annotated[str | None, Query()] = None,
    q: Annotated[str | None, Query()] = None,
) -> PaginatedResponse[SpellSchema]:
    stmt = select(SpellModel)
    if level is not None:
        stmt = stmt.where(SpellModel.level == level)
    if school:
        stmt = stmt.where(SpellModel.school == school.value)
    if concentration is not None:
        stmt = stmt.where(SpellModel.concentration.is_(concentration))
    if ritual is not None:
        stmt = stmt.where(SpellModel.ritual.is_(ritual))
    if casting_time:
        stmt = stmt.where(ilike(SpellModel.casting_time, casting_time))
    if q:
        stmt = stmt.where(or_(ilike(SpellModel.name, q), ilike(SpellModel.description, q)))

    post_filters: list[Callable[[Any], bool]] = []
    if class_slug:
        c_low = class_slug.lower().strip()
        post_filters.append(lambda s: c_low in [cl.lower() for cl in s.class_lists])
    if damage_type:
        dt_low = damage_type.lower().strip()
        post_filters.append(lambda s: any(dt_low == d.value.lower() for d in s.damage_types))
    return paginate_query(
        session,
        stmt.order_by(SpellModel.level.asc(), SpellModel.name.asc()),
        page,
        size,
        SpellSchema,
        post_filters,
    )


@app.get(
    "/api/v1/spells/{slug}",
    response_model=SpellSchema,
    responses={404: {"model": ProblemDetailsSchema}},
    tags=["4. Spells (Magias 2024)"],
)
def get_spell_detail(
    slug: str,
    request: Request,
    response: Response,
    session: Annotated[Session, Depends(get_db)],
) -> SpellSchema:
    obj = get_by_slug_or_404(session, SpellModel, slug, "spell", request, response)
    return SpellSchema.model_validate(obj)


# --- DOMÍNIO 5: EQUIPAMENTOS, ARMAS, MAESTRIAS, FERRAMENTAS E ITENS MÁGICOS ---


@app.get(
    "/api/v1/equipment/weapon-masteries",
    response_model=list[WeaponMasterySchema],
    tags=["5. Equipment & Magic Items"],
)
def list_weapon_masteries(session: Annotated[Session, Depends(get_db)]) -> list[WeaponMasterySchema]:
    rows = session.execute(select(WeaponMasteryModel).order_by(WeaponMasteryModel.slug.asc())).scalars().all()
    return [WeaponMasterySchema.model_validate(r) for r in rows]


@app.get(
    "/api/v1/equipment/weapon-masteries/{slug}",
    response_model=WeaponMasterySchema,
    responses={404: {"model": ProblemDetailsSchema}},
    tags=["5. Equipment & Magic Items"],
)
def get_weapon_mastery_detail(
    slug: str,
    request: Request,
    response: Response,
    session: Annotated[Session, Depends(get_db)],
) -> WeaponMasterySchema:
    obj = get_by_slug_or_404(session, WeaponMasteryModel, slug, "weapon mastery", request, response)
    return WeaponMasterySchema.model_validate(obj)


@app.get(
    "/api/v1/equipment/weapons",
    response_model=PaginatedResponse[WeaponSchema],
    tags=["5. Equipment & Magic Items"],
)
def list_weapons(
    session: Annotated[Session, Depends(get_db)],
    page: Annotated[int, Query(ge=1)] = 1,
    size: Annotated[int, Query(ge=1, le=100)] = 20,
    category: Annotated[str | None, Query()] = None,
    mastery: Annotated[str | None, Query(description="Slug da maestria (ex.: sap, cleave, vex, nick)")] = None,
    damage_type: Annotated[str | None, Query()] = None,
    q: Annotated[str | None, Query()] = None,
) -> PaginatedResponse[WeaponSchema]:
    stmt = select(WeaponModel)
    if category:
        stmt = stmt.where(ilike(WeaponModel.category, category))
    if mastery:
        stmt = stmt.where(WeaponModel.mastery_slug == mastery.lower().strip())
    if damage_type:
        stmt = stmt.where(func.lower(WeaponModel.damage_type) == damage_type.lower().strip())
    if q:
        stmt = stmt.where(ilike(WeaponModel.name, q))
    return paginate_query(session, stmt.order_by(WeaponModel.name.asc()), page, size, WeaponSchema)


@app.get(
    "/api/v1/equipment/weapons/{slug}",
    response_model=WeaponSchema,
    responses={404: {"model": ProblemDetailsSchema}},
    tags=["5. Equipment & Magic Items"],
)
def get_weapon_detail(
    slug: str,
    request: Request,
    response: Response,
    session: Annotated[Session, Depends(get_db)],
) -> WeaponSchema:
    obj = get_by_slug_or_404(session, WeaponModel, slug, "weapon", request, response)
    return WeaponSchema.model_validate(obj)


@app.get(
    "/api/v1/equipment/armor",
    response_model=PaginatedResponse[ArmorSchema],
    tags=["5. Equipment & Magic Items"],
)
def list_armors(
    session: Annotated[Session, Depends(get_db)],
    page: Annotated[int, Query(ge=1)] = 1,
    size: Annotated[int, Query(ge=1, le=100)] = 20,
    category: Annotated[ArmorCategoryEnum | None, Query()] = None,
    stealth_disadvantage: Annotated[bool | None, Query()] = None,
) -> PaginatedResponse[ArmorSchema]:
    stmt = select(ArmorModel)
    if category:
        stmt = stmt.where(ArmorModel.category == category.value)
    if stealth_disadvantage is not None:
        stmt = stmt.where(ArmorModel.stealth_disadvantage.is_(stealth_disadvantage))
    return paginate_query(session, stmt.order_by(ArmorModel.base_ac.asc()), page, size, ArmorSchema)


@app.get(
    "/api/v1/equipment/armor/{slug}",
    response_model=ArmorSchema,
    responses={404: {"model": ProblemDetailsSchema}},
    tags=["5. Equipment & Magic Items"],
)
def get_armor_detail(
    slug: str,
    request: Request,
    response: Response,
    session: Annotated[Session, Depends(get_db)],
) -> ArmorSchema:
    obj = get_by_slug_or_404(session, ArmorModel, slug, "armor", request, response)
    return ArmorSchema.model_validate(obj)


@app.get(
    "/api/v1/equipment/tools",
    response_model=PaginatedResponse[ToolSchema],
    tags=["5. Equipment & Magic Items"],
)
def list_tools(
    session: Annotated[Session, Depends(get_db)],
    page: Annotated[int, Query(ge=1)] = 1,
    size: Annotated[int, Query(ge=1, le=100)] = 20,
    ability: Annotated[str | None, Query()] = None,
    q: Annotated[str | None, Query()] = None,
) -> PaginatedResponse[ToolSchema]:
    stmt = select(ToolModel)
    if ability:
        stmt = stmt.where(ToolModel.ability == ability.upper().strip())
    if q:
        stmt = stmt.where(ilike(ToolModel.name, q))
    return paginate_query(session, stmt.order_by(ToolModel.name.asc()), page, size, ToolSchema)


@app.get(
    "/api/v1/equipment/tools/{slug}",
    response_model=ToolSchema,
    responses={404: {"model": ProblemDetailsSchema}},
    tags=["5. Equipment & Magic Items"],
)
def get_tool_detail(
    slug: str,
    request: Request,
    response: Response,
    session: Annotated[Session, Depends(get_db)],
) -> ToolSchema:
    obj = get_by_slug_or_404(session, ToolModel, slug, "tool", request, response)
    return ToolSchema.model_validate(obj)


@app.get(
    "/api/v1/equipment/gear",
    response_model=PaginatedResponse[AdventuringGearSchema],
    tags=["5. Equipment & Magic Items"],
)
def list_gear(
    session: Annotated[Session, Depends(get_db)],
    page: Annotated[int, Query(ge=1)] = 1,
    size: Annotated[int, Query(ge=1, le=100)] = 20,
    q: Annotated[str | None, Query()] = None,
) -> PaginatedResponse[AdventuringGearSchema]:
    stmt = select(AdventuringGearModel)
    if q:
        stmt = stmt.where(ilike(AdventuringGearModel.name, q))
    return paginate_query(session, stmt.order_by(AdventuringGearModel.name.asc()), page, size, AdventuringGearSchema)


@app.get(
    "/api/v1/equipment/gear/{slug}",
    response_model=AdventuringGearSchema,
    responses={404: {"model": ProblemDetailsSchema}},
    tags=["5. Equipment & Magic Items"],
)
def get_gear_detail(
    slug: str,
    request: Request,
    response: Response,
    session: Annotated[Session, Depends(get_db)],
) -> AdventuringGearSchema:
    obj = get_by_slug_or_404(session, AdventuringGearModel, slug, "adventuring gear", request, response)
    return AdventuringGearSchema.model_validate(obj)


@app.get(
    "/api/v1/magic-items",
    response_model=PaginatedResponse[MagicItemSchema],
    tags=["5. Equipment & Magic Items"],
)
def list_magic_items(
    session: Annotated[Session, Depends(get_db)],
    page: Annotated[int, Query(ge=1)] = 1,
    size: Annotated[int, Query(ge=1, le=100)] = 20,
    rarity: Annotated[MagicItemRarityEnum | None, Query()] = None,
    requires_attunement: Annotated[bool | None, Query()] = None,
    q: Annotated[str | None, Query()] = None,
) -> PaginatedResponse[MagicItemSchema]:
    stmt = select(MagicItemModel)
    if rarity:
        stmt = stmt.where(MagicItemModel.rarity == rarity.value)
    if requires_attunement is not None:
        stmt = stmt.where(MagicItemModel.requires_attunement.is_(requires_attunement))
    if q:
        stmt = stmt.where(ilike(MagicItemModel.name, q))
    return paginate_query(session, stmt.order_by(MagicItemModel.name.asc()), page, size, MagicItemSchema)


@app.get(
    "/api/v1/magic-items/{slug}",
    response_model=MagicItemSchema,
    responses={404: {"model": ProblemDetailsSchema}},
    tags=["5. Equipment & Magic Items"],
)
def get_magic_item_detail(
    slug: str,
    request: Request,
    response: Response,
    session: Annotated[Session, Depends(get_db)],
) -> MagicItemSchema:
    obj = get_by_slug_or_404(session, MagicItemModel, slug, "magic item", request, response)
    return MagicItemSchema.model_validate(obj)


# --- DOMÍNIO 6: MONSTROS, BASTIÕES, GLOSSÁRIO DE REGRAS E BUSCA GLOBAL ---


@app.get("/api/v1/monsters", response_model=PaginatedResponse[MonsterSchema], tags=["6. Monsters, Bastions & Rules"])
def list_monsters(
    session: Annotated[Session, Depends(get_db)],
    page: Annotated[int, Query(ge=1)] = 1,
    size: Annotated[int, Query(ge=1, le=100)] = 20,
    min_cr: Annotated[float | None, Query(ge=0)] = None,
    max_cr: Annotated[float | None, Query(ge=0)] = None,
    creature_type: Annotated[str | None, Query()] = None,
    q: Annotated[str | None, Query()] = None,
) -> PaginatedResponse[MonsterSchema]:
    stmt = select(MonsterModel)
    if min_cr is not None:
        stmt = stmt.where(MonsterModel.cr_numeric >= min_cr)
    if max_cr is not None:
        stmt = stmt.where(MonsterModel.cr_numeric <= max_cr)
    if creature_type:
        stmt = stmt.where(ilike(MonsterModel.creature_type, creature_type))
    if q:
        stmt = stmt.where(ilike(MonsterModel.name, q))
    return paginate_query(
        session,
        stmt.order_by(MonsterModel.cr_numeric.asc(), MonsterModel.name.asc()),
        page,
        size,
        MonsterSchema,
    )


@app.get(
    "/api/v1/monsters/{slug}",
    response_model=MonsterSchema,
    responses={404: {"model": ProblemDetailsSchema}},
    tags=["6. Monsters, Bastions & Rules"],
)
def get_monster_detail(
    slug: str,
    request: Request,
    response: Response,
    session: Annotated[Session, Depends(get_db)],
) -> MonsterSchema:
    obj = get_by_slug_or_404(session, MonsterModel, slug, "monster", request, response)
    return MonsterSchema.model_validate(obj)


@app.get(
    "/api/v1/bastion-facilities",
    response_model=PaginatedResponse[BastionFacilitySchema],
    tags=["6. Monsters, Bastions & Rules"],
)
def list_bastion_facilities(
    session: Annotated[Session, Depends(get_db)],
    page: Annotated[int, Query(ge=1)] = 1,
    size: Annotated[int, Query(ge=1, le=100)] = 20,
    max_level: Annotated[int | None, Query(ge=1, le=20)] = None,
    order: Annotated[str | None, Query()] = None,
) -> PaginatedResponse[BastionFacilitySchema]:
    stmt = select(BastionFacilityModel)
    if max_level is not None:
        stmt = stmt.where(BastionFacilityModel.level_prerequisite <= max_level)
    if order:
        stmt = stmt.where(func.lower(BastionFacilityModel.bastion_order) == order.lower().strip())
    return paginate_query(
        session,
        stmt.order_by(BastionFacilityModel.level_prerequisite.asc(), BastionFacilityModel.name.asc()),
        page,
        size,
        BastionFacilitySchema,
    )


@app.get(
    "/api/v1/bastion-facilities/{slug}",
    response_model=BastionFacilitySchema,
    responses={404: {"model": ProblemDetailsSchema}},
    tags=["6. Monsters, Bastions & Rules"],
)
def get_bastion_facility_detail(
    slug: str,
    request: Request,
    response: Response,
    session: Annotated[Session, Depends(get_db)],
) -> BastionFacilitySchema:
    obj = get_by_slug_or_404(session, BastionFacilityModel, slug, "bastion facility", request, response)
    return BastionFacilitySchema.model_validate(obj)


@app.get("/api/v1/rules", response_model=PaginatedResponse[RuleGlossarySchema], tags=["6. Monsters, Bastions & Rules"])
def list_rules(
    session: Annotated[Session, Depends(get_db)],
    page: Annotated[int, Query(ge=1)] = 1,
    size: Annotated[int, Query(ge=1, le=100)] = 20,
    tag: Annotated[RuleGlossaryTagEnum | None, Query()] = None,
    q: Annotated[str | None, Query()] = None,
) -> PaginatedResponse[RuleGlossarySchema]:
    stmt = select(RuleGlossaryModel)
    if tag:
        stmt = stmt.where(RuleGlossaryModel.tag == tag.value)
    if q:
        stmt = stmt.where(or_(ilike(RuleGlossaryModel.name, q), ilike(RuleGlossaryModel.summary, q)))
    return paginate_query(session, stmt.order_by(RuleGlossaryModel.name.asc()), page, size, RuleGlossarySchema)


@app.get(
    "/api/v1/rules/{slug}",
    response_model=RuleGlossarySchema,
    responses={404: {"model": ProblemDetailsSchema}},
    tags=["6. Monsters, Bastions & Rules"],
)
def get_rule_detail(
    slug: str,
    request: Request,
    response: Response,
    session: Annotated[Session, Depends(get_db)],
) -> RuleGlossarySchema:
    obj = get_by_slug_or_404(session, RuleGlossaryModel, slug, "rule", request, response)
    return RuleGlossarySchema.model_validate(obj)


@app.get("/api/v1/search", response_model=OmniSearchResponseSchema, tags=["6. Monsters, Bastions & Rules"])
def omni_search(
    q: Annotated[str, Query(min_length=2, description="Termo de busca global no catálogo 2024")],
    session: Annotated[Session, Depends(get_db)],
    limit_per_type: Annotated[int, Query(ge=1, le=20)] = 5,
) -> OmniSearchResponseSchema:
    term = q.strip()
    if len(term) < 2:
        raise HTTPException(status_code=422, detail="Search term must have at least 2 non-blank characters.")

    searchable_models: list[tuple[str, Any, str]] = [
        ("spells", SpellModel, "/api/v1/spells"),
        ("feats", FeatModel, "/api/v1/feats"),
        ("classes", ClassModel, "/api/v1/classes"),
        ("subclasses", SubclassModel, "/api/v1/subclasses"),
        ("class_feature_options", ClassFeatureOptionModel, "/api/v1/class-feature-options"),
        ("species", SpeciesModel, "/api/v1/species"),
        ("backgrounds", BackgroundModel, "/api/v1/backgrounds"),
        ("weapons", WeaponModel, "/api/v1/equipment/weapons"),
        ("armor", ArmorModel, "/api/v1/equipment/armor"),
        ("tools", ToolModel, "/api/v1/equipment/tools"),
        ("gear", AdventuringGearModel, "/api/v1/equipment/gear"),
        ("magic_items", MagicItemModel, "/api/v1/magic-items"),
        ("monsters", MonsterModel, "/api/v1/monsters"),
        ("bastion_facilities", BastionFacilityModel, "/api/v1/bastion-facilities"),
        ("rules", RuleGlossaryModel, "/api/v1/rules"),
    ]

    results_by_type: dict[str, list[OmniSearchResultItemSchema]] = {}
    total_matches = 0

    for type_key, model_cls, base_path in searchable_models:
        stmt = select(model_cls).where(ilike(model_cls.name, term)).order_by(model_cls.name.asc()).limit(limit_per_type)
        rows = session.execute(stmt).scalars().all()
        if rows:
            items = [
                OmniSearchResultItemSchema(
                    entity_type=type_key,
                    slug=r.slug,
                    name=r.name,
                    summary=(
                        getattr(r, "summary", None)
                        or getattr(r, "short_description", None)
                        or (getattr(r, "description", None) or "")[:140]
                    ),
                    api_path=f"{base_path}/{r.slug}",
                    source_book=r.source_book,
                )
                for r in rows
            ]
            results_by_type[type_key] = items
            total_matches += len(items)

    return OmniSearchResponseSchema(
        query=term,
        total_matches=total_matches,
        results_by_type=results_by_type,
    )
