"""Integration tests for the Wave-4 spawn-from-plan proxy endpoints.

Plan ``2026-05-19-coordinator-production-readiness.md`` Phase 4 (Wave 4).

Two tenant-scoped endpoints under ``/api/v1/operations``:

  - ``POST /agents/spawn``      → coord ``POST /agents/spawn``
  - ``GET  /agents/{agent_id}`` → coord ``GET  /agents/{agent_id}``

Refactor ``coord_tenant_scope_columns``: the prior ``require_admin``
(superuser) gate is replaced by ``get_tenant_id`` which resolves the
current user → tenant_id and forwards ``X-Qontinui-Tenant-Id`` to
coord. Tests assert the tenant header reaches coord and that the
unresolved-tenant path returns 403 ``tenant_not_resolved``.
"""

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID, uuid4

import httpx
import pytest
from fastapi import FastAPI, HTTPException, status
from fastapi.testclient import TestClient

_FIXTURE_TENANT_ID = UUID("11111111-2222-3333-4444-555555555555")
TENANT_HEADER = "X-Qontinui-Tenant-Id"


def _build_test_app(*, resolves_tenant: bool = True) -> FastAPI:
    from app.api.deps import (
        get_async_db,
        get_current_active_user_async,
        get_current_user_async,
    )
    from app.api.v1.endpoints.operations import (
        get_tenant_id,
    )
    from app.api.v1.endpoints.operations import (
        router as operations_router,
    )

    test_app = FastAPI()
    mock_user = MagicMock()
    mock_user.id = uuid4()
    mock_user.email = "tenant.user@example.com"
    mock_user.is_active = True
    mock_user.is_verified = True
    mock_user.is_superuser = False
    test_app.dependency_overrides[get_current_active_user_async] = lambda: mock_user
    test_app.dependency_overrides[get_current_user_async] = lambda: mock_user
    test_app.dependency_overrides[get_async_db] = lambda: None

    if resolves_tenant:

        async def _resolver() -> UUID:
            return _FIXTURE_TENANT_ID

    else:

        async def _resolver() -> UUID:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="tenant_not_resolved",
            )

    test_app.dependency_overrides[get_tenant_id] = _resolver
    test_app.include_router(operations_router, prefix="/api/v1/operations")
    return test_app


@pytest.fixture()
def client() -> TestClient:
    return TestClient(_build_test_app(resolves_tenant=True))


@pytest.fixture()
def unresolved_client() -> TestClient:
    return TestClient(_build_test_app(resolves_tenant=False))


def _mock_response(status_code: int = 200, json_data=None, text: str = "") -> MagicMock:
    resp = MagicMock(spec=httpx.Response)
    resp.status_code = status_code
    resp.json.return_value = json_data
    resp.text = text or (str(json_data) if json_data else "")
    return resp


def _patch_httpx():
    return patch("app.api.v1.endpoints.operations.httpx.AsyncClient")


def _configure_mock_client(MockClient, mock_instance):
    mock_instance.__aenter__ = AsyncMock(return_value=mock_instance)
    mock_instance.__aexit__ = AsyncMock(return_value=False)
    MockClient.return_value = mock_instance


def _assert_tenant_header(call) -> None:
    # Phase T2b — the legacy ``X-Qontinui-Tenant-Id`` email-bridge header is
    # no longer sent; coord resolves the tenant from the forwarded Cognito
    # bearer. The scoped proxy still passes a (possibly empty) headers dict.
    headers = call.kwargs.get("headers")
    assert headers is not None
    assert TENANT_HEADER not in headers


API_PREFIX = "/api/v1/operations"


# ---------------------------------------------------------------------------
# POST /agents/spawn
# ---------------------------------------------------------------------------


class TestPostAgentsSpawn:
    def test_authenticated_user_can_spawn(self, client: TestClient):
        coord_payload = {
            "agent_id": "agent-deadbeef",
            "agent_session_id": "00000000-0000-0000-0000-000000000abc",
            "device_id": "00000000-0000-0000-0000-deadbeefcafe",
            "status": "spawned",
        }
        mock_resp = _mock_response(json_data=coord_payload)

        body = {
            "plan_slug": "2026-05-19-coordinator-production-readiness",
            "plan_phase": "Phase 4",
            "device_id": "00000000-0000-0000-0000-deadbeefcafe",
            "repos": ["qontinui-web", "qontinui-coord"],
            "intent": "spawn-from-plan demo",
            "declared_overlap_paths": ["backend/app/api/v1/endpoints/operations.py"],
            "initial_prompt": "You are Wave 4 of the readiness rollout...",
        }

        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.post.return_value = mock_resp
            _configure_mock_client(MockClient, instance)

            resp = client.post(f"{API_PREFIX}/agents/spawn", json=body)

        assert resp.status_code == 200
        assert resp.json() == coord_payload

        called_url = instance.post.call_args.args[0]
        assert called_url.endswith("/agents/spawn")
        called_json = instance.post.call_args.kwargs.get("json")
        assert called_json == body
        _assert_tenant_header(instance.post.call_args)

    def test_unresolved_tenant_is_forbidden(self, unresolved_client: TestClient):
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            _configure_mock_client(MockClient, instance)

            resp = unresolved_client.post(
                f"{API_PREFIX}/agents/spawn",
                json={"plan_slug": "x", "device_id": "y"},
            )

        assert resp.status_code == 403
        assert resp.json()["detail"] == "tenant_not_resolved"
        instance.post.assert_not_called()

    def test_coord_400_passed_through(self, client: TestClient):
        mock_resp = _mock_response(
            status_code=400, text='{"error": "unknown plan_slug"}'
        )
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.post.return_value = mock_resp
            _configure_mock_client(MockClient, instance)
            resp = client.post(
                f"{API_PREFIX}/agents/spawn",
                json={"plan_slug": "bogus"},
            )
        assert resp.status_code == 400

    def test_coord_unreachable_returns_502(self, client: TestClient):
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.post.side_effect = httpx.ConnectError("refused")
            _configure_mock_client(MockClient, instance)
            resp = client.post(
                f"{API_PREFIX}/agents/spawn",
                json={"plan_slug": "x"},
            )
        assert resp.status_code == 502


# ---------------------------------------------------------------------------
# GET /agents/{agent_id}
# ---------------------------------------------------------------------------


class TestGetAgent:
    def test_authenticated_user_can_fetch(self, client: TestClient):
        coord_payload = {
            "agent_id": "agent-deadbeef",
            "agent_session_id": "00000000-0000-0000-0000-000000000abc",
            "status": "running",
            "device_id": "00000000-0000-0000-0000-deadbeefcafe",
            "intent": "spawn-from-plan demo",
        }
        mock_resp = _mock_response(json_data=coord_payload)
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)

            resp = client.get(f"{API_PREFIX}/agents/agent-deadbeef")

        assert resp.status_code == 200
        assert resp.json() == coord_payload
        called_url = instance.get.call_args.args[0]
        assert called_url.endswith("/agents/agent-deadbeef")
        _assert_tenant_header(instance.get.call_args)

    def test_unresolved_tenant_is_forbidden(self, unresolved_client: TestClient):
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            _configure_mock_client(MockClient, instance)
            resp = unresolved_client.get(f"{API_PREFIX}/agents/agent-x")
        assert resp.status_code == 403
        instance.get.assert_not_called()

    def test_coord_404_passed_through(self, client: TestClient):
        mock_resp = _mock_response(status_code=404, text='{"error": "agent not found"}')
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)
            resp = client.get(f"{API_PREFIX}/agents/nonexistent")
        assert resp.status_code == 404
