"""Integration tests for the coord cross-repo lands-verifications proxy.

The ``GET /api/v1/operations/lands/verifications`` endpoint proxies coord's
``/coord/restacks/verifications`` so the operations dashboard can render the
composed cross-repo restack verdicts for a cascade correlation without the
browser hitting coord cross-origin.

Mirrors the testing pattern in ``test_operations_merge_proxy.py``: a minimal
FastAPI app + mocked ``httpx.AsyncClient`` so no live coord is needed.
"""

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient


def _build_test_app(*, authenticated: bool = True) -> FastAPI:
    """Build a minimal FastAPI app exposing the operations router."""
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
        # The lands proxies depend on get_tenant_id (to forward the operator
        # bearer so coord gates this FleetPrincipal endpoint). Override it so
        # the proxy path doesn't hit a real DB for tenant resolution.
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
CORRELATION_ID = "11111111-1111-1111-1111-111111111111"


# ---------------------------------------------------------------------------
# GET /operations/lands/verifications
# ---------------------------------------------------------------------------


class TestGetLandsVerifications:
    def test_returns_composed_verifications(self, auth_client: TestClient):
        coord_payload = {
            "correlation_id": CORRELATION_ID,
            "repos": [
                {
                    "repo": "qontinui-web",
                    "signature_id": "sig-1",
                    "worst_drift_class": "divergent",
                    "d3_outcome": "rejected",
                    "verified_at": "2026-06-05T00:00:00Z",
                    "edge_verdicts": [],
                }
            ],
            "composed": {
                "worst_drift_class": "divergent",
                "repo_count": 1,
                "verified_count": 1,
            },
        }
        mock_resp = _mock_response(json_data=coord_payload)

        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)

            resp = auth_client.get(
                f"{API_PREFIX}/lands/verifications",
                params={"correlation_id": CORRELATION_ID},
            )

        assert resp.status_code == 200
        assert resp.json() == coord_payload
        instance.get.assert_called_once()
        called_url = instance.get.call_args.args[0]
        called_params = instance.get.call_args.kwargs["params"]
        assert called_url.endswith("/restacks/verifications")
        assert called_params == {"correlation_id": CORRELATION_ID}

    def test_returns_empty_case(self, auth_client: TestClient):
        coord_payload = {
            "composed": {
                "repo_count": 0,
                "verified_count": 0,
                "worst_drift_class": "none",
            },
            "correlation_id": CORRELATION_ID,
            "repos": [],
        }
        mock_resp = _mock_response(json_data=coord_payload)

        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)

            resp = auth_client.get(
                f"{API_PREFIX}/lands/verifications",
                params={"correlation_id": CORRELATION_ID},
            )

        assert resp.status_code == 200
        assert resp.json() == coord_payload

    def test_missing_correlation_id_returns_422(self, auth_client: TestClient):
        # FastAPI rejects the request before the proxy is reached when the
        # required query param is absent.
        resp = auth_client.get(f"{API_PREFIX}/lands/verifications")
        assert resp.status_code == 422

    def test_bad_correlation_id_returns_422(self, auth_client: TestClient):
        resp = auth_client.get(
            f"{API_PREFIX}/lands/verifications",
            params={"correlation_id": "not-a-uuid"},
        )
        assert resp.status_code == 422

    def test_coord_unreachable_returns_502(self, auth_client: TestClient):
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.side_effect = httpx.ConnectError("refused")
            _configure_mock_client(MockClient, instance)

            resp = auth_client.get(
                f"{API_PREFIX}/lands/verifications",
                params={"correlation_id": CORRELATION_ID},
            )

        assert resp.status_code == 502
        assert "coord is not reachable" in resp.json()["detail"]

    def test_coord_timeout_returns_504(self, auth_client: TestClient):
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.side_effect = httpx.TimeoutException("read timeout")
            _configure_mock_client(MockClient, instance)

            resp = auth_client.get(
                f"{API_PREFIX}/lands/verifications",
                params={"correlation_id": CORRELATION_ID},
            )

        assert resp.status_code == 504

    def test_coord_422_passes_through(self, auth_client: TestClient):
        mock_resp = _mock_response(status_code=422, text="bad correlation")

        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)

            resp = auth_client.get(
                f"{API_PREFIX}/lands/verifications",
                params={"correlation_id": CORRELATION_ID},
            )

        assert resp.status_code == 422
