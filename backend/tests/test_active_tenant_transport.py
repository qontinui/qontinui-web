"""Active-tenant transport: web → coord header forwarding + per-tenant admin gate.

Phase 1 of the multi-tenant-operator-support plan. The dashboard tenant
switcher persists the operator's selection and the frontend attaches it as
``X-Qontinui-Active-Tenant`` to every coord-proxy call. These tests prove the
WEB BACKEND side:

* each of the three proxy header-builders
  (``operations._tenant_headers``, ``agent_sessions._coord_headers``,
  ``constraints._forward_headers``) forwards the active-tenant header when a
  selection is present and OMITS it when absent;
* ``operations.require_coord_tenant_admin`` checks admin in the EFFECTIVE
  tenant (the active selection when the operator is a member, else home) using
  the per-tenant roles — never a union — so an operator who is admin in tenant
  A but only a developer in tenant B is denied admin after switching to B.

Coord re-validates the override server-side (and degrades a non-member
selection to the home tenant, never 403s), so the web tier only forwards; it
does not add a second 403 gate on the forwarding path.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID

import pytest
from fastapi import HTTPException

ACTIVE_TENANT_HEADER = "X-Qontinui-Active-Tenant"
_TENANT_A = UUID("11111111-1111-1111-1111-111111111111")
_TENANT_B = UUID("22222222-2222-2222-2222-222222222222")
_TENANT_C = UUID("33333333-3333-3333-3333-333333333333")  # not a member


# ---------------------------------------------------------------------------
# Header builders forward the active-tenant selection
# ---------------------------------------------------------------------------


class TestOperationsTenantHeaders:
    def test_forwards_active_tenant_when_present(self):
        from app.api.v1.endpoints import operations

        bearer_tok = operations._caller_bearer.set("cognito-token")
        active_tok = operations._caller_active_tenant.set(str(_TENANT_B))
        try:
            headers = operations._tenant_headers(None)
        finally:
            operations._caller_bearer.reset(bearer_tok)
            operations._caller_active_tenant.reset(active_tok)
        assert headers[ACTIVE_TENANT_HEADER] == str(_TENANT_B)
        assert headers["Authorization"] == "Bearer cognito-token"

    def test_omits_active_tenant_when_absent(self):
        from app.api.v1.endpoints import operations

        bearer_tok = operations._caller_bearer.set("cognito-token")
        active_tok = operations._caller_active_tenant.set(None)
        try:
            headers = operations._tenant_headers(None)
        finally:
            operations._caller_bearer.reset(bearer_tok)
            operations._caller_active_tenant.reset(active_tok)
        assert ACTIVE_TENANT_HEADER not in headers


class TestAgentSessionsCoordHeaders:
    def test_forwards_active_tenant_when_present(self):
        from app.api.v1.endpoints import agent_sessions

        bearer_tok = agent_sessions._caller_bearer.set("cognito-token")
        active_tok = agent_sessions._caller_active_tenant.set(str(_TENANT_B))
        try:
            headers = agent_sessions._coord_headers()
        finally:
            agent_sessions._caller_bearer.reset(bearer_tok)
            agent_sessions._caller_active_tenant.reset(active_tok)
        assert headers[ACTIVE_TENANT_HEADER] == str(_TENANT_B)
        assert headers["Authorization"] == "Bearer cognito-token"

    def test_omits_active_tenant_when_absent(self):
        from app.api.v1.endpoints import agent_sessions

        bearer_tok = agent_sessions._caller_bearer.set("cognito-token")
        active_tok = agent_sessions._caller_active_tenant.set(None)
        try:
            headers = agent_sessions._coord_headers()
        finally:
            agent_sessions._caller_bearer.reset(bearer_tok)
            agent_sessions._caller_active_tenant.reset(active_tok)
        assert ACTIVE_TENANT_HEADER not in headers


# (constraints.py proxies to the local runner, not coord — it is intentionally
# NOT active-tenant-scoped, so there is no header-forwarding test for it.)


# ---------------------------------------------------------------------------
# require_coord_tenant_admin resolves the EFFECTIVE tenant's per-tenant roles
# ---------------------------------------------------------------------------


def _identity():
    """Operator: admin of tenant A (home), developer of tenant B.

    Top-level ``roles``/``is_admin`` carry the UNION (admin) — present so the
    tests prove the gate does NOT use them.
    """
    from app.services.coord_identity import CoordIdentity, CoordTenant

    return CoordIdentity(
        operator_id=UUID("99999999-9999-9999-9999-999999999999"),
        home_tenant_id=_TENANT_A,
        email="operator@example.com",
        roles=("admin",),  # union — must NOT be the source of truth
        tenants=(
            CoordTenant(tenant_id=_TENANT_A, slug="tenant-a", roles=("admin",)),
            CoordTenant(tenant_id=_TENANT_B, slug="tenant-b", roles=("developer",)),
        ),
        is_admin=True,  # union — must NOT be the source of truth
    )


def _request(active_tenant: str | None) -> MagicMock:
    req = MagicMock()
    req.cookies = {"access_token": "cognito-token"}
    headers: dict[str, str] = {}
    if active_tenant is not None:
        headers[ACTIVE_TENANT_HEADER] = active_tenant
    req.headers = headers
    return req


def _user(is_superuser: bool = False) -> MagicMock:
    u = MagicMock()
    u.is_superuser = is_superuser
    return u


@pytest.mark.asyncio
async def test_admin_granted_on_home_tenant_when_no_selection():
    from app.api.v1.endpoints import operations

    with patch.object(
        operations, "get_coord_identity", new=AsyncMock(return_value=_identity())
    ):
        result = await operations.require_coord_tenant_admin(_request(None), _user())
    assert result == _TENANT_A


@pytest.mark.asyncio
async def test_admin_granted_on_selected_tenant_where_admin():
    from app.api.v1.endpoints import operations

    with patch.object(
        operations, "get_coord_identity", new=AsyncMock(return_value=_identity())
    ):
        result = await operations.require_coord_tenant_admin(
            _request(str(_TENANT_A)), _user()
        )
    assert result == _TENANT_A


@pytest.mark.asyncio
async def test_admin_denied_on_selected_tenant_where_not_admin():
    """The crux: admin of A, developer of B → switching to B denies admin."""
    from app.api.v1.endpoints import operations

    with patch.object(
        operations, "get_coord_identity", new=AsyncMock(return_value=_identity())
    ):
        with pytest.raises(HTTPException) as exc:
            await operations.require_coord_tenant_admin(
                _request(str(_TENANT_B)), _user()
            )
    assert exc.value.status_code == 403
    assert exc.value.detail == "not_coord_tenant_admin"


@pytest.mark.asyncio
async def test_superuser_bypasses_per_tenant_admin_check():
    from app.api.v1.endpoints import operations

    with patch.object(
        operations, "get_coord_identity", new=AsyncMock(return_value=_identity())
    ):
        result = await operations.require_coord_tenant_admin(
            _request(str(_TENANT_B)), _user(is_superuser=True)
        )
    assert result == _TENANT_A


@pytest.mark.asyncio
async def test_non_member_selection_falls_back_to_home_tenant():
    """A selection the operator does not belong to degrades to home (admin)."""
    from app.api.v1.endpoints import operations

    with patch.object(
        operations, "get_coord_identity", new=AsyncMock(return_value=_identity())
    ):
        result = await operations.require_coord_tenant_admin(
            _request(str(_TENANT_C)), _user()
        )
    assert result == _TENANT_A


# ---------------------------------------------------------------------------
# admin_dev._capture_bearer_best_effort captures + keys by the VALIDATED
# effective tenant
# ---------------------------------------------------------------------------
#
# Regression guards for two bugs:
# 1. /admin-dev/* proxied to coord WITHOUT the active-tenant header (the
#    ContextVar was never set on this surface), so the gates dashboard always
#    showed the home tenant regardless of the switcher.
# 2. The shared overview cache must never be keyed by the RAW header: coord
#    serves HOME-tenant data for a non-member selection, so a raw-header key
#    would poison the cache entry other operators legitimately read for that
#    tenant.


@pytest.mark.asyncio
async def test_admin_dev_captures_selection_and_returns_member_tenant_key():
    from app.api.v1.endpoints import admin_dev, operations

    with patch.object(
        admin_dev, "get_coord_identity", new=AsyncMock(return_value=_identity())
    ):
        key = await admin_dev._capture_bearer_best_effort(_request(str(_TENANT_B)))

    # The member-validated selection is the cache key AND lands in the
    # ContextVar that operations._tenant_headers forwards to coord.
    assert key == str(_TENANT_B)
    assert operations._caller_active_tenant.get() == str(_TENANT_B)
    assert operations._caller_bearer.get() == "cognito-token"
    headers = operations._tenant_headers(None)
    assert headers[ACTIVE_TENANT_HEADER] == str(_TENANT_B)


@pytest.mark.asyncio
async def test_admin_dev_non_member_selection_keys_by_home_tenant():
    """Coord keeps HOME data for a non-member selection — the cache key must
    match what coord actually serves, never the raw header."""
    from app.api.v1.endpoints import admin_dev, operations

    with patch.object(
        admin_dev, "get_coord_identity", new=AsyncMock(return_value=_identity())
    ):
        key = await admin_dev._capture_bearer_best_effort(_request(str(_TENANT_C)))

    assert key == str(_TENANT_A)  # home, NOT the raw non-member selection
    # The header is still forwarded verbatim — coord re-validates it.
    assert operations._caller_active_tenant.get() == str(_TENANT_C)


@pytest.mark.asyncio
async def test_admin_dev_falls_back_to_home_tenant_key_without_selection():
    from app.api.v1.endpoints import admin_dev, operations

    with patch.object(
        admin_dev, "get_coord_identity", new=AsyncMock(return_value=_identity())
    ):
        key = await admin_dev._capture_bearer_best_effort(_request(None))

    assert key == str(_TENANT_A)
    assert operations._caller_active_tenant.get() is None
    headers = operations._tenant_headers(None)
    assert ACTIVE_TENANT_HEADER not in headers


@pytest.mark.asyncio
async def test_admin_dev_coord_down_still_captures_headers():
    from app.api.v1.endpoints import admin_dev, operations

    with patch.object(
        admin_dev,
        "get_coord_identity",
        new=AsyncMock(side_effect=HTTPException(status_code=502, detail="down")),
    ):
        key = await admin_dev._capture_bearer_best_effort(_request(None))

    # Identity resolution failed → None cache key, but the bearer capture
    # already happened so the proxy still forwards it.
    assert key is None
    assert operations._caller_bearer.get() == "cognito-token"
