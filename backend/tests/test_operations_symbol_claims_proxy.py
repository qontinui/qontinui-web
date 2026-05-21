"""Integration tests for the ``/operations/symbol-claims`` proxy.

Plan ``2026-05-21-coordination-improvements.md`` Phase 4.4.

Mirrors the pattern in ``test_operations_claims_proxy.py``: minimal
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
    from app.api.v1.endpoints.operations import router as operations_router

    test_app = FastAPI()
    if authenticated:
        mock_user = MagicMock()
        mock_user.id = uuid4()
        mock_user.email = "testuser@example.com"
        mock_user.is_active = True
        mock_user.is_verified = True
        test_app.dependency_overrides[get_current_active_user_async] = lambda: mock_user
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
# GET /operations/symbol-claims
# ---------------------------------------------------------------------------


class TestGetSymbolClaims:
    def test_forwards_kind_symbol_to_coord(self, auth_client: TestClient):
        """The proxy MUST pin ``kind=symbol`` regardless of caller."""
        coord_payload = {
            "kind": "symbol",
            "prefix": "",
            "holders": [
                {
                    "kind": "symbol",
                    "resource_key": "qontinui-runner:src/main.rs:run_loop",
                    "machine_id": "00000000-0000-0000-0000-000000000001",
                    "ttl_seconds": 270,
                },
            ],
            "truncated": False,
        }
        mock_resp = _mock_response(json_data=coord_payload)

        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)

            resp = auth_client.get(f"{API_PREFIX}/symbol-claims")

        assert resp.status_code == 200
        assert resp.json() == coord_payload
        called_url = instance.get.call_args.args[0]
        assert called_url.endswith("/coord/claims/list")
        called_params = instance.get.call_args.kwargs.get("params", {})
        assert called_params.get("kind") == "symbol"
        assert called_params.get("prefix") == ""

    def test_limit_forwarded(self, auth_client: TestClient):
        coord_payload = {
            "kind": "symbol",
            "prefix": "",
            "holders": [],
            "truncated": False,
        }
        mock_resp = _mock_response(json_data=coord_payload)
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)
            resp = auth_client.get(f"{API_PREFIX}/symbol-claims?limit=25")
        assert resp.status_code == 200
        called_params = instance.get.call_args.kwargs.get("params", {})
        assert called_params.get("limit") == 25

    def test_machine_id_filter_applied_client_side(
        self, auth_client: TestClient
    ):
        """``machine_id`` filter narrows the response after coord returns.

        Coord's ``/coord/claims/list`` doesn't support a holder filter,
        so the proxy applies it post-fetch over the ``holders`` list.
        """
        target = "11111111-1111-1111-1111-111111111111"
        other = "22222222-2222-2222-2222-222222222222"
        coord_payload = {
            "kind": "symbol",
            "prefix": "",
            "holders": [
                {
                    "kind": "symbol",
                    "resource_key": "repo-a:src/main.rs:foo",
                    "machine_id": target,
                    "ttl_seconds": 200,
                },
                {
                    "kind": "symbol",
                    "resource_key": "repo-b:src/lib.rs:bar",
                    "machine_id": other,
                    "ttl_seconds": 150,
                },
                {
                    "kind": "symbol",
                    "resource_key": "repo-c:src/util.rs:baz",
                    "machine_id": target,
                    "ttl_seconds": 100,
                },
            ],
            "truncated": False,
        }
        mock_resp = _mock_response(json_data=coord_payload)
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)
            resp = auth_client.get(
                f"{API_PREFIX}/symbol-claims?machine_id={target}"
            )
        assert resp.status_code == 200
        body = resp.json()
        held_machines = {h["machine_id"] for h in body["holders"]}
        assert held_machines == {target}
        assert len(body["holders"]) == 2

    def test_coord_unreachable_returns_502(self, auth_client: TestClient):
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.side_effect = httpx.ConnectError("refused")
            _configure_mock_client(MockClient, instance)
            resp = auth_client.get(f"{API_PREFIX}/symbol-claims")
        assert resp.status_code == 502

    def test_coord_timeout_returns_504(self, auth_client: TestClient):
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.side_effect = httpx.TimeoutException("slow")
            _configure_mock_client(MockClient, instance)
            resp = auth_client.get(f"{API_PREFIX}/symbol-claims")
        assert resp.status_code == 504

    def test_coord_400_passed_through(self, auth_client: TestClient):
        mock_resp = _mock_response(
            status_code=400, text='{"error": "redis down"}'
        )
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)
            resp = auth_client.get(f"{API_PREFIX}/symbol-claims")
        assert resp.status_code == 400
