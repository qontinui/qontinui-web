"""Integration tests for the coord claims-dashboard proxy endpoints.

These endpoints (under ``/api/v1/operations/claims/*``) proxy read-only
claim state from coord so the ``/admin/agent-claims`` dashboard can
render without the browser hitting coord cross-origin.

Plan ``2026-05-18-agent-spawn-coordination.md`` Phase 5.

Mirrors the testing pattern in ``test_operations_merge_proxy.py``:
minimal FastAPI app + mocked ``httpx.AsyncClient`` so no live coord is
needed.
"""

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

# Fixed operator tenant so tests can assert the proxy forwards exactly
# this value as coord's ``?tenant_id=`` scope param (plan
# 2026-05-24-symbol-claim-tenant-scoping; mirrors the symbol-claims
# proxy tests).
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
        # The claims proxies now depend on get_tenant_id (fleet-auth
        # P2/D6 — forwards the operator bearer so coord can gate these
        # routes). Override it so the proxy path doesn't hit a real DB /
        # coord for tenant resolution.
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
# GET /operations/claims/list
# ---------------------------------------------------------------------------


class TestGetClaimsList:
    def test_returns_active_holders(self, auth_client: TestClient):
        coord_payload = {
            "kind": "phase",
            "prefix": "plan:my-plan:",
            "holders": [
                {
                    "kind": "phase",
                    "resource_key": "plan:my-plan:phase:1",
                    "machine_id": "00000000-0000-0000-0000-000000000001",
                    "ttl_seconds": 6000,
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
                f"{API_PREFIX}/claims/list?kind=phase&prefix=plan:my-plan:"
            )

        assert resp.status_code == 200
        assert resp.json() == coord_payload
        # Verify coord was called with the right path + query params.
        called_url = instance.get.call_args.args[0]
        assert called_url.endswith("/coord/claims/list")
        called_params = instance.get.call_args.kwargs.get("params", {})
        assert called_params.get("kind") == "phase"
        assert called_params.get("prefix") == "plan:my-plan:"

    def test_tenant_scope_forwarded_as_query_param(self, auth_client: TestClient):
        """The operator's resolved tenant rides the QUERY STRING.

        Coord reads the scope from ``ListQuery.tenant_id`` and asserts it
        against the forwarded bearer's home tenant (qontinui-coord#528) —
        the ``tenant_id=`` kwarg of ``_proxy_coord_get`` alone only
        triggers bearer-forwarding and puts nothing on the wire.
        """
        coord_payload = {
            "kind": "phase",
            "prefix": "",
            "holders": [],
            "truncated": False,
        }
        mock_resp = _mock_response(json_data=coord_payload)
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)
            resp = auth_client.get(f"{API_PREFIX}/claims/list?kind=phase")
        assert resp.status_code == 200
        called_params = instance.get.call_args.kwargs.get("params", {})
        assert called_params.get("tenant_id") == str(TEST_TENANT_ID)

    def test_kind_is_required(self, auth_client: TestClient):
        # Missing the required `kind` query param → FastAPI 422.
        resp = auth_client.get(f"{API_PREFIX}/claims/list")
        assert resp.status_code == 422

    def test_coord_400_passed_through(self, auth_client: TestClient):
        # coord returns 400 for an unrecognized kind; that should
        # surface as 400 here (proxy preserves status code).
        mock_resp = _mock_response(status_code=400, text='{"error": "invalid kind"}')
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)
            resp = auth_client.get(f"{API_PREFIX}/claims/list?kind=bogus")
        assert resp.status_code == 400


# ---------------------------------------------------------------------------
# GET /operations/claims/recent-conflicts
# ---------------------------------------------------------------------------


class TestRecentConflicts:
    def test_returns_entries(self, auth_client: TestClient):
        coord_payload = {
            "entries": [
                {
                    "recorded_at": "2026-05-18T12:34:56Z",
                    "requesting_machine_id": "m-a",
                    "current_holder": "m-b",
                    "kind": "phase",
                    "resource_key": "plan:foo:phase:1",
                }
            ],
            "count": 1,
        }
        mock_resp = _mock_response(json_data=coord_payload)
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)
            resp = auth_client.get(f"{API_PREFIX}/claims/recent-conflicts")
        assert resp.status_code == 200
        assert resp.json() == coord_payload

    def test_limit_forwarded(self, auth_client: TestClient):
        mock_resp = _mock_response(json_data={"entries": [], "count": 0})
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)
            resp = auth_client.get(f"{API_PREFIX}/claims/recent-conflicts?limit=25")
        assert resp.status_code == 200
        called_params = instance.get.call_args.kwargs.get("params", {})
        assert called_params.get("limit") == 25

    def test_coord_unreachable_returns_502(self, auth_client: TestClient):
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.side_effect = httpx.ConnectError("refused")
            _configure_mock_client(MockClient, instance)
            resp = auth_client.get(f"{API_PREFIX}/claims/recent-conflicts")
        assert resp.status_code == 502


# ---------------------------------------------------------------------------
# GET /operations/claims/recent-expirations
# ---------------------------------------------------------------------------


