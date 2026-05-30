"""Unit tests for ``app.services.coord_identity``.

Replaces the deleted ``test_coord_operator_resolver`` /
``test_coord_tenant_admin`` suites. Exercises the request-scoped client
for coord's ``GET /admin/coord/me`` that supplanted the cross-schema
``coord.operators`` / ``coord.tenants`` / ``coord.operator_roles`` reads.

Covers:
  * payload parsing (home tenant, multi-tenant set, slug, roles, is_admin),
  * the home-first ``tenant_ids()`` ordering,
  * per-request caching (one coord call per request max),
  * bearer extraction (cookie + Authorization header),
  * the 403 / 502 / 504 boundary mappings.
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID, uuid4

import httpx
import pytest
from fastapi import HTTPException

from app.services import coord_identity
from app.services.coord_identity import (
    CoordIdentity,
    get_coord_identity,
    get_coord_identity_for_token,
)

_HOME = UUID("11111111-1111-1111-1111-111111111111")
_OTHER = UUID("22222222-2222-2222-2222-222222222222")


def _me_payload(*, is_admin: bool = False) -> dict[str, Any]:
    return {
        "operator_id": str(uuid4()),
        "home_tenant_id": str(_HOME),
        "tenant_id": str(_HOME),  # back-compat alias
        "email": "op@qontinui.io",
        "roles": ["member", "admin"],
        "tenants": [
            {"tenant_id": str(_HOME), "slug": "home-slug", "roles": ["admin"]},
            {"tenant_id": str(_OTHER), "slug": "other-slug", "roles": ["member"]},
        ],
        "is_admin": is_admin,
    }


def _mock_request(*, cookie: str | None = None, auth: str | None = None) -> MagicMock:
    """A FastAPI Request stand-in with a mutable ``state`` for the cache."""
    request = MagicMock()
    request.cookies = {"access_token": cookie} if cookie else {}
    request.headers = {"Authorization": auth} if auth else {}
    request.state = SimpleNamespace()
    return request


def _httpx_response(
    status_code: int, *, json_data: Any = None, text: str = ""
) -> MagicMock:
    resp = MagicMock()
    resp.status_code = status_code
    resp.text = text
    if json_data is None:
        resp.json = MagicMock(side_effect=ValueError("no json"))
    else:
        resp.json = MagicMock(return_value=json_data)
    return resp


def _patch_client(response: Any = None, *, exc: Exception | None = None):
    """Patch ``httpx.AsyncClient`` so ``.get`` returns ``response`` (or raises ``exc``)."""
    client = AsyncMock()
    if exc is not None:
        client.get = AsyncMock(side_effect=exc)
    else:
        client.get = AsyncMock(return_value=response)
    ctx = MagicMock()
    ctx.__aenter__ = AsyncMock(return_value=client)
    ctx.__aexit__ = AsyncMock(return_value=None)
    return patch.object(coord_identity.httpx, "AsyncClient", return_value=ctx), client


@pytest.mark.asyncio
async def test_parses_full_payload() -> None:
    request = _mock_request(auth="Bearer tok-123")
    resp = _httpx_response(200, json_data=_me_payload(is_admin=True))
    cm, client = _patch_client(resp)
    with cm:
        identity = await get_coord_identity(request)

    assert isinstance(identity, CoordIdentity)
    assert identity.home_tenant_id == _HOME
    assert identity.is_admin is True
    assert identity.email == "op@qontinui.io"
    assert {t.tenant_id for t in identity.tenants} == {_HOME, _OTHER}
    assert identity.slug_for(_HOME) == "home-slug"
    assert identity.slug_for(_OTHER) == "other-slug"
    # Bearer forwarded on the coord call.
    _, kwargs = client.get.call_args
    assert kwargs["headers"]["Authorization"] == "Bearer tok-123"


@pytest.mark.asyncio
async def test_tenant_ids_home_first() -> None:
    request = _mock_request(auth="Bearer tok")
    resp = _httpx_response(200, json_data=_me_payload())
    cm, _ = _patch_client(resp)
    with cm:
        identity = await get_coord_identity(request)
    # Home tenant first regardless of coord's array order.
    assert identity.tenant_ids()[0] == _HOME
    assert set(identity.tenant_ids()) == {_HOME, _OTHER}


@pytest.mark.asyncio
async def test_caches_on_request_one_call_per_request() -> None:
    request = _mock_request(auth="Bearer tok")
    resp = _httpx_response(200, json_data=_me_payload())
    cm, client = _patch_client(resp)
    with cm:
        first = await get_coord_identity(request)
        second = await get_coord_identity(request)
    assert first is second
    # Exactly one coord round-trip despite two calls.
    assert client.get.await_count == 1


@pytest.mark.asyncio
async def test_bearer_from_cookie_preferred() -> None:
    request = _mock_request(cookie="cookie-tok", auth="Bearer header-tok")
    resp = _httpx_response(200, json_data=_me_payload())
    cm, client = _patch_client(resp)
    with cm:
        await get_coord_identity(request)
    _, kwargs = client.get.call_args
    # Cookie wins over the Authorization header (matches CookieOrBearerScheme).
    assert kwargs["headers"]["Authorization"] == "Bearer cookie-tok"


@pytest.mark.asyncio
async def test_coord_403_maps_to_tenant_not_resolved() -> None:
    request = _mock_request(auth="Bearer tok")
    resp = _httpx_response(403, text="forbidden")
    cm, _ = _patch_client(resp)
    with cm, pytest.raises(HTTPException) as exc_info:
        await get_coord_identity(request)
    assert exc_info.value.status_code == 403
    assert exc_info.value.detail == "tenant_not_resolved"


@pytest.mark.asyncio
async def test_connect_error_maps_to_502() -> None:
    request = _mock_request(auth="Bearer tok")
    cm, _ = _patch_client(exc=httpx.ConnectError("down"))
    with cm, pytest.raises(HTTPException) as exc_info:
        await get_coord_identity(request)
    assert exc_info.value.status_code == 502


@pytest.mark.asyncio
async def test_timeout_maps_to_504() -> None:
    request = _mock_request(auth="Bearer tok")
    cm, _ = _patch_client(exc=httpx.TimeoutException("slow"))
    with cm, pytest.raises(HTTPException) as exc_info:
        await get_coord_identity(request)
    assert exc_info.value.status_code == 504


@pytest.mark.asyncio
async def test_for_token_fetches_with_explicit_bearer() -> None:
    resp = _httpx_response(200, json_data=_me_payload(is_admin=True))
    cm, client = _patch_client(resp)
    with cm:
        identity = await get_coord_identity_for_token("ws-token")
    assert identity.home_tenant_id == _HOME
    _, kwargs = client.get.call_args
    assert kwargs["headers"]["Authorization"] == "Bearer ws-token"


@pytest.mark.asyncio
async def test_non_object_payload_maps_to_502() -> None:
    request = _mock_request(auth="Bearer tok")
    resp = _httpx_response(200, json_data=["not", "an", "object"])
    cm, _ = _patch_client(resp)
    with cm, pytest.raises(HTTPException) as exc_info:
        await get_coord_identity(request)
    assert exc_info.value.status_code == 502
