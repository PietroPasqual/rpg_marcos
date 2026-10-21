"""Testes das contas e da sincronização de fichas (accounts.py)."""

from __future__ import annotations

import jwt
import pytest
from fastapi.testclient import TestClient

import accounts
from main_api import app

client = TestClient(app)
PASSWORD = "senha-segura-123"


@pytest.fixture(autouse=True)
def _fresh_limits() -> None:
    accounts.auth_limiter.reset()
    accounts.register_limiter.reset()


def register(email: str = "ana@example.com", password: str = PASSWORD) -> dict:
    response = client.post("/api/v1/auth/register", json={"email": email, "password": password})
    assert response.status_code == 201, response.text
    return response.json()


def auth(session: dict) -> dict[str, str]:
    return {"Authorization": f"Bearer {session['access_token']}"}


def character(cid: str = "char-0001-aaaa", updated: str = "2026-01-01T10:00:00.000Z", name: str = "Mialee") -> dict:
    return {"data": {"schema": 1, "id": cid, "name": name, "updatedAt": updated}, "updated_at": updated}


def test_register_login_and_me() -> None:
    session = register("Bia@Example.com ")
    assert session["user"]["email"] == "bia@example.com"
    login = client.post("/api/v1/auth/login", json={"email": "BIA@example.com", "password": PASSWORD})
    assert login.status_code == 200
    me = client.get("/api/v1/auth/me", headers=auth(login.json())).json()
    assert me["email"] == "bia@example.com" and me["characters"] == 0
    assert client.get("/api/v1/auth/status").json()["enabled"] is True


def test_registration_validation_and_duplicates() -> None:
    register("dup@example.com")
    assert client.post("/api/v1/auth/register", json={"email": "dup@example.com", "password": PASSWORD}).status_code == 409
    assert client.post("/api/v1/auth/register", json={"email": "nao-e-email", "password": PASSWORD}).status_code == 422
    short = client.post("/api/v1/auth/register", json={"email": "curta@example.com", "password": "1234567"})
    assert short.status_code == 422 and "8" in short.json()["detail"]
    assert client.post("/api/v1/auth/register", json={"email": "x@example.com"}).status_code == 422


def test_wrong_password_and_unknown_email_look_the_same() -> None:
    register("carlos@example.com")
    wrong = client.post("/api/v1/auth/login", json={"email": "carlos@example.com", "password": "errada-errada"})
    unknown = client.post("/api/v1/auth/login", json={"email": "ninguem@example.com", "password": "errada-errada"})
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json()["detail"] == unknown.json()["detail"]


def test_passwords_are_hashed_and_tokens_are_validated() -> None:
    register("dani@example.com")
    with accounts.AccountsSession() as db:
        user = db.query(accounts.UserModel).filter_by(email="dani@example.com").one()
        assert PASSWORD not in user.password_hash and user.password_hash.startswith("scrypt$")
        secret = accounts._secret(db)
    assert client.get("/api/v1/auth/me").status_code == 401
    assert client.get("/api/v1/auth/me", headers={"Authorization": "Bearer lixo"}).status_code == 401
    forged = jwt.encode({"sub": "x", "ver": 0, "exp": 9999999999}, "outro-segredo", algorithm="HS256")
    assert client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {forged}"}).status_code == 401
    expired = jwt.encode({"sub": "x", "ver": 0, "exp": 1}, secret, algorithm="HS256")
    assert client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {expired}"}).status_code == 401
    response = client.get("/api/v1/auth/me")
    assert response.headers["www-authenticate"] == "Bearer"


def test_login_is_rate_limited() -> None:
    register("eva@example.com")
    for _ in range(10):
        assert client.post("/api/v1/auth/login", json={"email": "eva@example.com", "password": "errada-errada"}).status_code == 401
    blocked = client.post("/api/v1/auth/login", json={"email": "eva@example.com", "password": PASSWORD})
    assert blocked.status_code == 429 and int(blocked.headers["retry-after"]) > 0


def test_successful_logins_do_not_count_towards_the_limit() -> None:
    register("felipe@example.com")
    for _ in range(15):
        assert client.post("/api/v1/auth/login", json={"email": "felipe@example.com", "password": PASSWORD}).status_code == 200


