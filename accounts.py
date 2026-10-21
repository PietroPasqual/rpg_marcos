"""
Contas e sincronização de fichas (opcional).

O catálogo do SRD é somente leitura e vive em outro banco. Aqui ficam só as contas (e-mail + senha) e as fichas
de cada pessoa, em um banco separado (ACCOUNTS_DATABASE_URL) que nunca é recriado quando o catálogo é reimportado.

Rotas (todas sob /api/v1):
  GET    /auth/status            contas disponíveis? cadastro aberto?
  POST   /auth/register          cria a conta e já devolve o token
  POST   /auth/login
  GET    /auth/me
  POST   /auth/change-password   troca a senha e invalida os outros logins
  POST   /auth/logout-all        invalida todos os tokens da conta
  DELETE /auth/me                exclui a conta e as fichas (exige a senha)
  GET    /sync/characters        todas as fichas (inclusive as excluídas, como marcadores)
  PUT    /sync/characters/{id}   grava a ficha (a mais recente vence)
  DELETE /sync/characters/{id}   marca a ficha como excluída

Variáveis de ambiente: ACCOUNTS_DATABASE_URL, ACCOUNTS_SECRET (assinatura dos tokens; sem ela, um segredo é gerado
e guardado no próprio banco), ACCOUNTS_REGISTRATION=closed (fecha novos cadastros), ACCOUNTS_TRUST_PROXY=1 (usa o
X-Forwarded-For para limitar tentativas por IP), ACCOUNTS_TOKEN_DAYS (padrão 30).
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import time
import uuid
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone
from typing import Annotated, Any, Generator

import jwt
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy import Boolean, ForeignKey, Integer, String, Text, create_engine, delete, func, select
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker

ACCOUNTS_DATABASE_URL = os.getenv("ACCOUNTS_DATABASE_URL", "sqlite:///./dnd5e_accounts.db")
TOKEN_DAYS = int(os.getenv("ACCOUNTS_TOKEN_DAYS", "30"))
MAX_CHARACTERS_PER_USER = 500
MAX_CHARACTER_BYTES = 512 * 1024
MIN_PASSWORD_LENGTH = 8
MAX_PASSWORD_LENGTH = 200

_connect_args = {"check_same_thread": False} if ACCOUNTS_DATABASE_URL.startswith("sqlite") else {}
accounts_engine = create_engine(ACCOUNTS_DATABASE_URL, connect_args=_connect_args, future=True)
AccountsSession = sessionmaker(bind=accounts_engine, autoflush=False, autocommit=False, expire_on_commit=False)


class AccountsBase(DeclarativeBase):
    pass


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


class UserModel(AccountsBase):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: uuid.uuid4().hex)
    email: Mapped[str] = mapped_column(String(254), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(300))
    token_version: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[str] = mapped_column(String(30), default=_now)


class CharacterRecord(AccountsBase):
    __tablename__ = "characters"
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    data: Mapped[str] = mapped_column(Text, default="{}")
    updated_at: Mapped[str] = mapped_column(String(30))
    deleted: Mapped[bool] = mapped_column(Boolean, default=False)
    server_updated_at: Mapped[str] = mapped_column(String(30), default=_now)


class SettingModel(AccountsBase):
    __tablename__ = "settings"
    key: Mapped[str] = mapped_column(String(50), primary_key=True)
    value: Mapped[str] = mapped_column(String(200))


_ready = False


def init_accounts_db() -> None:
    """Cria as tabelas (uma vez por processo)."""
    global _ready
    if not _ready:
        AccountsBase.metadata.create_all(bind=accounts_engine)
        _ready = True


def get_accounts_db() -> Generator[Session, None, None]:
    init_accounts_db()
    with AccountsSession() as session:
        yield session


DbDep = Annotated[Session, Depends(get_accounts_db)]

# ---------------------------------------------------------------------------------------------
# Senhas e tokens
# ---------------------------------------------------------------------------------------------

_SCRYPT_N, _SCRYPT_R, _SCRYPT_P = 2**14, 8, 1


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=_SCRYPT_N, r=_SCRYPT_R, p=_SCRYPT_P, dklen=32)
    return f"scrypt${_SCRYPT_N}${_SCRYPT_R}${_SCRYPT_P}${base64.b64encode(salt).decode()}${base64.b64encode(digest).decode()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _, n, r, p, salt, digest = stored.split("$")
        candidate = hashlib.scrypt(password.encode(), salt=base64.b64decode(salt), n=int(n), r=int(r), p=int(p), dklen=32)
        return hmac.compare_digest(candidate, base64.b64decode(digest))
    except (ValueError, TypeError):
        return False


_DUMMY_HASH = hash_password("dummy-password-for-timing")  # login de e-mail inexistente custa o mesmo tempo


def _secret(session: Session) -> str:
    env = os.getenv("ACCOUNTS_SECRET")
    if env:
        return env
    row = session.get(SettingModel, "jwt_secret")
    if row is None:
        row = SettingModel(key="jwt_secret", value=secrets.token_urlsafe(48))
        session.add(row)
        session.commit()
    return row.value


def issue_token(session: Session, user: UserModel) -> str:
    now = datetime.now(timezone.utc)
    payload = {"sub": user.id, "ver": user.token_version, "iat": now, "exp": now + timedelta(days=TOKEN_DAYS)}
    return jwt.encode(payload, _secret(session), algorithm="HS256")


def current_user(request: Request, session: DbDep) -> UserModel:
    header = request.headers.get("Authorization", "")
    scheme, _, token = header.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(status_code=401, detail="Faça login para continuar.", headers={"WWW-Authenticate": "Bearer"})
    try:
        payload = jwt.decode(token, _secret(session), algorithms=["HS256"])
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Sessão expirada ou inválida. Entre de novo.", headers={"WWW-Authenticate": "Bearer"})
    user = session.get(UserModel, payload.get("sub"))
    if user is None or user.token_version != payload.get("ver"):
        raise HTTPException(status_code=401, detail="Sessão expirada ou inválida. Entre de novo.", headers={"WWW-Authenticate": "Bearer"})
    return user


UserDep = Annotated[UserModel, Depends(current_user)]

# ---------------------------------------------------------------------------------------------
# Limite de tentativas (em memória: protege contra força bruta em uma instância)
# ---------------------------------------------------------------------------------------------


class RateLimiter:
    def __init__(self, limit: int, window_seconds: int) -> None:
        self.limit, self.window = limit, window_seconds
        self.hits: dict[str, deque[float]] = defaultdict(deque)

    def _recent(self, key: str) -> deque[float]:
        now = time.monotonic()
        hits = self.hits[key]
        while hits and now - hits[0] > self.window:
            hits.popleft()
        if not hits:
            del self.hits[key]  # não acumula chaves antigas
            return self.hits[key]
        return hits

    def guard(self, key: str) -> None:
        """Recusa (429) se a chave já atingiu o limite, sem contar esta tentativa."""
        hits = self._recent(key)
        if len(hits) >= self.limit:
            retry = int(self.window - (time.monotonic() - hits[0])) + 1
            raise HTTPException(status_code=429, detail="Muitas tentativas. Aguarde alguns minutos e tente de novo.", headers={"Retry-After": str(retry)})

    def record(self, key: str) -> None:
        self._recent(key).append(time.monotonic())

    def check(self, key: str) -> None:
        """Recusa se atingiu o limite; senão conta esta tentativa."""
        self.guard(key)
        self.record(key)

    def reset(self) -> None:
        self.hits.clear()


auth_limiter = RateLimiter(limit=10, window_seconds=300)
register_limiter = RateLimiter(limit=5, window_seconds=3600)


def client_key(request: Request) -> str:
    if os.getenv("ACCOUNTS_TRUST_PROXY") == "1":
        # O último endereço é o que o proxy confiável acrescentou; os anteriores vêm do cliente e podem ser forjados.
        forwarded = request.headers.get("X-Forwarded-For", "").split(",")[-1].strip()
        if forwarded:
            return forwarded
    return request.client.host if request.client else "unknown"


# ---------------------------------------------------------------------------------------------
# Esquemas
# ---------------------------------------------------------------------------------------------

_EMAIL = re.compile(r"^[^@\s]{1,64}@[^@\s]{1,189}\.[^@\s.]{2,}$")
_CHARACTER_ID = re.compile(r"^[A-Za-z0-9_-]{8,64}$")
_TIMESTAMP = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$")


def normalize_email(email: str) -> str:
    email = email.strip().lower()
    if len(email) > 254 or not _EMAIL.match(email):
        raise HTTPException(status_code=422, detail="Informe um e-mail válido.")
    return email


def check_password_rules(password: str) -> None:
    if len(password) < MIN_PASSWORD_LENGTH:
        raise HTTPException(status_code=422, detail=f"A senha precisa ter pelo menos {MIN_PASSWORD_LENGTH} caracteres.")
    if len(password) > MAX_PASSWORD_LENGTH:
        raise HTTPException(status_code=422, detail=f"A senha pode ter no máximo {MAX_PASSWORD_LENGTH} caracteres.")


class Credentials(BaseModel):
    email: str = Field(max_length=254)
    password: str = Field(max_length=MAX_PASSWORD_LENGTH + 100)


class ChangePassword(BaseModel):
    current_password: str = Field(max_length=MAX_PASSWORD_LENGTH + 100)
    new_password: str = Field(max_length=MAX_PASSWORD_LENGTH + 100)


class PasswordOnly(BaseModel):
    password: str = Field(max_length=MAX_PASSWORD_LENGTH + 100)


class CharacterPut(BaseModel):
    data: dict[str, Any]
    updated_at: str


def _user_payload(user: UserModel) -> dict[str, str]:
    return {"id": user.id, "email": user.email}


def _session_payload(session: Session, user: UserModel) -> dict[str, Any]:
    return {"access_token": issue_token(session, user), "token_type": "bearer", "expires_in_days": TOKEN_DAYS, "user": _user_payload(user)}


def _check_timestamp(value: str, field: str) -> str:
    """Valida e normaliza para milissegundos fixos (YYYY-MM-DDTHH:MM:SS.mmmZ), para que comparar as strings compare as datas."""
    match = _TIMESTAMP.match(value)
    if not match:
        raise HTTPException(status_code=422, detail=f"{field} deve ser uma data ISO 8601 em UTC (ex.: 2026-01-31T12:00:00.000Z).")
    fraction = (match.group(1) or ".")[1:]
    return f"{value[:19]}.{(fraction + '000')[:3]}Z"


def _record_payload(row: CharacterRecord) -> dict[str, Any]:
    return {"id": row.id, "data": json.loads(row.data) if not row.deleted else None, "updated_at": row.updated_at, "deleted": row.deleted, "server_updated_at": row.server_updated_at}


# ---------------------------------------------------------------------------------------------
# Rotas
# ---------------------------------------------------------------------------------------------

router = APIRouter(prefix="/api/v1", tags=["7. Accounts & Sync"])


def registration_open() -> bool:
    return os.getenv("ACCOUNTS_REGISTRATION", "open").lower() != "closed"


@router.get("/auth/status")
def accounts_status() -> dict[str, Any]:
    return {"enabled": True, "registration_open": registration_open(), "min_password_length": MIN_PASSWORD_LENGTH}


@router.post("/auth/register", status_code=201)
def register(body: Credentials, request: Request, session: DbDep) -> dict[str, Any]:
    if not registration_open():
        raise HTTPException(status_code=403, detail="Novos cadastros estão fechados neste servidor.")
    register_limiter.check(client_key(request))
    email = normalize_email(body.email)
    check_password_rules(body.password)
    if session.scalar(select(UserModel).where(UserModel.email == email)):
        raise HTTPException(status_code=409, detail="Já existe uma conta com este e-mail.")
    user = UserModel(email=email, password_hash=hash_password(body.password))
    session.add(user)
    try:
        session.commit()
    except IntegrityError:  # dois cadastros simultâneos com o mesmo e-mail
        session.rollback()
        raise HTTPException(status_code=409, detail="Já existe uma conta com este e-mail.")
    return _session_payload(session, user)


@router.post("/auth/login")
def login(body: Credentials, request: Request, session: DbDep) -> dict[str, Any]:
    email = body.email.strip().lower()
    ip_key, email_key = f"ip:{client_key(request)}", f"email:{email}"
    auth_limiter.guard(ip_key)
    auth_limiter.guard(email_key)
    user = session.scalar(select(UserModel).where(UserModel.email == email))
    ok = verify_password(body.password, user.password_hash if user else _DUMMY_HASH)
    if not user or not ok:
        # Só tentativas erradas contam: um login correto nunca é bloqueado por logins anteriores bem-sucedidos.
        auth_limiter.record(ip_key)
        auth_limiter.record(email_key)
        raise HTTPException(status_code=401, detail="E-mail ou senha incorretos.")
    return _session_payload(session, user)


@router.get("/auth/me")
def me(user: UserDep, session: DbDep) -> dict[str, Any]:
    count = session.scalar(select(func.count()).select_from(CharacterRecord).where(CharacterRecord.user_id == user.id, CharacterRecord.deleted.is_(False)))
    return {**_user_payload(user), "created_at": user.created_at, "characters": count or 0}


@router.post("/auth/change-password")
def change_password(body: ChangePassword, user: UserDep, request: Request, session: DbDep) -> dict[str, Any]:
    auth_limiter.check(f"email:{user.email}")
    if not verify_password(body.current_password, user.password_hash):
        raise HTTPException(status_code=401, detail="A senha atual está incorreta.")
    check_password_rules(body.new_password)
    user.password_hash = hash_password(body.new_password)
    user.token_version += 1
    session.commit()
    return _session_payload(session, user)


@router.post("/auth/logout-all")
def logout_all(user: UserDep, session: DbDep) -> dict[str, str]:
    user.token_version += 1
    session.commit()
    return {"detail": "Todos os logins desta conta foram encerrados."}


@router.delete("/auth/me", status_code=204)
def delete_account(body: PasswordOnly, user: UserDep, session: DbDep) -> None:
    auth_limiter.check(f"email:{user.email}")
    if not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="A senha está incorreta.")
    session.execute(delete(CharacterRecord).where(CharacterRecord.user_id == user.id))
    session.delete(user)
    session.commit()


def _character_id(character_id: str) -> str:
    if not _CHARACTER_ID.match(character_id):
        raise HTTPException(status_code=422, detail="Identificador de ficha inválido.")
    return character_id


@router.get("/sync/characters")
def list_characters(user: UserDep, session: DbDep) -> dict[str, Any]:
    rows = session.scalars(select(CharacterRecord).where(CharacterRecord.user_id == user.id).order_by(CharacterRecord.updated_at.desc())).all()
    return {"items": [_record_payload(r) for r in rows], "server_time": _now()}


@router.put("/sync/characters/{character_id}")
def put_character(character_id: str, body: CharacterPut, user: UserDep, session: DbDep) -> dict[str, Any]:
    character_id = _character_id(character_id)
    updated_at = _check_timestamp(body.updated_at, "updated_at")
    if body.data.get("id") != character_id or body.data.get("schema") != 1:
        raise HTTPException(status_code=422, detail="Os dados não são uma ficha válida deste site.")
    raw = json.dumps(body.data, ensure_ascii=False, separators=(",", ":"))
    if len(raw.encode()) > MAX_CHARACTER_BYTES:
        raise HTTPException(status_code=413, detail="A ficha é grande demais para sincronizar.")

    row = session.get(CharacterRecord, (user.id, character_id))
    if row is not None and updated_at < row.updated_at:
        raise HTTPException(status_code=409, detail="O servidor tem uma versão mais recente desta ficha.", headers={"X-Server-Updated-At": row.updated_at})
    if row is None or row.deleted:
        # Só fichas ativas contam para o limite (marcadores de exclusão não). 403, e não 409: o cliente trata 409
        # como conflito de versão e tentaria de novo sem parar.
        total = session.scalar(select(func.count()).select_from(CharacterRecord).where(CharacterRecord.user_id == user.id, CharacterRecord.deleted.is_(False))) or 0
        if total >= MAX_CHARACTERS_PER_USER:
            raise HTTPException(status_code=403, detail=f"Limite de {MAX_CHARACTERS_PER_USER} fichas por conta.")
    if row is None:
        row = CharacterRecord(user_id=user.id, id=character_id)
        session.add(row)
    row.data, row.updated_at, row.deleted, row.server_updated_at = raw, updated_at, False, _now()
    session.commit()
    return {"id": row.id, "updated_at": row.updated_at, "server_updated_at": row.server_updated_at}


@router.delete("/sync/characters/{character_id}")
def delete_character(character_id: str, user: UserDep, session: DbDep, deleted_at: str | None = None) -> dict[str, Any]:
    character_id = _character_id(character_id)
    stamp = _check_timestamp(deleted_at, "deleted_at") if deleted_at else _now()
    row = session.get(CharacterRecord, (user.id, character_id))
    if row is None:
        # O servidor nunca recebeu esta ficha: nenhum outro aparelho pode tê-la daqui, então não há marcador a guardar.
        return {"id": character_id, "updated_at": stamp, "deleted": True}
    if stamp < row.updated_at:
        raise HTTPException(status_code=409, detail="A ficha foi editada depois da exclusão.", headers={"X-Server-Updated-At": row.updated_at})
    row.data, row.updated_at, row.deleted, row.server_updated_at = "{}", stamp, True, _now()
    session.commit()
    return {"id": row.id, "updated_at": row.updated_at, "deleted": True}
