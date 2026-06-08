"""Integration tests for the blast-radius gate-decision proxy endpoints.

``GET /operations/pr-merge/blast-radius-blocks`` and
``GET /operations/pr-merge/decisions/:owner/:name/:pr`` are the two
transparency endpoints added in plan
``2026-06-07-coordination-transparency-surfaces.md`` (T2). They proxy the
coord-side ``blast_radius_monitor.rs::list_blocks`` and
``specialist_query::get_decisions`` routes.

Auth posture: both routes use ``get_tenant_id`` (any authenticated tenant
member, NOT admin-only) so the PR author can see why their own PR was held
without requiring operator rights.

Testing mirrors ``test_operations_merge_proxy.py``: a minimal FastAPI app
with mocked ``httpx.AsyncClient``, no live coord.
"""

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient


def _build_test_app() -> FastAPI:
    """Minimal FastAPI app with the operations router + auth overridden."""
    from app.api.deps import get_current_active_user_async
    from app.api.v1.endpoints.operations import get_tenant_id
    from app.api.v1.endpoints.operations import router as operations_router

    test_app = FastAPI()
    mock_user = MagicMock()
    mock_user.id = uuid4()
    mock_user.email = "dev@example.com"
    mock_user.is_active = True
    mock_user.is_verified = True
    test_app.dependency_overrides[get_current_active_user_async] = lambda: mock_user
    # Override tenant resolution so the proxy doesn't hit a real DB.
    test_app.dependency_overrides[get_tenant_id] = lambda: uuid4()
    test_app.include_router(operations_router, prefix="/api/v1/operations")
    return test_app


@pytest.fixture()
def client() -> TestClient:
    return TestClient(_build_test_app())


def _mock_response(
    status_code: int = 200, json_data=None, text: str = ""
) -> MagicMock:
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
# GET /operations/pr-merge/blast-radius-blocks
# ---------------------------------------------------------------------------


class TestGetBlastRadiusBlocks:
    """Proxy tests for the blast-radius gate-decision list endpoint."""

    _COORD_BLOCKS_PAYLOAD = {
        "tenant_id": "00000000-0000-0000-0000-000000000001",
        "repo": None,
        "total_blocks": 1,
        "returned": 1,
        "blocks": [
            {
                "repo": "owner/myrepo",
                "pr_number": 42,
                "tenant_id": "00000000-0000-0000-0000-000000000001",
                "removed_export_name": "legacyHelper",
                "file": "src/utils.ts",
                "referenced_by": [{"file": "src/page.tsx", "line": 7}],
                "evaluation_latency_secs": 1.2,
                "at": "2026-06-08T10:00:00Z",
                "coverage": 0.9,
                "graph_available": True,
                "block_reason_code": "removes-referenced-export",
                "outer_state": "SPECIALIST_REVIEW",
            }
        ],
    }

    def test_returns_blocks(self, client: TestClient):
        mock_resp = _mock_response(json_data=self._COORD_BLOCKS_PAYLOAD)

        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)

            resp = client.get(f"{API_PREFIX}/pr-merge/blast-radius-blocks")

        assert resp.status_code == 200
        assert resp.json() == self._COORD_BLOCKS_PAYLOAD
        instance.get.assert_called_once()
        called_url = instance.get.call_args.args[0]
        assert called_url.endswith("/pr-merge/blast-radius-blocks")

    def test_repo_filter_forwarded(self, client: TestClient):
        """The optional ``repo`` query param is forwarded to coord."""
        mock_resp = _mock_response(json_data={"blocks": [], "total_blocks": 0})

        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)

            resp = client.get(
                f"{API_PREFIX}/pr-merge/blast-radius-blocks",
                params={"repo": "owner/myrepo"},
            )

        assert resp.status_code == 200
        # Confirm the ``params`` kwarg was forwarded (not absorbed into the URL).
        call_params = instance.get.call_args.kwargs.get("params") or {}
        assert call_params.get("repo") == "owner/myrepo"

    def test_limit_param_forwarded(self, client: TestClient):
        """The ``limit`` query param defaults to 50 but can be overridden."""
        mock_resp = _mock_response(json_data={"blocks": [], "total_blocks": 0})

        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)

            resp = client.get(
                f"{API_PREFIX}/pr-merge/blast-radius-blocks",
                params={"limit": 10},
            )

        assert resp.status_code == 200
        call_params = instance.get.call_args.kwargs.get("params") or {}
        assert int(call_params.get("limit", 50)) == 10

    def test_empty_list_returns_200(self, client: TestClient):
        """An empty blocks list is a valid successful response — not an error."""
        coord_payload = {"blocks": [], "total_blocks": 0, "returned": 0}
        mock_resp = _mock_response(json_data=coord_payload)

        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)

            resp = client.get(f"{API_PREFIX}/pr-merge/blast-radius-blocks")

        assert resp.status_code == 200
        assert resp.json()["total_blocks"] == 0

    def test_coord_unreachable_returns_502(self, client: TestClient):
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.side_effect = httpx.ConnectError("refused")
            _configure_mock_client(MockClient, instance)

            resp = client.get(f"{API_PREFIX}/pr-merge/blast-radius-blocks")

        assert resp.status_code == 502
        assert "coord is not reachable" in resp.json()["detail"]

    def test_coord_timeout_returns_504(self, client: TestClient):
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.side_effect = httpx.TimeoutException("read timeout")
            _configure_mock_client(MockClient, instance)

            resp = client.get(f"{API_PREFIX}/pr-merge/blast-radius-blocks")

        assert resp.status_code == 504

    def test_coord_4xx_is_proxied(self, client: TestClient):
        mock_resp = _mock_response(status_code=404, text="endpoint not found")

        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)

            resp = client.get(f"{API_PREFIX}/pr-merge/blast-radius-blocks")

        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# GET /operations/pr-merge/decisions/{owner}/{name}/{pr}
