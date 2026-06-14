"""Integration tests for the ``/operations/migrations/queue`` proxy.

Coord-authoritative migration reservation queue (`migration_reservations.rs`,
plan ``2026-06-08-coord-migration-reservation-queue.md``). The web backend
proxies coord's ``GET /coord/migrations/queue?repo=`` so the browser doesn't
hit coord cross-origin and the operator bearer is forwarded.

Mirrors the pattern in ``test_operations_dev_actions_proxy.py``: minimal
FastAPI app + mocked ``httpx.AsyncClient`` so no live coord is needed.
"""

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient


def _build_test_app(*, authenticated: bool = True) -> FastAPI:
    from app.api.deps import get_current_active_user_async
    from app.api.v1.endpoints.operations import get_tenant_id
    from app.api.v1.endpoints.operations import router as operations_router

    test_app = FastAPI()
    if authenticated:
        mock_user = MagicMock()
        mock_user.id = uuid4()
        mock_user.email = "testuser@example.com"
        mock_user.is_active = True
        mock_user.is_verified = True
        test_app.dependency_overrides[get_current_active_user_async] = lambda: mock_user
        # The migrations-queue proxy depends on get_tenant_id (forwards the
        # operator bearer). Override it so the proxy path doesn't hit a real
        # DB / coord for tenant resolution.
        test_app.dependency_overrides[get_tenant_id] = lambda: uuid4()
    test_app.include_router(operations_router, prefix="/api/v1/operations")
    return test_app


@pytest.fixture()
def auth_client() -> TestClient:
    return TestClient(_build_test_app(authenticated=True))


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


def _queue_payload() -> dict:
    return {
        "repo": "qontinui/qontinui-web",
        "live": [
            {
                "id": "00000000-0000-0000-0000-000000000001",
                "repo": "qontinui/qontinui-web",
                "revision": "abc123def456",
                "down_revision": "root0000",
                "state": "queued",
                "pr_number": None,
                "pr_url": None,
                "requested_by_session": "agent-7",
                "authoring_deadline": "2026-06-11T10:45:00Z",
                "created_at": "2026-06-11T10:00:00Z",
                "bound_at": None,
                "merged_at": None,
                "terminated_at": None,
                "terminal_reason": None,
                "position": 1,
            }
        ],
        "recent_terminal": [],
    }


class TestGetMigrationsQueue:
    def test_proxies_to_coord(self, auth_client: TestClient):
        payload = _queue_payload()
        mock_resp = _mock_response(json_data=payload)
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)

            resp = auth_client.get(
                f"{API_PREFIX}/migrations/queue?repo=qontinui/qontinui-web"
            )

        assert resp.status_code == 200
        assert resp.json() == payload
        called_url = instance.get.call_args.args[0]
        assert called_url.endswith("/coord/migrations/queue")

    def test_repo_and_terminal_limit_forwarded(self, auth_client: TestClient):
        mock_resp = _mock_response(json_data=_queue_payload())
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)
            resp = auth_client.get(
                f"{API_PREFIX}/migrations/queue?repo=acme/widgets&terminal_limit=12"
            )
        assert resp.status_code == 200
        called_params = instance.get.call_args.kwargs.get("params", {})
        assert called_params.get("repo") == "acme/widgets"
        assert called_params.get("terminal_limit") == 12

    def test_terminal_limit_defaults_to_5(self, auth_client: TestClient):
        mock_resp = _mock_response(json_data=_queue_payload())
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)
            resp = auth_client.get(f"{API_PREFIX}/migrations/queue?repo=acme/widgets")
        assert resp.status_code == 200
        called_params = instance.get.call_args.kwargs.get("params", {})
        assert called_params.get("terminal_limit") == 5

    def test_repo_required(self, auth_client: TestClient):
        # `repo` has no default → FastAPI rejects the request before any proxy
        # call (coord 400s without it; we fail fast at the edge).
        resp = auth_client.get(f"{API_PREFIX}/migrations/queue")
        assert resp.status_code == 422

    def test_coord_4xx_passed_through(self, auth_client: TestClient):
        # e.g. coord's own 400 for a bare repo name flows back unchanged.
        mock_resp = _mock_response(
            status_code=400, text='{"error": "repo must be owner/repo"}'
        )
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)
            resp = auth_client.get(f"{API_PREFIX}/migrations/queue?repo=bare")
        assert resp.status_code == 400

    def test_coord_unreachable_returns_502(self, auth_client: TestClient):
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.side_effect = httpx.ConnectError("refused")
            _configure_mock_client(MockClient, instance)
            resp = auth_client.get(
                f"{API_PREFIX}/migrations/queue?repo=qontinui/qontinui-web"
            )
        assert resp.status_code == 502

    def test_coord_timeout_returns_504(self, auth_client: TestClient):
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.side_effect = httpx.TimeoutException("slow")
            _configure_mock_client(MockClient, instance)
            resp = auth_client.get(
                f"{API_PREFIX}/migrations/queue?repo=qontinui/qontinui-web"
            )
        assert resp.status_code == 504
