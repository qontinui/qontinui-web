"""Integration tests for the coord alerts proxy (``/operations/alerts``).

Backs the ``/admin/coord/alerts`` tab, the ``CoordNav`` badge and
``RedMainBanner``. The frontend never calls coord directly — the chain is
``frontend → /api/v1/operations/alerts → coord /coord/alerts`` — so this
proxy is what decides whether the new coord filter vocabulary
(``limit`` / ``cursor`` / repeated ``kind`` / repeated ``severity``) and
the new response fields (``total_count``, the served kind list) actually
reach the UI.

Plan ``2026-08-05-coord-alerts-surface-and-fleet-style-ui.md`` — web PR,
step 1.

Mirrors the testing pattern in ``test_operations_claims_proxy.py``:
minimal FastAPI app + mocked ``httpx.AsyncClient`` so no live coord is
needed.
"""

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

# Fixed operator tenant so tests can assert the proxy resolves one (it
# triggers bearer-forwarding; nothing tenant-shaped rides the wire here).
TEST_TENANT_ID = uuid4()


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
        test_app.dependency_overrides[get_tenant_id] = lambda: TEST_TENANT_ID
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
# GET /operations/alerts
# ---------------------------------------------------------------------------


class TestCoordAlerts:
    def test_response_passed_through_untouched(self, auth_client: TestClient):
        """``total_count`` and the served kind list must survive the proxy.

        The badge reads ``total_count``; the tab's filter vocabulary is
        the API-served ``kinds``. Re-wrapping or re-keying the envelope
        here would silently drop both.
        """
        coord_payload = {
            "alerts": [{"id": "a-1", "alert_key": "red_main:qontinui-web"}],
            "count": 1,
            "total_count": 1643,
            "kinds": ["red_main", "stale_wip", "worktree_disk_danger"],
            "next_cursor": "eyJ0IjoxfQ",
        }
        mock_resp = _mock_response(json_data=coord_payload)
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)
            resp = auth_client.get(f"{API_PREFIX}/alerts")

        assert resp.status_code == 200
        assert resp.json() == coord_payload
        called_url = instance.get.call_args.args[0]
        assert called_url.endswith("/coord/alerts")

    def test_default_forwards_only_include_resolved(self, auth_client: TestClient):
        mock_resp = _mock_response(json_data={"alerts": [], "count": 0})
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)
            resp = auth_client.get(f"{API_PREFIX}/alerts")

        assert resp.status_code == 200
        called_params = instance.get.call_args.kwargs.get("params", {})
        assert called_params == {"include_resolved": False}

    def test_limit_and_cursor_forwarded(self, auth_client: TestClient):
        mock_resp = _mock_response(
            json_data={"alerts": [], "count": 0, "total_count": 1643}
        )
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)
            resp = auth_client.get(f"{API_PREFIX}/alerts?limit=1&cursor=abc123")

        assert resp.status_code == 200
        called_params = instance.get.call_args.kwargs.get("params", {})
        assert called_params.get("limit") == 1
        assert called_params.get("cursor") == "abc123"

    def test_repeated_kind_and_severity_forwarded_as_lists(
        self, auth_client: TestClient
    ):
        """Multi-select must reach coord as a LIST, not a stringified one."""
        mock_resp = _mock_response(json_data={"alerts": [], "count": 0})
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)
            resp = auth_client.get(
                f"{API_PREFIX}/alerts"
                "?kind=stale_wip&kind=red_main&severity=critical&severity=warning"
            )

        assert resp.status_code == 200
        called_params = instance.get.call_args.kwargs.get("params", {})
        assert called_params.get("kind") == ["stale_wip", "red_main"]
        assert called_params.get("severity") == ["critical", "warning"]

    def test_repeated_params_reach_the_wire_as_repeated_keys(
        self, auth_client: TestClient
    ):
        """The list must encode as ``kind=a&kind=b`` on the actual wire.

        Asserting the params dict alone would still pass if httpx
        stringified the list; this pins the encoding httpx applies to the
        dict ``_proxy_coord_get`` hands it.
        """
        mock_resp = _mock_response(json_data={"alerts": [], "count": 0})
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)
            auth_client.get(f"{API_PREFIX}/alerts?kind=stale_wip&kind=red_main")

        called_params = instance.get.call_args.kwargs.get("params", {})
        encoded = str(httpx.QueryParams(called_params))
        assert "kind=stale_wip&kind=red_main" in encoded
        assert "%5B" not in encoded  # no urlencoded "[" — i.e. not a str()'d list

    def test_blank_filters_are_not_forwarded(self, auth_client: TestClient):
        """``?severity=`` means "no filter", not "severity is empty".

        FastAPI yields ``[""]`` for an explicitly-empty repeatable param,
        which is truthy — forwarding it would ask coord for rows whose
        severity is the empty string and silently return zero.
        """
        mock_resp = _mock_response(json_data={"alerts": [], "count": 0})
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)
            resp = auth_client.get(f"{API_PREFIX}/alerts?severity=&kind=%20")

        assert resp.status_code == 200
        called_params = instance.get.call_args.kwargs.get("params", {})
        assert called_params == {"include_resolved": False}

    def test_blank_entries_dropped_from_a_multi_value_filter(
        self, auth_client: TestClient
    ):
        mock_resp = _mock_response(json_data={"alerts": [], "count": 0})
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)
            resp = auth_client.get(f"{API_PREFIX}/alerts?severity=&severity=critical")

        assert resp.status_code == 200
        called_params = instance.get.call_args.kwargs.get("params", {})
        assert called_params.get("severity") == ["critical"]

    @pytest.mark.parametrize("bad_limit", ["0", "-1", "99999999"])
    def test_limit_out_of_range_rejected_at_the_edge(
        self, auth_client: TestClient, bad_limit: str
    ):
        """coord's hard max is 1000; nonsense 422s here, not at coord."""
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            _configure_mock_client(MockClient, instance)
            resp = auth_client.get(f"{API_PREFIX}/alerts?limit={bad_limit}")

        assert resp.status_code == 422
        instance.get.assert_not_called()

    def test_limit_at_the_upper_bound_is_accepted(self, auth_client: TestClient):
        mock_resp = _mock_response(json_data={"alerts": [], "count": 0})
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)
            resp = auth_client.get(f"{API_PREFIX}/alerts?limit=1000")

        assert resp.status_code == 200
        assert instance.get.call_args.kwargs.get("params", {}).get("limit") == 1000

    def test_include_resolved_forwarded(self, auth_client: TestClient):
        mock_resp = _mock_response(json_data={"alerts": [], "count": 0})
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)
            resp = auth_client.get(f"{API_PREFIX}/alerts?include_resolved=true")

        assert resp.status_code == 200
        called_params = instance.get.call_args.kwargs.get("params", {})
        assert called_params.get("include_resolved") is True

    def test_list_payload_shape_passed_through(self, auth_client: TestClient):
        """An older coord returning a bare list still proxies unchanged."""
        coord_payload = [{"alert_key": "red_main:qontinui-coord"}]
        mock_resp = _mock_response(json_data=coord_payload)
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)
            resp = auth_client.get(f"{API_PREFIX}/alerts")

        assert resp.status_code == 200
        assert resp.json() == coord_payload

    def test_coord_unreachable_returns_502(self, auth_client: TestClient):
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.side_effect = httpx.ConnectError("refused")
            _configure_mock_client(MockClient, instance)
            resp = auth_client.get(f"{API_PREFIX}/alerts")
        assert resp.status_code == 502


# ---------------------------------------------------------------------------
# auth gate — unauthenticated callers are rejected before any coord call
# ---------------------------------------------------------------------------


class TestAuthGate:
    def test_unauthenticated_rejected(self):
        # No dependency overrides -> the real auth dependency runs and the
        # request has no credentials, so it never reaches coord.
        client = TestClient(_build_test_app(authenticated=False))
        resp = client.get(f"{API_PREFIX}/alerts")
        assert resp.status_code in (401, 403)