def test_change_password_and_logout_all_invalidate_old_tokens() -> None:
    session = register("fabio@example.com")
    assert client.post("/api/v1/auth/change-password", headers=auth(session), json={"current_password": "errada-errada", "new_password": "nova-senha-123"}).status_code == 401
    changed = client.post("/api/v1/auth/change-password", headers=auth(session), json={"current_password": PASSWORD, "new_password": "nova-senha-123"})
    assert changed.status_code == 200
    assert client.get("/api/v1/auth/me", headers=auth(session)).status_code == 401  # token antigo
    assert client.get("/api/v1/auth/me", headers=auth(changed.json())).status_code == 200
    assert client.post("/api/v1/auth/login", json={"email": "fabio@example.com", "password": PASSWORD}).status_code == 401
    assert client.post("/api/v1/auth/logout-all", headers=auth(changed.json())).status_code == 200
    assert client.get("/api/v1/auth/me", headers=auth(changed.json())).status_code == 401


def test_sync_roundtrip_and_last_write_wins() -> None:
    session = register("gabi@example.com")
    headers = auth(session)
    first = character(updated="2026-01-01T10:00:00.000Z")
    assert client.put("/api/v1/sync/characters/char-0001-aaaa", headers=headers, json=first).status_code == 200
    listed = client.get("/api/v1/sync/characters", headers=headers).json()
    assert [(i["id"], i["deleted"], i["data"]["name"]) for i in listed["items"]] == [("char-0001-aaaa", False, "Mialee")]

    newer = character(updated="2026-01-02T10:00:00.000Z", name="Mialee II")
    assert client.put("/api/v1/sync/characters/char-0001-aaaa", headers=headers, json=newer).status_code == 200
    stale = client.put("/api/v1/sync/characters/char-0001-aaaa", headers=headers, json=first)
    assert stale.status_code == 409 and stale.headers["x-server-updated-at"] == "2026-01-02T10:00:00.000Z"
    assert client.put("/api/v1/sync/characters/char-0001-aaaa", headers=headers, json=newer).status_code == 200  # igual: idempotente
    assert client.get("/api/v1/sync/characters", headers=headers).json()["items"][0]["data"]["name"] == "Mialee II"
    assert client.get("/api/v1/auth/me", headers=headers).json()["characters"] == 1


def test_sync_delete_leaves_a_tombstone_that_a_newer_edit_can_revive() -> None:
    headers = auth(register("hugo@example.com"))
    client.put("/api/v1/sync/characters/char-0002-bbbb", headers=headers, json=character("char-0002-bbbb", "2026-01-01T10:00:00.000Z"))
    gone = client.delete("/api/v1/sync/characters/char-0002-bbbb", headers=headers, params={"deleted_at": "2026-01-03T10:00:00.000Z"})
    assert gone.status_code == 200
    [item] = client.get("/api/v1/sync/characters", headers=headers).json()["items"]
    assert item["deleted"] is True and item["data"] is None and item["updated_at"] == "2026-01-03T10:00:00.000Z"
    assert client.get("/api/v1/auth/me", headers=headers).json()["characters"] == 0
    # edição anterior à exclusão não ressuscita a ficha; uma posterior sim
    assert client.put("/api/v1/sync/characters/char-0002-bbbb", headers=headers, json=character("char-0002-bbbb", "2026-01-02T10:00:00.000Z")).status_code == 409
    assert client.put("/api/v1/sync/characters/char-0002-bbbb", headers=headers, json=character("char-0002-bbbb", "2026-01-04T10:00:00.000Z")).status_code == 200
    assert client.get("/api/v1/sync/characters", headers=headers).json()["items"][0]["deleted"] is False
    assert client.delete("/api/v1/sync/characters/char-0002-bbbb", headers=headers, params={"deleted_at": "2026-01-01T00:00:00.000Z"}).status_code == 409


