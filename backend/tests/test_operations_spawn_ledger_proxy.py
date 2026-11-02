"""Integration tests for the spawn ledger proxies.

``GET /api/v1/operations/spawns``, ``/spawns/stats`` and ``/spawns/{spawn_id}``
proxy coord's ``GET /coord/spawns…`` reads so ``/admin/coord/spawns`` can render
without the browser calling coord. Plan
``2026-10-21-spawns-outrank-ci-and-builds-in-fleet-capacity-arbitration``
Phase 5. Same harness as ``test_operations_computers_proxy.py``: a minimal
FastAPI app and a mocked ``httpx.AsyncClient``, so no live coord is needed.

Properties pinned:

* the body passes through UNTOUCHED — a ``null`` share or percentile and a
  ``history_complete: false`` row reach the page as coord wrote them;
* coord's ``200 {"available": false, "reason": "schema_missing"}`` stays a 200
  with that body, so the page can say the ledger is not deployed yet;
* the operator bearer is forwarded (never an anonymous coord call);
* every declared filter reaches coord under coord's own name (``class``, not
  the Python parameter name), ``state`` as coord's comma list, timestamps
  normalised to UTC ``Z`` form, and an unset filter ABSENT from the forwarded
  query string;
* a value outside coord's vocabulary (including one bad member of a ``state``
  list), a naive timestamp, an over-bound limit and a malformed id stop at the
  web edge (422) and never reach coord;
* ``/spawns/stats`` is not swallowed by ``/spawns/{spawn_id}``;
* coord's 404 and a transport failure keep their meaning (404 passthrough,
  502, 504) — never a fabricated empty ledger;
* all three routes are gated on ``require_coord_tenant_admin`` and refuse a
  non-admin BEFORE any coord call.
"""

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID, uuid4

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

TEST_TENANT_ID = uuid4()
API_PREFIX = "/api/v1/operations"
LIST_ROUTE = f"{API_PREFIX}/spawns"
STATS_ROUTE = f"{API_PREFIX}/spawns/stats"
SPAWN_ID = "0b6f7f0e-2a59-4d3c-9b8e-5d1f2c3a4b5c"
DETAIL_ROUTE = f"{API_PREFIX}/spawns/{SPAWN_ID}"
DEVICE_ID = "6f1c2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f"

TEST_BEARER = "test-cognito-access-token"


def _build_test_app() -> FastAPI:
    from app.api.deps import get_current_active_user_async
    from app.api.v1.endpoints import operations as operations_module
    from app.api.v1.endpoints.operations import require_coord_tenant_admin
    from app.api.v1.endpoints.spawn_ledger import router as spawn_ledger_router

    test_app = FastAPI()
    mock_user = MagicMock()
    mock_user.id = uuid4()
    mock_user.email = "testuser@example.com"
    mock_user.is_active = True
    mock_user.is_verified = True
    test_app.dependency_overrides[get_current_active_user_async] = lambda: mock_user

    async def _tenant_override() -> UUID:
        # `async def` is load-bearing: `_tenant_headers` reads the bearer back
        # out of this ContextVar, and a sync override would set it in a worker
        # thread the endpoint never sees.
        operations_module._caller_bearer.set(TEST_BEARER)
        return TEST_TENANT_ID

    test_app.dependency_overrides[require_coord_tenant_admin] = _tenant_override
    test_app.include_router(spawn_ledger_router, prefix=API_PREFIX)
    return test_app


@pytest.fixture()
def auth_client() -> TestClient:
    return TestClient(_build_test_app())


def _mock_response(status_code: int = 200, json_data=None, text: str = "") -> MagicMock:
    resp = MagicMock(spec=httpx.Response)
    resp.status_code = status_code
    if json_data is None:
        resp.json.side_effect = ValueError("no json")
    else:
        resp.json.return_value = json_data
    resp.text = text or (str(json_data) if json_data is not None else "")
    return resp


