"""Integration tests for the ``/operations/dev-actions/*`` proxy.

Plan ``2026-06-07-twin-dev-event-cause-effect-ledger.md``.

Mirrors the pattern in ``test_operations_symbol_claims_proxy.py``: minimal
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
        # The dev-actions proxies depend on get_tenant_id (forwards the
        # operator bearer). Override it so the proxy path doesn't hit a
        # real DB / coord for tenant resolution.
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


# ---------------------------------------------------------------------------
# GET /operations/dev-actions/recent
# ---------------------------------------------------------------------------


class TestGetDevActionsRecent:
    def test_proxies_to_coord_recent(self, auth_client: TestClient):
        coord_payload = {
            "actions": [
                {
                    "action_id": "a1",
                    "kind": "click",
                    "device_id": "00000000-0000-0000-0000-000000000001",
                    "requester_id": "agent-7",
                    "params_digest": "deadbeef",
                    "state_ids": ["LoginPage"],
                    "states_unknown": [],
                    "started_at": "2026-06-07T10:00:00Z",
                    "ended_at": "2026-06-07T10:00:01Z",
                    "category": "confirmed",
                    "duration_ms": 1000,
                    "evidence_ref": None,
                    "tenant_id": None,
                    "metadata": {},
                }
            ],
            "count": 1,
        }
        mock_resp = _mock_response(json_data=coord_payload)

        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)

            resp = auth_client.get(f"{API_PREFIX}/dev-actions/recent")

        assert resp.status_code == 200
        assert resp.json() == coord_payload
        called_url = instance.get.call_args.args[0]
        assert called_url.endswith("/coord/dev-actions/recent")

    def test_filters_forwarded(self, auth_client: TestClient):
        coord_payload = {"actions": [], "count": 0}
        mock_resp = _mock_response(json_data=coord_payload)
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)
            resp = auth_client.get(
                f"{API_PREFIX}/dev-actions/recent?limit=25&kind=click&device_id=dev-1"
            )
        assert resp.status_code == 200
        called_params = instance.get.call_args.kwargs.get("params", {})
        assert called_params.get("limit") == 25
        assert called_params.get("kind") == "click"
        assert called_params.get("device_id") == "dev-1"

    def test_no_filters_sends_no_params(self, auth_client: TestClient):
        coord_payload = {"actions": [], "count": 0}
        mock_resp = _mock_response(json_data=coord_payload)
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)
            resp = auth_client.get(f"{API_PREFIX}/dev-actions/recent")
        assert resp.status_code == 200
        called_params = instance.get.call_args.kwargs.get("params")
        assert called_params is None

    def test_coord_unreachable_returns_502(self, auth_client: TestClient):
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.side_effect = httpx.ConnectError("refused")
            _configure_mock_client(MockClient, instance)
            resp = auth_client.get(f"{API_PREFIX}/dev-actions/recent")
        assert resp.status_code == 502

    def test_coord_timeout_returns_504(self, auth_client: TestClient):
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.side_effect = httpx.TimeoutException("slow")
            _configure_mock_client(MockClient, instance)
            resp = auth_client.get(f"{API_PREFIX}/dev-actions/recent")
        assert resp.status_code == 504


# ---------------------------------------------------------------------------
# GET /operations/dev-actions/{action_id}
# ---------------------------------------------------------------------------


class TestGetDevActionDetail:
    def test_proxies_to_coord_detail(self, auth_client: TestClient):
        coord_payload = {
            "action": {
                "action_id": "a1",
                "kind": "click",
                "device_id": None,
                "requester_id": None,
                "params_digest": None,
                "state_ids": [],
                "states_unknown": [],
                "started_at": None,
                "ended_at": None,
                "category": "surprise",
                "duration_ms": None,
                "evidence_ref": None,
                "tenant_id": None,
                "metadata": None,
            },
            "outcomes": [
                {"signature": "DialogOpened", "observed_at": None, "late": False}
            ],
        }
        mock_resp = _mock_response(json_data=coord_payload)
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)
            resp = auth_client.get(f"{API_PREFIX}/dev-actions/a1")
        assert resp.status_code == 200
        assert resp.json() == coord_payload
        called_url = instance.get.call_args.args[0]
        assert called_url.endswith("/coord/dev-actions/a1")

    def test_coord_404_passed_through(self, auth_client: TestClient):
        mock_resp = _mock_response(status_code=404, text='{"error": "not found"}')
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)
            resp = auth_client.get(f"{API_PREFIX}/dev-actions/missing")
        assert resp.status_code == 404
