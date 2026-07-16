"""Integration tests for the per-PR check-detail proxy endpoint.

``GET /operations/pr-merge/prs/{repo}/{pr_number}/checks`` proxies coord's
``GET /coord/pr/:repo/:pr_number/state`` (plan
``2026-07-16-pr-failing-check-details-expandable.md`` Phase 1). The fleet
page fetches it lazily when an operator expands a PR row; the payload's
``checks[]`` (name/status/conclusion/completed_at/details_url) comes from
coord's deduped ``pr_check_runs_latest`` view.

The load-bearing detail under test: the web route accepts ``owner/name``
inline via the ``{repo:path}`` converter, but coord's ``:repo`` param is a
SINGLE path-encoded segment — so the proxy must re-encode the repo with
``quote(..., safe="")`` (``qontinui/qontinui-runner`` →
``qontinui%2Fqontinui-runner``) before building the coord URL.

Testing mirrors ``test_operations_blast_radius_proxy.py``: a minimal
FastAPI app with mocked ``httpx.AsyncClient``, no live coord.
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
# GET /operations/pr-merge/prs/{repo}/{pr_number}/checks
# ---------------------------------------------------------------------------


class TestGetPrMergePrChecks:
    """Proxy tests for the per-PR check-detail endpoint."""

    _COORD_STATE_PAYLOAD = {
        "repo": "qontinui/qontinui-runner",
        "pr_number": 774,
        "state": "open",
        "checks": [
            {
                "name": "security",
                "status": "completed",
                "conclusion": "failure",
                "completed_at": "2026-07-16T10:00:00Z",
                "details_url": "https://github.com/qontinui/qontinui-runner/runs/1",
            },
            {
                "name": "build-windows",
                "status": "in_progress",
                "conclusion": None,
                "completed_at": None,
                "details_url": "https://github.com/qontinui/qontinui-runner/runs/2",
            },
        ],
    }

    def test_repo_slash_is_path_encoded_in_coord_url(self, client: TestClient):
        """A repo containing ``/`` must reach coord as a single ``%2F``-encoded
        segment: coord's pr-state ``:repo`` param is single-segment, so the raw
        slash would be routed as two segments and 404."""
        mock_resp = _mock_response(json_data=self._COORD_STATE_PAYLOAD)

        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)

            resp = client.get(
                f"{API_PREFIX}/pr-merge/prs/qontinui/qontinui-runner/774/checks"
            )

        assert resp.status_code == 200
        assert resp.json() == self._COORD_STATE_PAYLOAD
        instance.get.assert_called_once()
        called_url = instance.get.call_args.args[0]
        assert called_url.endswith("/coord/pr/qontinui%2Fqontinui-runner/774/state")
        # The raw owner/name form must NOT survive into the coord path.
        assert "/coord/pr/qontinui/qontinui-runner" not in called_url

    def test_coord_404_passed_through(self, client: TestClient):
        """An unknown PR: coord's 404 status + body proxy through verbatim."""
        mock_resp = _mock_response(status_code=404, text="pr not found")

        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)

            resp = client.get(f"{API_PREFIX}/pr-merge/prs/owner/repo/9999/checks")

        assert resp.status_code == 404
        assert resp.json()["detail"] == "pr not found"

    def test_coord_unreachable_returns_502(self, client: TestClient):
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.side_effect = httpx.ConnectError("refused")
            _configure_mock_client(MockClient, instance)

            resp = client.get(f"{API_PREFIX}/pr-merge/prs/owner/repo/1/checks")

        assert resp.status_code == 502
        assert resp.json()["detail"] == "coord is not reachable"