def _patch_httpx():
    # `operations.httpx` IS the global `httpx` module, so this replaces
    # `httpx.AsyncClient` for `_proxy_coord_passthrough` wherever it is called.
    return patch("app.api.v1.endpoints.operations.httpx.AsyncClient")


def _client_returning(MockClient, response=None, side_effect=None) -> MagicMock:
    mock_instance = MagicMock()
    mock_instance.get = AsyncMock(return_value=response, side_effect=side_effect)
    mock_instance.__aenter__ = AsyncMock(return_value=mock_instance)
    mock_instance.__aexit__ = AsyncMock(return_value=False)
    MockClient.return_value = mock_instance
    return mock_instance


BACKFILLED_ROW = {
    "id": SPAWN_ID,
    "class": "continuation",
    "origin": "gate_continuation",
    "source_ref": "gate-7",
    "requested_at": "2026-10-21T01:00:00Z",
    "first_dispatched_at": None,
    "spawned_at": "2026-10-21T01:00:12Z",
    "updated_at": "2026-10-21T01:00:12Z",
    "state": "spawned",
    "attempts": 1,
    "deferrals": 0,
    "pinned_device_id": None,
    "preferred_device_id": None,
    "current_device_id": DEVICE_ID,
    "spawned_device_id": DEVICE_ID,
    "placement_basis": None,
    "lease_id": None,
    "claude_code_session_id": None,
    "claude_account": None,
    "session_outcome": None,
    "session_outcome_at": None,
    "terminal_reason": None,
    "history_complete": False,
    "wait_seconds": 12,
}

LIST_PAYLOAD = {
    "available": True,
    "items": [BACKFILLED_ROW],
    "shown": 1,
    "total": 1,
    "truncated": False,
    "next_cursor": None,
    "as_of": "2026-10-21T02:00:00Z",
}

STATS_PAYLOAD = {
    "available": True,
    "window": "7d",
    "window_start": "2026-10-14T02:00:00Z",
    "as_of": "2026-10-21T02:00:00Z",
    "overall": {
        "requested": 3,
        "terminal": 0,
        "spawned": 0,
        "failed": 0,
        "expired": 0,
        "cancelled": 0,
        "superseded": 0,
        "pending": {"queued": 3, "dispatched": 0, "deferred": 0},
        "started_share_bps": None,
        "wait_p50_secs": None,
        "wait_p90_secs": None,
        "first_attempt_share_bps": None,
        "requested_per_hour": 0.02,
        "started_per_hour": 0.0,
        "queued_now": 3,
        "finished": {"finished": 0, "working": 0, "closed_unfinished": 0, "unknown": 0},
        "history_partial_rows": 0,
    },
    "per_device": [
        {
            "device_id": DEVICE_ID,
            "placed": 0,
            "started": 0,
            "refused": 2,
            "deferred": 1,
            "wait_p50_secs": None,
        }
    ],
    "local_report_counts": None,
}

DETAIL_PAYLOAD = {
    "available": True,
    "request": BACKFILLED_ROW,
    "events": [
        {
            "at": "2026-10-21T01:00:00Z",
            "kind": "requested",
            "device_id": None,
            "reason": None,
            "detail": {},
        }
    ],
}

SCHEMA_MISSING = {"available": False, "reason": "schema_missing"}


