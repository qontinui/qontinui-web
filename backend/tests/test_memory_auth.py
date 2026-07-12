"""Unit tests for the memory API's tenant principal resolution.

``get_memory_tenant`` (app/api/v1/endpoints/memory.py) accepts three
credential shapes — device JWT, coord service token, Cognito operator —
and is fail-closed: 401 with no credential, 403 when the credential is
valid but resolves to no tenant. Tenant NEVER comes from the request.

All coord/JWKS/Cognito interactions are mocked — no network, no DB.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials

from app.api.v1.endpoints import memory as memory_ep
from app.services.coord_jwks import (
    CoordJWKSUnavailableError,
    CoordTokenInvalidError,
)


def _creds(token: str = "some-bearer") -> HTTPAuthorizationCredentials:
    return HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)


def _mock_verify(monkeypatch: pytest.MonkeyPatch, result) -> AsyncMock:
    mock = (
        AsyncMock(side_effect=result)
        if isinstance(result, Exception)
        else AsyncMock(return_value=result)
    )
    monkeypatch.setattr(memory_ep.coord_jwks_client, "verify_token", mock)
    return mock


@pytest.mark.asyncio
async def test_no_credential_no_user_is_401() -> None:
    with pytest.raises(HTTPException) as exc:
        await memory_ep.get_memory_tenant(
            request=MagicMock(), user=None, credentials=None
        )
    assert exc.value.status_code == 401


@pytest.mark.asyncio
async def test_coord_service_token_resolves_tenant(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    tenant_id = uuid4()
    device_id = uuid4()
    _mock_verify(
        monkeypatch,
        {
            "token_kind": "coord_service",
            "sub": "coord-memory-proxy",
            "tenant_id": str(tenant_id),
            "device_id": str(device_id),
        },
    )
    principal = await memory_ep.get_memory_tenant(
        request=MagicMock(), user=None, credentials=_creds()
    )
    assert principal.tenant_id == tenant_id
    assert principal.device_id == device_id
    assert principal.actor == "coord_service"


@pytest.mark.asyncio
async def test_coord_service_token_wrong_subject_is_401(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _mock_verify(
        monkeypatch,
        {
            "token_kind": "coord_service",
            "sub": "someone-else",
            "tenant_id": str(uuid4()),
        },
    )
    with pytest.raises(HTTPException) as exc:
        await memory_ep.get_memory_tenant(
            request=MagicMock(), user=None, credentials=_creds()
        )
    assert exc.value.status_code == 401


@pytest.mark.asyncio
async def test_coord_service_token_without_tenant_is_403(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _mock_verify(
        monkeypatch,
        {"token_kind": "coord_service", "sub": "coord-memory-proxy"},
    )
    with pytest.raises(HTTPException) as exc:
        await memory_ep.get_memory_tenant(
            request=MagicMock(), user=None, credentials=_creds()
        )
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_device_token_resolves_device_tenant(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    tenant_id = uuid4()
    device_id = uuid4()
    device_claims = {
        "user_id": str(uuid4()),
        "device_id": str(device_id),
        "tenant_id": str(tenant_id),
    }
    # A coord-signed token that is NOT a service token routes to the
    # canonical device verification from app.api.deps.
    _mock_verify(monkeypatch, device_claims)
    monkeypatch.setattr(
        memory_ep,
        "_verify_device_jwt",
        AsyncMock(return_value=(device_claims, MagicMock())),
    )
    principal = await memory_ep.get_memory_tenant(
        request=MagicMock(), user=None, credentials=_creds()
    )
    assert principal.tenant_id == tenant_id
    assert principal.device_id == device_id
    assert principal.actor == "device"


@pytest.mark.asyncio
async def test_device_token_without_tenant_claim_is_403(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    device_claims = {"user_id": str(uuid4()), "device_id": str(uuid4())}
    _mock_verify(monkeypatch, device_claims)
    monkeypatch.setattr(
        memory_ep,
        "_verify_device_jwt",
        AsyncMock(return_value=(device_claims, MagicMock())),
    )
    with pytest.raises(HTTPException) as exc:
        await memory_ep.get_memory_tenant(
            request=MagicMock(), user=None, credentials=_creds()
        )
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_jwks_unavailable_is_503(monkeypatch: pytest.MonkeyPatch) -> None:
    _mock_verify(monkeypatch, CoordJWKSUnavailableError("cold start"))
    with pytest.raises(HTTPException) as exc:
        await memory_ep.get_memory_tenant(
            request=MagicMock(), user=None, credentials=_creds()
        )
    assert exc.value.status_code == 503


@pytest.mark.asyncio
async def test_operator_user_resolves_home_tenant(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    tenant_id = uuid4()
    # Bearer is a Cognito token — coord JWKS rejects it, we fall through
    # to the operator path.
    _mock_verify(monkeypatch, CoordTokenInvalidError("not coord-signed"))
    identity = MagicMock()
    identity.home_tenant_id = tenant_id
    monkeypatch.setattr(
        memory_ep, "get_coord_identity", AsyncMock(return_value=identity)
    )
    principal = await memory_ep.get_memory_tenant(
        request=MagicMock(), user=MagicMock(), credentials=_creds()
    )
    assert principal.tenant_id == tenant_id
    assert principal.device_id is None
    assert principal.actor == "operator"


@pytest.mark.asyncio
async def test_operator_without_home_tenant_is_403(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _mock_verify(monkeypatch, CoordTokenInvalidError("not coord-signed"))
    identity = MagicMock()
    identity.home_tenant_id = None
    monkeypatch.setattr(
        memory_ep, "get_coord_identity", AsyncMock(return_value=identity)
    )
    with pytest.raises(HTTPException) as exc:
        await memory_ep.get_memory_tenant(
            request=MagicMock(), user=MagicMock(), credentials=_creds()
        )
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_unverifiable_bearer_and_no_user_is_401(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _mock_verify(monkeypatch, CoordTokenInvalidError("garbage"))
    with pytest.raises(HTTPException) as exc:
        await memory_ep.get_memory_tenant(
            request=MagicMock(), user=None, credentials=_creds()
        )
    assert exc.value.status_code == 401
