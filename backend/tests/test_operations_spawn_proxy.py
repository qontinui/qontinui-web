"""Integration tests for the Wave-4 spawn-from-plan proxy endpoints.

Plan ``2026-05-19-coordinator-production-readiness.md`` Phase 4 (Wave 4).

Two admin-gated endpoints under ``/api/v1/operations``:

  - ``POST /agents/spawn``      → coord ``POST /agents/spawn``
  - ``GET  /agents/{agent_id}`` → coord ``GET  /agents/{agent_id}``

Mirrors ``test_operations_coord_dashboard_proxy.py``: minimal FastAPI
app + mocked ``httpx.AsyncClient`` so no live coord is needed. Both
``require_admin`` (superuser) gating and the body/path pass-through
are covered.
"""

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient


def _build_test_app(*, admin: bool = True, authenticated: bool = True) -> FastAPI:
    from app.api.deps import (
        get_current_active_user_async,
        get_current_user_async,
    )
    from app.api.v1.endpoints.operations import router as operations_router

    test_app = FastAPI()
    if authenticated:
        mock_user = MagicMock()
        mock_user.id = uuid4()
        mock_user.email = ("admin" if admin else "user") + "@example.com"
        mock_user.is_active = True
        mock_user.is_verified = True
        mock_user.is_superuser = admin
        test_app.dependency_overrides[get_current_active_user_async] = lambda: mock_user
        test_app.dependency_overrides[get_current_user_async] = lambda: mock_user
    test_app.include_router(operations_router, prefix="/api/v1/operations")
    return test_app


@pytest.fixture()
def admin_client() -> TestClient:
    return TestClient(_build_test_app(admin=True))


@pytest.fixture()
def user_client() -> TestClient:
    return TestClient(_build_test_app(admin=False))


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


API_PREFIX = "/api/v1/operations"


# ---------------------------------------------------------------------------
# POST /agents/spawn
# ---------------------------------------------------------------------------


class TestPostAgentsSpawn:
    def test_admin_can_spawn(self, admin_client: TestClient):
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

            resp = admin_client.post(f"{API_PREFIX}/agents/spawn", json=body)

        assert resp.status_code == 200
        assert resp.json() == coord_payload

        # Confirm coord URL + JSON body pass through unchanged.
        called_url = instance.post.call_args.args[0]
        assert called_url.endswith("/agents/spawn")
        called_json = instance.post.call_args.kwargs.get("json")
        assert called_json == body

    def test_non_admin_is_forbidden(self, user_client: TestClient):
        # require_admin returns 403 for a non-superuser; coord should
        # never be called.
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            _configure_mock_client(MockClient, instance)

            resp = user_client.post(
                f"{API_PREFIX}/agents/spawn",
                json={"plan_slug": "x", "device_id": "y"},
            )

        assert resp.status_code == 403
        instance.post.assert_not_called()

    def test_coord_400_passed_through(self, admin_client: TestClient):
        # coord rejects (e.g. unknown plan, no device available) → the
        # proxy preserves status code so the operator UI can surface it.
        mock_resp = _mock_response(
            status_code=400, text='{"error": "unknown plan_slug"}'
        )
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.post.return_value = mock_resp
            _configure_mock_client(MockClient, instance)
            resp = admin_client.post(
                f"{API_PREFIX}/agents/spawn",
                json={"plan_slug": "bogus"},
            )
        assert resp.status_code == 400

    def test_coord_unreachable_returns_502(self, admin_client: TestClient):
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.post.side_effect = httpx.ConnectError("refused")
            _configure_mock_client(MockClient, instance)
            resp = admin_client.post(
                f"{API_PREFIX}/agents/spawn",
                json={"plan_slug": "x"},
            )
        assert resp.status_code == 502


# ---------------------------------------------------------------------------
# GET /agents/{agent_id}
# ---------------------------------------------------------------------------


class TestGetAgent:
    def test_admin_can_fetch(self, admin_client: TestClient):
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

            resp = admin_client.get(f"{API_PREFIX}/agents/agent-deadbeef")

        assert resp.status_code == 200
        assert resp.json() == coord_payload
        called_url = instance.get.call_args.args[0]
        assert called_url.endswith("/agents/agent-deadbeef")

    def test_non_admin_is_forbidden(self, user_client: TestClient):
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            _configure_mock_client(MockClient, instance)
            resp = user_client.get(f"{API_PREFIX}/agents/agent-x")
        assert resp.status_code == 403
        instance.get.assert_not_called()

    def test_coord_404_passed_through(self, admin_client: TestClient):
        mock_resp = _mock_response(
            status_code=404, text='{"error": "agent not found"}'
        )
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)
            resp = admin_client.get(f"{API_PREFIX}/agents/nonexistent")
        assert resp.status_code == 404