class TestSpawnListProxy:
    def test_forwards_the_body_untouched(self, auth_client: TestClient):
        with _patch_httpx() as MockClient:
            _client_returning(MockClient, _mock_response(200, LIST_PAYLOAD))
            resp = auth_client.get(LIST_ROUTE)
        assert resp.status_code == 200
        assert resp.json() == LIST_PAYLOAD
        row = resp.json()["items"][0]
        assert row["history_complete"] is False
        assert row["session_outcome"] is None

    def test_schema_missing_stays_a_200_with_its_reason(self, auth_client: TestClient):
        with _patch_httpx() as MockClient:
            _client_returning(MockClient, _mock_response(200, SCHEMA_MISSING))
            resp = auth_client.get(LIST_ROUTE)
        assert resp.status_code == 200
        assert resp.json() == SCHEMA_MISSING

    def test_calls_the_coord_list_route_with_the_bearer_and_no_filters(
        self, auth_client: TestClient
    ):
        with _patch_httpx() as MockClient:
            mock = _client_returning(MockClient, _mock_response(200, LIST_PAYLOAD))
            auth_client.get(LIST_ROUTE)
        assert mock.get.call_args[0][0].endswith("/coord/spawns")
        assert mock.get.call_args.kwargs["headers"]["Authorization"] == (
            f"Bearer {TEST_BEARER}"
        )
        # No filter was asked for, so none goes on the wire — not even empty.
        assert mock.get.call_args.kwargs["params"] is None

    def test_every_filter_reaches_coord_under_coords_name(
        self, auth_client: TestClient
    ):
        with _patch_httpx() as MockClient:
            mock = _client_returning(MockClient, _mock_response(200, LIST_PAYLOAD))
            resp = auth_client.get(
                LIST_ROUTE,
                params={
                    "class": "continuation",
                    "state": "queued,dispatched,deferred",
                    "device": DEVICE_ID,
                    "since": "2026-10-14T04:00:00+02:00",
                    "until": "2026-10-21T02:00:00Z",
                    "order": "asc",
                    "cursor": "opaque-cursor",
                    "limit": 200,
                },
            )
        assert resp.status_code == 200
        assert mock.get.call_args.kwargs["params"] == {
            "class": "continuation",
            "state": "queued,dispatched,deferred",
            "device": DEVICE_ID,
            # Normalised to UTC: coord reads RFC 3339 `Z` timestamps.
            "since": "2026-10-14T02:00:00Z",
            "until": "2026-10-21T02:00:00Z",
            "order": "asc",
            "cursor": "opaque-cursor",
            "limit": 200,
        }

    @pytest.mark.parametrize(
        "params",
        [
            {"class": "interactive"},
            {"state": "running"},
            {"state": "queued,running"},
            {"state": "queued,"},
            {"state": ""},
            {"device": "not-a-uuid"},
            # A naive timestamp names no instant; coord would have to guess.
            {"since": "2026-10-14T02:00:00"},
            {"order": "oldest"},
            {"limit": 201},
            {"limit": 0},
        ],
    )
    def test_out_of_vocabulary_values_stop_at_the_web_edge(
        self, auth_client: TestClient, params: dict
    ):
        with _patch_httpx() as MockClient:
            mock = _client_returning(MockClient, _mock_response(200, LIST_PAYLOAD))
            resp = auth_client.get(LIST_ROUTE, params=params)
        assert resp.status_code == 422
        mock.get.assert_not_called()

    def test_route_not_deployed_404_keeps_its_status(self, auth_client: TestClient):
        """A coord predating the ledger routes answers 404. The page renders
        that as UNKNOWN, so the status must survive rather than become an
        empty list."""
        with _patch_httpx() as MockClient:
            _client_returning(MockClient, _mock_response(404, None, text=""))
            resp = auth_client.get(LIST_ROUTE)
        assert resp.status_code == 404
        assert resp.json() == {"error": "coord returned HTTP 404"}

    def test_coord_unreachable_is_a_502_not_an_empty_list(
        self, auth_client: TestClient
    ):
        with _patch_httpx() as MockClient:
            _client_returning(MockClient, side_effect=httpx.ConnectError("nope"))
            resp = auth_client.get(LIST_ROUTE)
        assert resp.status_code == 502
        assert "items" not in resp.json()

    def test_coord_timeout_is_a_504(self, auth_client: TestClient):
        with _patch_httpx() as MockClient:
            _client_returning(MockClient, side_effect=httpx.ReadTimeout("slow"))
            resp = auth_client.get(LIST_ROUTE)
        assert resp.status_code == 504


