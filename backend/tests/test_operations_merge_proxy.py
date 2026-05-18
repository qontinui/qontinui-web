"""Integration tests for the coord merge-queue proxy endpoints.

These endpoints (under ``/api/v1/operations/merge/*``) proxy read-only
merge state from coord so the operations dashboard can render the
merge-train section without the browser hitting coord cross-origin.

Mirrors the testing pattern in ``test_constraints.py``: a minimal
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
# GET /operations/merge/queue
# ---------------------------------------------------------------------------


class TestGetMergeQueue:
    def test_returns_queue(self, auth_client: TestClient):
        coord_payload = [
            {
                "proposal_id": "p1",
                "agent_id": "agent-A",
                "repos": ["qontinui-web"],
                "status": "awaiting-ci",
            },
            {
                "proposal_id": "p2",
                "agent_id": "agent-B",
                "repos": ["qontinui-web"],
                "status": "queued",
            },
        ]
        mock_resp = _mock_response(json_data=coord_payload)

        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)

            resp = auth_client.get(f"{API_PREFIX}/merge/queue")

        assert resp.status_code == 200
        assert resp.json() == coord_payload
        # Verify coord was called at /merge/queue (path, not "/coord/merge/queue").
        instance.get.assert_called_once()
        called_url = instance.get.call_args.args[0]
        assert called_url.endswith("/merge/queue")

    def test_returns_empty_queue(self, auth_client: TestClient):
        mock_resp = _mock_response(json_data=[])

        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)

            resp = auth_client.get(f"{API_PREFIX}/merge/queue")

        assert resp.status_code == 200
        assert resp.json() == []

    def test_coord_unreachable_returns_502(self, auth_client: TestClient):
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.side_effect = httpx.ConnectError("refused")
            _configure_mock_client(MockClient, instance)

            resp = auth_client.get(f"{API_PREFIX}/merge/queue")

        assert resp.status_code == 502
        assert "coord is not reachable" in resp.json()["detail"]

    def test_coord_timeout_returns_504(self, auth_client: TestClient):
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.side_effect = httpx.TimeoutException("read timeout")
            _configure_mock_client(MockClient, instance)

            resp = auth_client.get(f"{API_PREFIX}/merge/queue")

        assert resp.status_code == 504

    def test_coord_5xx_is_proxied(self, auth_client: TestClient):
        mock_resp = _mock_response(status_code=503, text="coord overloaded")

        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)

            resp = auth_client.get(f"{API_PREFIX}/merge/queue")

        assert resp.status_code == 503


# ---------------------------------------------------------------------------
# GET /operations/merge/{proposal_id}
# ---------------------------------------------------------------------------


class TestGetMergeProposal:
    def test_returns_single_proposal(self, auth_client: TestClient):
        coord_payload = {
            "proposal_id": "p1",
            "agent_id": "agent-A",
            "repos": ["qontinui-web"],
            "status": "merged",
        }
        mock_resp = _mock_response(json_data=coord_payload)

        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)

            resp = auth_client.get(f"{API_PREFIX}/merge/p1")

        assert resp.status_code == 200
        assert resp.json() == coord_payload
        called_url = instance.get.call_args.args[0]
        assert called_url.endswith("/merge/p1")

    def test_unknown_proposal_returns_404(self, auth_client: TestClient):
        mock_resp = _mock_response(status_code=404, text="not found")

        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)

            resp = auth_client.get(f"{API_PREFIX}/merge/p-missing")

        assert resp.status_code == 404
