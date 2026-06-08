"""Unit tests for identity-contract I1 + I3-web.

Covers:
* I3 resolver composition (github-author > device-owner > tenant-fallback),
  dedupe, source-priority ordering, the never-empty contract, and bearer +
  ``x-qontinui-user-id`` forwarding to coord.
* I1 link-hook GitHub-login extraction (claim precedence + API fallback).

All coord calls are mocked at the httpx layer; the DB is a fake async
session — no live coord / Postgres needed.
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any
from uuid import UUID

import httpx
import pytest

from app.services import identity_resolver

ACTING_USER = "11111111-1111-1111-1111-111111111111"
AUTHOR_USER = UUID("22222222-2222-2222-2222-222222222222")
OWNER_USER = UUID("33333333-3333-3333-3333-333333333333")
MEMBER_USER = UUID("44444444-4444-4444-4444-444444444444")

GITHUB_ID = "987654"


def _patch_coord(monkeypatch, response: httpx.Response) -> dict[str, Any]:
    """Patch ``httpx.AsyncClient.get`` to return ``response``; record headers."""
    seen: dict[str, Any] = {}

    async def _get(self, url, params=None, headers=None):  # noqa: ANN001
        seen["url"] = url
        seen["headers"] = headers or {}
        return response

    monkeypatch.setattr(httpx.AsyncClient, "get", _get, raising=True)
    return seen


class _FakeResult:
    def __init__(self, obj: Any) -> None:
        self._obj = obj

    def scalars(self) -> _FakeResult:
        return self

    def first(self) -> Any:
        return self._obj


class _FakeDB:
    """Minimal async session: maps github_user_id -> User and id -> User.

    ``execute`` handles the ``select(User).where(github_user_id == ...)``
    lookup; ``get`` handles ``db.get(User, uuid)`` for device-owner /
    tenant-fallback resolution.
    """

    def __init__(
        self,
        *,
        by_github_id: dict[str, Any] | None = None,
        by_id: dict[UUID, Any] | None = None,
    ) -> None:
        self._by_github_id = by_github_id or {}
        self._by_id = by_id or {}
        # The github_user_id the last execute() filtered on (extracted from
        # the bound params) — fake: we just return the single configured
        # mapping value keyed by GITHUB_ID.
        self.execute_calls = 0

    async def execute(self, _stmt) -> _FakeResult:  # noqa: ANN001
        self.execute_calls += 1
        # Single-author fixture: return the configured author user (if any).
        obj = next(iter(self._by_github_id.values()), None)
        return _FakeResult(obj)

    async def get(self, _model, key: UUID) -> Any:  # noqa: ANN001
        return self._by_id.get(key)


def _ctx_response(**fields: Any) -> httpx.Response:
    body = {
        "tenant_id": "99999999-9999-9999-9999-999999999999",
        "github_author_id": None,
        "agent_id": None,
        "device_owner_user_id": None,
        "tenant_fallback_user_ids": [],
    }
    body.update(fields)
    return httpx.Response(200, json=body)


# ---- I3 resolver ----------------------------------------------------------


@pytest.mark.asyncio
async def test_resolver_github_author_wins(monkeypatch):
    seen = _patch_coord(monkeypatch, _ctx_response(github_author_id=GITHUB_ID))
    db = _FakeDB(by_github_id={GITHUB_ID: SimpleNamespace(id=AUTHOR_USER)})

    users = await identity_resolver.resolve_responsible_users(
        db, "qontinui-web", 42, bearer="tok", acting_user_id=ACTING_USER
    )

    assert [(str(u.user_id), u.source) for u in users] == [
        (str(AUTHOR_USER), "github-author")
    ]
    # Bearer + user-id forwarding + path.
    assert seen["url"].endswith("/coord/pr/qontinui-web/42/responsible-context")
    assert seen["headers"]["Authorization"] == "Bearer tok"
    assert seen["headers"]["x-qontinui-user-id"] == ACTING_USER


@pytest.mark.asyncio
async def test_resolver_author_and_device_owner_priority(monkeypatch):
    _patch_coord(
        monkeypatch,
        _ctx_response(
            github_author_id=GITHUB_ID,
            device_owner_user_id=str(OWNER_USER),
        ),
    )
    db = _FakeDB(
        by_github_id={GITHUB_ID: SimpleNamespace(id=AUTHOR_USER)},
        by_id={OWNER_USER: SimpleNamespace(id=OWNER_USER)},
    )

    users = await identity_resolver.resolve_responsible_users(
        db, "repo", 7, bearer=None, acting_user_id=ACTING_USER
    )

    # github-author first, then device-owner; both present, source-ordered.
    assert [(u.user_id, u.source) for u in users] == [
        (AUTHOR_USER, "github-author"),
        (OWNER_USER, "device-owner"),
    ]


@pytest.mark.asyncio
async def test_resolver_dedupe_same_user_keeps_highest_priority(monkeypatch):
    # Author and device owner are the SAME user -> one entry, github-author.
    _patch_coord(
        monkeypatch,
        _ctx_response(
            github_author_id=GITHUB_ID,
            device_owner_user_id=str(AUTHOR_USER),
        ),
    )
    db = _FakeDB(
        by_github_id={GITHUB_ID: SimpleNamespace(id=AUTHOR_USER)},
        by_id={AUTHOR_USER: SimpleNamespace(id=AUTHOR_USER)},
    )

    users = await identity_resolver.resolve_responsible_users(
        db, "repo", 7, bearer=None, acting_user_id=ACTING_USER
    )

    assert len(users) == 1
    assert users[0].user_id == AUTHOR_USER
    assert users[0].source == "github-author"


@pytest.mark.asyncio
async def test_resolver_tenant_fallback_when_no_author_or_owner(monkeypatch):
    _patch_coord(
        monkeypatch,
        _ctx_response(tenant_fallback_user_ids=[str(MEMBER_USER)]),
    )
    db = _FakeDB(by_id={MEMBER_USER: SimpleNamespace(id=MEMBER_USER)})

    users = await identity_resolver.resolve_responsible_users(
        db, "repo", 7, bearer="tok", acting_user_id=ACTING_USER
    )

    assert [(u.user_id, u.source) for u in users] == [(MEMBER_USER, "tenant-fallback")]


@pytest.mark.asyncio
async def test_resolver_fallback_not_used_when_author_resolves(monkeypatch):
    # Fallback present but arms 1/2 resolved -> fallback NOT consulted.
    _patch_coord(
        monkeypatch,
        _ctx_response(
            github_author_id=GITHUB_ID,
            tenant_fallback_user_ids=[str(MEMBER_USER)],
        ),
    )
    db = _FakeDB(
        by_github_id={GITHUB_ID: SimpleNamespace(id=AUTHOR_USER)},
        by_id={MEMBER_USER: SimpleNamespace(id=MEMBER_USER)},
    )

    users = await identity_resolver.resolve_responsible_users(
        db, "repo", 7, bearer=None, acting_user_id=ACTING_USER
    )

    assert [u.source for u in users] == ["github-author"]


@pytest.mark.asyncio
async def test_resolver_never_empty_raises_when_nothing_resolves(monkeypatch):
    from fastapi import HTTPException

    _patch_coord(monkeypatch, _ctx_response())  # all-None context
    db = _FakeDB()

    with pytest.raises(HTTPException) as exc:
        await identity_resolver.resolve_responsible_users(
            db, "repo", 7, bearer=None, acting_user_id=ACTING_USER
        )
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_resolver_author_id_unlinked_falls_through_to_fallback(monkeypatch):
    # Coord reports a github author id, but no web user has linked it ->
    # falls through to tenant fallback (never empty).
    _patch_coord(
        monkeypatch,
        _ctx_response(
            github_author_id=GITHUB_ID,
            tenant_fallback_user_ids=[str(MEMBER_USER)],
        ),
    )
    db = _FakeDB(  # no by_github_id mapping -> author lookup misses
        by_id={MEMBER_USER: SimpleNamespace(id=MEMBER_USER)},
    )

    users = await identity_resolver.resolve_responsible_users(
        db, "repo", 7, bearer=None, acting_user_id=ACTING_USER
    )

    assert [u.source for u in users] == ["tenant-fallback"]


@pytest.mark.asyncio
async def test_resolver_coord_unreachable_maps_502(monkeypatch):
    from fastapi import HTTPException

    async def _boom(self, url, params=None, headers=None):  # noqa: ANN001
        raise httpx.ConnectError("nope")

    monkeypatch.setattr(httpx.AsyncClient, "get", _boom, raising=True)

    with pytest.raises(HTTPException) as exc:
        await identity_resolver.resolve_responsible_users(
            _FakeDB(), "repo", 7, bearer=None, acting_user_id=ACTING_USER
        )
    assert exc.value.status_code == 502


# ---- I1 lookup helpers ----------------------------------------------------


@pytest.mark.asyncio
async def test_user_for_github_user_id_empty_is_none():
    assert await identity_resolver.user_for_github_user_id(_FakeDB(), "") is None


@pytest.mark.asyncio
async def test_user_for_github_login_empty_is_none():
    assert await identity_resolver.user_for_github_login(_FakeDB(), "") is None


@pytest.mark.asyncio
async def test_user_for_github_user_id_hits_db():
    db = _FakeDB(by_github_id={GITHUB_ID: SimpleNamespace(id=AUTHOR_USER)})
    user = await identity_resolver.user_for_github_user_id(db, GITHUB_ID)
    assert user is not None
    assert user.id == AUTHOR_USER
