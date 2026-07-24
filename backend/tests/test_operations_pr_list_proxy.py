"""Integration tests for the open-PR listing proxy's query-param forwarding.

``GET /operations/pr-merge/prs`` proxies coord's ``GET /pr-merge/prs``. It
carries two INDEPENDENT merged-PR params with very different costs, and the
whole point of keeping them separate is that the fleet dashboard can ask for
one without paying for the other:

* ``include_merged=<h>`` — the merged ROWS. coord resolves a deploy surface
  per repo and runs a git-ancestry probe per merged PR; measured against prod
  it timed out 5/5 at the 30s gateway under load, so the dashboard issues it
  only while its "Merged" tab is open.
* ``merged_count_hours=<h>`` — the merged COUNT. One indexed ``count(*)``, no
  probes. It rides the hot poll so the "Merged" tab can carry a real number
  instead of a dash before anyone opens it.

Each is forwarded ONLY when set, so the default request stays byte-for-byte
the legacy open-PRs-only call. Mirrors ``test_operations_pr_checks_proxy.py``:
a minimal FastAPI app with mocked ``httpx.AsyncClient``, no live coord.
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


API_PREFIX = "/api/v1/operations"

_COORD_PAYLOAD = {"prs": [], "total": 0, "merged_recent_count": 12}


class TestGetPrMergePrs:
    def _call(self, client: TestClient, query: str = ""):
        mock_resp = _mock_response(json_data=_COORD_PAYLOAD)
        with patch("app.api.v1.endpoints.operations.httpx.AsyncClient") as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            instance.__aenter__ = AsyncMock(return_value=instance)
            instance.__aexit__ = AsyncMock(return_value=False)
            MockClient.return_value = instance
            resp = client.get(f"{API_PREFIX}/pr-merge/prs{query}")
        return resp, instance

    def test_default_request_sends_no_merged_params(self, client: TestClient):
        """No params set → coord sees the legacy call with no query string.

        Load-bearing: an accidental ``include_merged=0`` would still be a
        param, and a coord that reads it as truthy would run the expensive
        merged-row read on every hot poll.
        """
        resp, instance = self._call(client)

        assert resp.status_code == 200
        assert instance.get.call_args.kwargs["params"] is None

    def test_merged_count_hours_forwarded_alone(self, client: TestClient):
        """The cheap count must be requestable WITHOUT the expensive rows."""
        resp, instance = self._call(client, "?merged_count_hours=48")

        assert resp.status_code == 200
        params = instance.get.call_args.kwargs["params"]
        assert params == {"merged_count_hours": 48}
        assert "include_merged" not in params
        # The envelope proxies verbatim, count field included.
        assert resp.json()["merged_recent_count"] == 12

    def test_both_params_forwarded_independently(self, client: TestClient):
        resp, instance = self._call(client, "?include_merged=48&merged_count_hours=48")

        assert resp.status_code == 200
        assert instance.get.call_args.kwargs["params"] == {
            "include_merged": 48,
            "merged_count_hours": 48,
        }

    def test_merged_count_hours_bounded(self, client: TestClient):
        """30 days is the ceiling — coord caps it too, but a nonsense window
        should never reach the wire."""
        resp, _ = self._call(client, "?merged_count_hours=100000")

        assert resp.status_code == 422

    def test_coord_unreachable_returns_502(self, client: TestClient):
        with patch("app.api.v1.endpoints.operations.httpx.AsyncClient") as MockClient:
            instance = AsyncMock()
            instance.get.side_effect = httpx.ConnectError("refused")
            instance.__aenter__ = AsyncMock(return_value=instance)
            instance.__aexit__ = AsyncMock(return_value=False)
            MockClient.return_value = instance

            resp = client.get(f"{API_PREFIX}/pr-merge/prs?merged_count_hours=48")

        assert resp.status_code == 502


class TestAdminDevPrsMirror:
    """``/admin-dev/prs`` proxies the same coord route and must not drift.

    The two proxies exist for different auth postures (this one degrades to an
    empty envelope when coord is down) but share a contract; the merged params
    were added to both, and a param that silently stops being forwarded here is
    invisible until someone reads the dashboard's numbers.
    """

    @pytest.fixture()
    def admin_client(self) -> TestClient:
        from app.api.deps import get_current_active_user_async
        from app.api.v1.endpoints.admin_dev import router as admin_dev_router

        test_app = FastAPI()
        mock_user = MagicMock()
        mock_user.id = uuid4()
        mock_user.is_active = True
        test_app.dependency_overrides[get_current_active_user_async] = lambda: mock_user
        test_app.include_router(admin_dev_router, prefix="/api/v1")
        return TestClient(test_app)

    def test_merged_count_hours_forwarded(self, admin_client: TestClient):
        mock_resp = _mock_response(json_data=_COORD_PAYLOAD)
        # `admin_dev` re-uses `operations._proxy_coord_get` (via
        # `app.api.coord_proxy`), so the httpx patch target stays `operations`
        # — see that module's docstring on why the bodies were not relocated.
        with patch("app.api.v1.endpoints.operations.httpx.AsyncClient") as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            instance.__aenter__ = AsyncMock(return_value=instance)
            instance.__aexit__ = AsyncMock(return_value=False)
            MockClient.return_value = instance

            resp = admin_client.get("/api/v1/admin-dev/prs?merged_count_hours=48")

        assert resp.status_code == 200
        assert instance.get.call_args.kwargs["params"] == {"merged_count_hours": 48}
        assert resp.json()["merged_recent_count"] == 12

    def test_default_request_sends_no_merged_params(self, admin_client: TestClient):
        mock_resp = _mock_response(json_data={"prs": [], "total": 0})
        # `admin_dev` re-uses `operations._proxy_coord_get` (via
        # `app.api.coord_proxy`), so the httpx patch target stays `operations`
        # — see that module's docstring on why the bodies were not relocated.
        with patch("app.api.v1.endpoints.operations.httpx.AsyncClient") as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            instance.__aenter__ = AsyncMock(return_value=instance)
            instance.__aexit__ = AsyncMock(return_value=False)
            MockClient.return_value = instance

            resp = admin_client.get("/api/v1/admin-dev/prs")

        assert resp.status_code == 200
        assert instance.get.call_args.kwargs["params"] is None