class TestSpawnStatsProxy:
    def test_forwards_null_aggregates_as_null(self, auth_client: TestClient):
        """`started_share_bps: null` (no terminal request) and a device with no
        wait sample are coord's UNKNOWN; neither may become 0 on the hop."""
        with _patch_httpx() as MockClient:
            mock = _client_returning(MockClient, _mock_response(200, STATS_PAYLOAD))
            resp = auth_client.get(STATS_ROUTE)
        assert resp.status_code == 200
        assert resp.json() == STATS_PAYLOAD
        assert resp.json()["overall"]["started_share_bps"] is None
        assert resp.json()["per_device"][0]["wait_p50_secs"] is None
        assert resp.json()["local_report_counts"] is None
        assert mock.get.call_args[0][0].endswith("/coord/spawns/stats")
        assert mock.get.call_args.kwargs["params"] is None

    def test_is_not_swallowed_by_the_id_route(self, auth_client: TestClient):
        with _patch_httpx() as MockClient:
            mock = _client_returning(MockClient, _mock_response(200, STATS_PAYLOAD))
            resp = auth_client.get(STATS_ROUTE, params={"window": "24h"})
        assert resp.status_code == 200
        assert mock.get.call_args[0][0].endswith("/coord/spawns/stats")
        assert mock.get.call_args.kwargs["params"] == {"window": "24h"}

    def test_unknown_window_stops_at_the_web_edge(self, auth_client: TestClient):
        with _patch_httpx() as MockClient:
            mock = _client_returning(MockClient, _mock_response(200, STATS_PAYLOAD))
            resp = auth_client.get(STATS_ROUTE, params={"window": "90d"})
        assert resp.status_code == 422
        mock.get.assert_not_called()

    def test_schema_missing_stays_a_200(self, auth_client: TestClient):
        with _patch_httpx() as MockClient:
            _client_returning(MockClient, _mock_response(200, SCHEMA_MISSING))
            resp = auth_client.get(STATS_ROUTE)
        assert resp.status_code == 200
        assert resp.json() == SCHEMA_MISSING


class TestSpawnDetailProxy:
    def test_forwards_the_request_and_its_timeline(self, auth_client: TestClient):
        with _patch_httpx() as MockClient:
            mock = _client_returning(MockClient, _mock_response(200, DETAIL_PAYLOAD))
            resp = auth_client.get(DETAIL_ROUTE)
        assert resp.status_code == 200
        assert resp.json() == DETAIL_PAYLOAD
        assert mock.get.call_args[0][0].endswith(f"/coord/spawns/{SPAWN_ID}")

    def test_not_found_keeps_coords_body(self, auth_client: TestClient):
        body = {"error": "spawn_not_found"}
        with _patch_httpx() as MockClient:
            _client_returning(MockClient, _mock_response(404, body))
            resp = auth_client.get(DETAIL_ROUTE)
        assert resp.status_code == 404
        assert resp.json() == body

    def test_malformed_id_never_reaches_coord(self, auth_client: TestClient):
        with _patch_httpx() as MockClient:
            mock = _client_returning(MockClient, _mock_response(200, DETAIL_PAYLOAD))
            resp = auth_client.get(f"{API_PREFIX}/spawns/not-a-uuid")
        assert resp.status_code == 422
        mock.get.assert_not_called()


class TestSpawnLedgerIsAdminGated:
    """Every other test overrides ``require_coord_tenant_admin`` to pass, so
    without these, swapping a route back to ``get_tenant_id`` would stay green:
    the deny override below would then gate nothing and coord would be called.
    """

    @pytest.mark.parametrize("route", [LIST_ROUTE, STATS_ROUTE, DETAIL_ROUTE])
    def test_non_admin_gets_403_before_any_coord_call(self, route: str):
        from fastapi import HTTPException

        from app.api.v1.endpoints.operations import require_coord_tenant_admin

        def _deny() -> None:
            raise HTTPException(status_code=403, detail="not_coord_tenant_admin")

        app = _build_test_app()
        app.dependency_overrides[require_coord_tenant_admin] = _deny
        with _patch_httpx() as MockClient:
            mock = _client_returning(MockClient, _mock_response(200, LIST_PAYLOAD))
            resp = TestClient(app).get(route)

        assert resp.status_code == 403
        mock.get.assert_not_called()
