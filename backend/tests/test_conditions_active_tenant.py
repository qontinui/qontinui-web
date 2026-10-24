"""Regression Tests (``/api/v1/conditions``) forward the selected project to coord.

Plan ``2026-09-17-regression-tests-target-the-selected-project`` Phase 1.

The frontend attaches ``X-Qontinui-Active-Tenant`` to conditions calls; these
tests prove the WEB BACKEND half end to end through the real router: the
``get_tenant_id`` dependency captures the header and the shared
``_proxy_coord_get`` forwards it to coord, so coord scopes the condition groups
to the operator's selected project (membership-checked coord-side; a
non-member selection keeps the home tenant). Without the header nothing is
forwarded and coord answers for the home tenant.

Only ``get_coord_identity`` and ``httpx.AsyncClient`` are patched —
``get_tenant_id`` itself is deliberately NOT overridden, because its
``capture_caller_bearer`` side effect is the thing under test.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from tests._ops_patch import patch_ops

ACTIVE_TENANT_HEADER = "X-Qontinui-Active-Tenant"
_HOME = UUID("11111111-1111-1111-1111-111111111111")
_SELECTED = UUID("22222222-2222-2222-2222-222222222222")


def _identity():
    from app.services.coord_identity import CoordIdentity, CoordTenant

    return CoordIdentity(
        operator_id=UUID("99999999-9999-9999-9999-999999999999"),
        home_tenant_id=_HOME,
        email="operator@example.com",
        roles=("developer",),
        tenants=(CoordTenant(tenant_id=_HOME, slug="home", roles=("developer",)),),
        is_admin=False,
    )


@pytest.fixture()
def client() -> TestClient:
    from app.api.v1.endpoints.conditions import router as conditions_router

    app = FastAPI()
    app.include_router(conditions_router, prefix="/api/v1/conditions")
    return TestClient(app)


def _get_groups(client: TestClient, headers: dict[str, str]) -> AsyncMock:
    """Call ``GET /api/v1/conditions/groups`` and return the mocked httpx client."""

    resp = MagicMock(spec=httpx.Response)
    resp.status_code = 200
    resp.json.return_value = {"groups": []}
    resp.text = '{"groups": []}'

    instance = AsyncMock()
    instance.get.return_value = resp
    instance.__aenter__ = AsyncMock(return_value=instance)
    instance.__aexit__ = AsyncMock(return_value=False)

    with (
        patch_ops("get_coord_identity", new=AsyncMock(return_value=_identity())),
        patch("app.api.v1.endpoints.operations.httpx.AsyncClient") as mock_client,
    ):
        mock_client.return_value = instance
        response = client.get(
            "/api/v1/conditions/groups",
            headers={"Authorization": "Bearer cognito-token", **headers},
        )

    assert response.status_code == 200
    assert response.json() == {"groups": []}
    assert instance.get.call_args.args[0].endswith("/coord/condition-groups")
    return instance


def test_selected_project_is_forwarded_to_coord(client: TestClient):
    instance = _get_groups(client, {ACTIVE_TENANT_HEADER: str(_SELECTED)})

    forwarded = instance.get.call_args.kwargs["headers"]
    assert forwarded[ACTIVE_TENANT_HEADER] == str(_SELECTED)
    assert forwarded["Authorization"] == "Bearer cognito-token"


def test_no_selection_forwards_no_active_tenant_header(client: TestClient):
    instance = _get_groups(client, {})

    forwarded = instance.get.call_args.kwargs["headers"]
    assert ACTIVE_TENANT_HEADER not in forwarded
    assert forwarded["Authorization"] == "Bearer cognito-token"