def test_sync_validation() -> None:
    headers = auth(register("iris@example.com"))
    bad_id = client.put("/api/v1/sync/characters/x", headers=headers, json=character("x"))
    assert bad_id.status_code == 422
    mismatch = client.put("/api/v1/sync/characters/char-0003-cccc", headers=headers, json=character("char-0004-dddd"))
    assert mismatch.status_code == 422
    not_a_sheet = client.put("/api/v1/sync/characters/char-0003-cccc", headers=headers, json={"data": {"id": "char-0003-cccc"}, "updated_at": "2026-01-01T10:00:00.000Z"})
    assert not_a_sheet.status_code == 422
    assert client.put("/api/v1/sync/characters/char-0003-cccc", headers=headers, json={**character("char-0003-cccc"), "updated_at": "ontem"}).status_code == 422
    huge = character("char-0003-cccc")
    huge["data"]["backstory"] = "x" * (accounts.MAX_CHARACTER_BYTES + 1)
    assert client.put("/api/v1/sync/characters/char-0003-cccc", headers=headers, json=huge).status_code == 413
    assert client.put("/api/v1/sync/characters/char-0003-cccc", json=character("char-0003-cccc")).status_code == 401


def test_each_account_only_sees_its_own_characters() -> None:
    ana, beto = auth(register("ana2@example.com")), auth(register("beto2@example.com"))
    client.put("/api/v1/sync/characters/char-0005-eeee", headers=ana, json=character("char-0005-eeee", name="Da Ana"))
    assert client.get("/api/v1/sync/characters", headers=beto).json()["items"] == []
    client.put("/api/v1/sync/characters/char-0005-eeee", headers=beto, json=character("char-0005-eeee", name="Do Beto"))  # mesmo id, outra conta
    assert client.get("/api/v1/sync/characters", headers=ana).json()["items"][0]["data"]["name"] == "Da Ana"
    assert client.get("/api/v1/sync/characters", headers=beto).json()["items"][0]["data"]["name"] == "Do Beto"


def test_character_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(accounts, "MAX_CHARACTERS_PER_USER", 2)
    headers = auth(register("jose@example.com"))
    for n in range(2):
        assert client.put(f"/api/v1/sync/characters/char-limit-{n}0", headers=headers, json=character(f"char-limit-{n}0")).status_code == 200
    assert client.put("/api/v1/sync/characters/char-limit-90", headers=headers, json=character("char-limit-90")).status_code == 403


def test_delete_account_removes_everything() -> None:
    session = register("kiko@example.com")
    headers = auth(session)
    client.put("/api/v1/sync/characters/char-0006-ffff", headers=headers, json=character("char-0006-ffff"))
    assert client.request("DELETE", "/api/v1/auth/me", headers=headers, json={"password": "errada-errada"}).status_code == 401
    assert client.request("DELETE", "/api/v1/auth/me", headers=headers, json={"password": PASSWORD}).status_code == 204
    assert client.get("/api/v1/auth/me", headers=headers).status_code == 401
    assert client.post("/api/v1/auth/login", json={"email": "kiko@example.com", "password": PASSWORD}).status_code == 401
    with accounts.AccountsSession() as db:
        assert db.query(accounts.CharacterRecord).filter_by(id="char-0006-ffff", user_id=session["user"]["id"]).count() == 0


def test_closed_registration(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ACCOUNTS_REGISTRATION", "closed")
    assert client.get("/api/v1/auth/status").json()["registration_open"] is False
    assert client.post("/api/v1/auth/register", json={"email": "novo@example.com", "password": PASSWORD}).status_code == 403


def test_cors_allows_the_authorization_header_for_the_site_origin() -> None:
    preflight = client.options(
        "/api/v1/sync/characters/char-0001-aaaa",
        headers={"Origin": "https://pietropasqual.github.io", "Access-Control-Request-Method": "PUT", "Access-Control-Request-Headers": "authorization,content-type"},
    )
    assert preflight.status_code == 200
    assert "PUT" in preflight.headers["access-control-allow-methods"]
    assert "authorization" in preflight.headers["access-control-allow-headers"].lower()


def test_postgres_urls_use_the_psycopg_driver() -> None:
    assert accounts._database_url("postgres://u:p@host/db") == "postgresql+psycopg://u:p@host/db"
    assert accounts._database_url("postgresql://u:p@host/db?sslmode=require") == "postgresql+psycopg://u:p@host/db?sslmode=require"
    assert accounts._database_url("sqlite:///./x.db") == "sqlite:///./x.db"