# ---------------------------------------------------------------------------


class TestGetPrMergeDecisions:
    """Proxy tests for the per-PR gate-decision history endpoint."""

    _COORD_DECISIONS_PAYLOAD = {
        "decisions": [
            {
                "decision_id": "d1",
                "verdict": "hold",
                "block_reason_code": "removes-referenced-export",
                "coverage": 1.0,
                "graph_available": True,
                "evaluated_at": "2026-06-08T09:30:00Z",
            }
        ],
        "total": 1,
    }

    def test_returns_decisions(self, client: TestClient):
        mock_resp = _mock_response(json_data=self._COORD_DECISIONS_PAYLOAD)

        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)

            resp = client.get(
                f"{API_PREFIX}/pr-merge/decisions/acme-org/myrepo/99"
            )

        assert resp.status_code == 200
        assert resp.json() == self._COORD_DECISIONS_PAYLOAD
        instance.get.assert_called_once()
        called_url = instance.get.call_args.args[0]
        assert called_url.endswith("/pr-merge/decisions/acme-org/myrepo/99")

    def test_path_segments_forwarded_correctly(self, client: TestClient):
        """owner / name / pr are forwarded as path segments, not query params."""
        mock_resp = _mock_response(json_data={"decisions": [], "total": 0})

        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)

            resp = client.get(
                f"{API_PREFIX}/pr-merge/decisions/some-owner/some-name/123"
            )

        assert resp.status_code == 200
        called_url = instance.get.call_args.args[0]
        assert "/pr-merge/decisions/some-owner/some-name/123" in called_url

    def test_unknown_pr_returns_404(self, client: TestClient):
        mock_resp = _mock_response(status_code=404, text="pr not found")

        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)

            resp = client.get(
                f"{API_PREFIX}/pr-merge/decisions/owner/repo/9999"
            )

        assert resp.status_code == 404

    def test_coord_unreachable_returns_502(self, client: TestClient):
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.side_effect = httpx.ConnectError("refused")
            _configure_mock_client(MockClient, instance)

            resp = client.get(
                f"{API_PREFIX}/pr-merge/decisions/owner/repo/1"
            )

        assert resp.status_code == 502
        assert "coord is not reachable" in resp.json()["detail"]

    def test_coord_timeout_returns_504(self, client: TestClient):
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.side_effect = httpx.TimeoutException("timeout")
            _configure_mock_client(MockClient, instance)

            resp = client.get(
                f"{API_PREFIX}/pr-merge/decisions/owner/repo/1"
            )

        assert resp.status_code == 504
