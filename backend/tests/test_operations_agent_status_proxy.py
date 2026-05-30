"""Integration tests for the coord agent-status proxy endpoint.

`GET /api/v1/operations/agent-status` proxies coord's
`GET /coord/agent-status` — the work-unit-grain agent status read backed by
`coord.agent_status` (the coord-native MCP coordination surface). The
operator dashboard renders it as a dual-read, preferring these structured
rows over the legacy `/claims/list` metadata path.

Plan `coord-native-coordination-mcp` Phase 2 (dashboard-render half).

Mirrors `test_operations_claims_proxy.py`: minimal FastAPI app + mocked
`httpx.AsyncClient`, plus an override of the `get_tenant_id` dependency so no
DB is needed to resolve the caller's tenant.
"""

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID, uuid4

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

# A fixed tenant the dependency override returns, so the test can assert the
# proxy forwards it as the `tenant_id` query param.
TEST_TENANT = UUID("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")


def _build_test_app() -> FastAPI:
    from app.api.deps import get_current_active_user_async
    from app.api.v1.endpoints.operations import get_tenant_id
    from app.api.v1.endpoints.operations import router as operations_router

    test_app = FastAPI()
    mock_user = MagicMock()
    mock_user.id = uuid4()
    mock_user.email = "testuser@example.com"
    mock_user.is_active = True
    mock_user.is_verified = True
    test_app.dependency_overrides[get_current_active_user_async] = lambda: mock_user
    test_app.dependency_overrides[get_tenant_id] = lambda: TEST_TENANT
    test_app.include_router(operations_router, prefix="/api/v1/operations")
    return test_app


@pytest.fixture()
def auth_client() -> TestClient:
    return TestClient(_build_test_app())


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


class TestGetAgentStatus:
    def test_returns_rows_and_forwards_tenant(self, auth_client: TestClient):
        coord_payload = {
            "agents": [
                {
                    "device_id": "00000000-0000-0000-0000-000000000001",
                    "tenant_id": str(TEST_TENANT),
                    "correlation_topic": "plan-42",
                    "work_unit_id": "unit-1",
                    "status_text": "doing work",
                    "blocked_on": None,
                    "intent_globs": ["src/**/*.rs"],
                    "updated_at": "2026-05-24T12:00:00Z",
                    "expires_at": "2026-05-24T13:00:00Z",
                }
            ],
            "count": 1,
        }
        mock_resp = _mock_response(json_data=coord_payload)

        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)

            resp = auth_client.get(f"{API_PREFIX}/agent-status")

        assert resp.status_code == 200
        assert resp.json() == coord_payload
        # coord derives the tenant from the forwarded Cognito bearer
        # (Wave 2 fail-closed); web no longer sends the tenant_id query
        # param. With no correlation_topic the params dict is empty →
        # forwarded as None.
        called_url = instance.get.call_args.args[0]
        assert called_url.endswith("/coord/agent-status")
        called_params = instance.get.call_args.kwargs.get("params") or {}
        assert "tenant_id" not in called_params
        # Bearer-forward is wired (headers dict passed, not None) so coord
        # can resolve the OperatorContext from the forwarded token. (The
        # get_tenant_id override here bypasses the actual bearer capture,
        # so the header is empty under test — what matters is that
        # _proxy_coord_get was called with tenant_id= to trigger
        # _tenant_headers rather than omitting it.)
        assert "headers" in instance.get.call_args.kwargs
        # No correlation_topic forwarded when not requested.
        assert "correlation_topic" not in called_params

    def test_correlation_topic_forwarded(self, auth_client: TestClient):
        mock_resp = _mock_response(json_data={"agents": [], "count": 0})
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)
            resp = auth_client.get(
                f"{API_PREFIX}/agent-status?correlation_topic=plan-42"
            )
        assert resp.status_code == 200
        called_params = instance.get.call_args.kwargs.get("params") or {}
        assert called_params.get("correlation_topic") == "plan-42"
        # Wave 2: tenant_id is no longer sent on the wire (coord derives it).
        assert "tenant_id" not in called_params

    def test_empty_rows_pass_through(self, auth_client: TestClient):
        # Zero rows is a valid response (dual-read fallback is the
        # frontend's job); the proxy returns the empty envelope verbatim.
        coord_payload = {"agents": [], "count": 0}
        mock_resp = _mock_response(json_data=coord_payload)
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)
            resp = auth_client.get(f"{API_PREFIX}/agent-status")
        assert resp.status_code == 200
        assert resp.json() == coord_payload

    def test_coord_unreachable_returns_502(self, auth_client: TestClient):
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.side_effect = httpx.ConnectError("refused")
            _configure_mock_client(MockClient, instance)
            resp = auth_client.get(f"{API_PREFIX}/agent-status")
        assert resp.status_code == 502