class TestRecentExpirations:
    def test_returns_entries(self, auth_client: TestClient):
        coord_payload = {
            "entries": [
                {
                    "recorded_at": "2026-05-18T12:00:00Z",
                    "kind": "file_glob",
                    "resource_key": "src/**/*.rs",
                    "last_known_holder": "m-a",
                }
            ],
            "count": 1,
        }
        mock_resp = _mock_response(json_data=coord_payload)
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)
            resp = auth_client.get(f"{API_PREFIX}/claims/recent-expirations")
        assert resp.status_code == 200
        assert resp.json() == coord_payload


# ---------------------------------------------------------------------------
# GET /operations/claims/steals
# ---------------------------------------------------------------------------


class TestSteals:
    def test_returns_rows(self, auth_client: TestClient):
        coord_payload = {
            "since": "2026-05-17T00:00:00Z",
            "count": 1,
            "rows": [
                {
                    "occurred_at": "2026-05-17T12:00:00Z",
                    "claim_kind": "phase",
                    "resource_key": "plan:foo:phase:1",
                    "stolen_from_machine_id": "00000000-0000-0000-0000-000000000001",
                    "stolen_by_machine_id": "00000000-0000-0000-0000-000000000002",
                    "steal_reason": "agent died without release",
                }
            ],
        }
        mock_resp = _mock_response(json_data=coord_payload)
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)
            resp = auth_client.get(f"{API_PREFIX}/claims/steals?limit=50")
        assert resp.status_code == 200
        assert resp.json() == coord_payload
        called_params = instance.get.call_args.kwargs.get("params", {})
        assert called_params.get("limit") == 50


# ---------------------------------------------------------------------------
# GET /operations/claims/alerts
# ---------------------------------------------------------------------------


class TestClaimsAlerts:
    """The claim slice is now selected by coord, not in Python.

    The endpoint used to pull the whole ``/coord/alerts`` rollup and keep
    the ``claim-`` prefixed rows in Python. coord caps that rollup at 500
    rows ordered by severity/recency, so claim alerts were evicted before
    the filter ever saw them (measured 0 rows, 2026-08-14). It now asks
    coord for ``?source=claim-`` — a prefix match done in SQL, which no
    other watcher's tick can evict.
    """

    def test_requests_the_claim_prefix_from_coord(self, auth_client: TestClient):
        coord_payload = {
            "alerts": [
                {"alert_key": "claim-stale-claims-m-a", "severity": "warning"},
                {"alert_key": "claim-stale-claims-unknown", "severity": "warning"},
            ]
        }
        mock_resp = _mock_response(json_data=coord_payload)
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)
            resp = auth_client.get(f"{API_PREFIX}/claims/alerts")
        assert resp.status_code == 200
        called_url = instance.get.call_args.args[0]
        assert called_url.endswith("/coord/alerts")
        called_params = instance.get.call_args.kwargs.get("params", {})
        assert called_params.get("source") == "claim-"
        # Passed through verbatim — no Python-side re-filtering.
        assert resp.json() == coord_payload

    def test_asks_for_coords_maximum_page_rather_than_its_default(
        self, auth_client: TestClient
    ):
        """The page size is EXPLICIT, because coord's default moved.

        This endpoint sent no ``limit``, so it inherited coord's default —
        and the coord half of the same plan dropped that default from 500
        to 100 when it added paging. The narrowing lives in another repo
        and produces no signal here, so the only thing that can pin it is
        an assertion on the outgoing request.

        It matters because the single consumer (``AgentClaimsDashboard``'s
        stale-claim section) neither pages nor reads ``total_count``: above
        the ceiling it renders a truncated list as the whole truth, which
        is the defect this plan exists to kill.
        """
        mock_resp = _mock_response(json_data={"alerts": []})
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)
            resp = auth_client.get(f"{API_PREFIX}/claims/alerts")
        assert resp.status_code == 200
        called_params = instance.get.call_args.kwargs.get("params", {})
        # coord's documented hard maximum; it clamps rather than erroring,
        # so this stays safe even if that ceiling is lowered later.
        assert called_params.get("limit") == 1000

    def test_no_python_side_filtering(self, auth_client: TestClient):
        """Whatever coord returns is what the caller gets.

        If a future coord widens ``source`` semantics (or the operator
        hits the route through a proxy that rewrites it), silently
        dropping rows here would hide the discrepancy instead of
        surfacing it.
        """
        coord_payload = {
            "alerts": [
                {"alert_key": "claim-stale-claims-m-a", "severity": "warning"},
                {"alert_key": "fleet-machine-partitioned-m-x", "severity": "critical"},
            ]
        }
        mock_resp = _mock_response(json_data=coord_payload)
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)
            resp = auth_client.get(f"{API_PREFIX}/claims/alerts")
        keys = [a["alert_key"] for a in resp.json()["alerts"]]
        assert keys == ["claim-stale-claims-m-a", "fleet-machine-partitioned-m-x"]

    def test_list_payload_shape_also_supported(self, auth_client: TestClient):
        # coord variants may return a bare list rather than a dict.
        coord_payload = [
            {"alert_key": "claim-stale-claims-m-z", "severity": "warning"},
        ]
        mock_resp = _mock_response(json_data=coord_payload)
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)
            resp = auth_client.get(f"{API_PREFIX}/claims/alerts")
        body = resp.json()
        assert isinstance(body, list)
        assert len(body) == 1
        assert body[0]["alert_key"] == "claim-stale-claims-m-z"
