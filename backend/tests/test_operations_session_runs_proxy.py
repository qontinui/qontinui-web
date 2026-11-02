"""Integration tests for the session-load proxies.

``GET /api/v1/operations/session-runs``, ``/session-runs/stats``,
``/session-runs/concurrency`` and ``/session-runs/growth`` proxy coord's
``GET /coord/session-runs…`` reads so ``/admin/coord/session-load`` can render
without the browser calling coord. Plan
``2026-10-23-session-duration-by-work-type-and-per-device-session-load``
Phase 5. Same harness as ``test_operations_spawn_ledger_proxy.py``: a minimal
FastAPI app and a mocked ``httpx.AsyncClient``, so no live coord is needed.

Properties pinned:

* the body passes through UNTOUCHED — a ``null`` percentile, a ``{state:
  "none"}`` budget and a ``null`` ``recording_since`` reach the page as coord
  wrote them;
* coord's ``503 {"error": "schema_missing"}`` stays a 503 with that body, so
  the page can say the run record is not deployed rather than draw an empty
  fleet;
* the operator bearer is forwarded (never an anonymous coord call);
* every declared filter reaches coord under coord's own name, timestamps
  normalised to UTC ``Z`` form, and an unset filter ABSENT from the forwarded
  query string;
* a value outside coord's grammar (a window, a bucket, a ``group_by``, an
  initiator, a malformed work type or device, a naive timestamp, an
  over-bound limit) stops at the web edge (422) and never reaches coord;
* coord's 404 and 400 keep their status and body; a transport failure is a
  502/504 — never a fabricated empty answer;
* all four routes are gated on ``require_coord_tenant_admin`` and refuse a
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
LIST_ROUTE = f"{API_PREFIX}/session-runs"
STATS_ROUTE = f"{API_PREFIX}/session-runs/stats"
CONCURRENCY_ROUTE = f"{API_PREFIX}/session-runs/concurrency"
GROWTH_ROUTE = f"{API_PREFIX}/session-runs/growth"
ALL_ROUTES = [LIST_ROUTE, STATS_ROUTE, CONCURRENCY_ROUTE, GROWTH_ROUTE]
DEVICE_ID = "6f1c2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f"
RUN_ID = "0b6f7f0e-2a59-4d3c-9b8e-5d1f2c3a4b5c"

TEST_BEARER = "test-cognito-access-token"


def _build_test_app() -> FastAPI:
    from app.api.deps import get_current_active_user_async
    from app.api.v1.endpoints import operations as operations_module
    from app.api.v1.endpoints.operations import require_coord_tenant_admin
    from app.api.v1.endpoints.session_runs import router as session_runs_router

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
    test_app.include_router(session_runs_router, prefix=API_PREFIX)
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


OPEN_RUN = {
    "id": RUN_ID,
    "device_id": DEVICE_ID,
    "claude_code_session_id": "1d2c3b4a-0000-4000-8000-000000000001",
    "run_seq": 0,
    "initiator": "coord",
    "work_type": "post_merge",
    "classifier_version": 1,
    "skill": None,
    "first_command": None,
    "spawn_origin": "gate_continuation",
    "gate_id": "2d2c3b4a-0000-4000-8000-000000000002",
    "spawn_request_id": None,
    "started_at": "2026-10-26T01:00:00Z",
    "finished_at": None,
    "ended_at": None,
    "wall_seconds": None,
    "held_after_finish_seconds": None,
    "end_reason": None,
    "end_source": None,
    "history_complete": False,
}

LIST_PAYLOAD = {
    "runs": [OPEN_RUN],
    "shown": 1,
    "total": 1,
    "truncated": False,
    "next_cursor": None,
    "as_of": "2026-10-26T02:00:00Z",
}

STATS_PAYLOAD = {
    "window_seconds": 604800,
    "since": "2026-10-19T02:00:00Z",
    "group_by": "work_type",
    "population": "runs started in the window",
    "classifier_version": 1,
    "groups": [
        {
            "work_type": "post_merge",
            "work_type_description": "A session continued from a gate…",
            "runs": 1,
            "open_now": 1,
            "wall_seconds": {
                "p50": None,
                "p90": None,
                "p99": None,
                "sum": None,
                "samples": 0,
                "excludes": "inferred ends and open runs",
            },
            "slot_hours": 1.0,
            "active_seconds": {"p50": None, "samples": 0},
            "held_after_finish_seconds": {"sum": None, "samples": 0},
            "inferred_count": 0,
            "reconciled_count": 0,
            "unknown_count": 0,
        }
    ],
    "as_of": "2026-10-26T02:00:00Z",
}

CONCURRENCY_PAYLOAD = {
    "window_seconds": 604800,
    "bucket_seconds": 3600,
    "since": "2026-10-19T02:00:00Z",
    "raw_from": "2026-10-19T02:00:00Z",
    "grid": "open runs at each whole minute",
    "devices": [
        {
            "device_id": DEVICE_ID,
            "name": None,
            "budget": {
                "state": "none",
                "value": None,
                "label": "configured session budget",
            },
            "last_heartbeat": None,
            "heartbeat_age_seconds": None,
            "known_device": False,
            "open_now": 1,
            "peak": 1,
            "p95": 1,
            "p95_scope": "whole window",
            "series": [],
        }
    ],
    "truncated": False,
    "as_of": "2026-10-26T02:00:00Z",
}

GROWTH_PAYLOAD = {
    "window_seconds": 7776000,
    "bucket_seconds": 86400,
    "since": "2026-07-28T00:00:00Z",
    "raw_from": "2026-09-25T02:00:00Z",
    "recording_since": None,
    "devices_recording": [],
    "series": [],
    "fleet": {
        # coord's real shape for a fleet with no published non-zero budget:
        # the figure is null (never 0) and available_state says why.
        "available_slot_hours_per_day": None,
        "available_slot_hours_per_bucket": None,
        "available_state": "no_budget_published",
        "definition": "sum of published non-zero configured session budgets x 24",
        "devices_with_budget": 0,
        "devices_zero_budget": 0,
        "devices_without_budget": 1,
    },
    "truncated": False,
    "as_of": "2026-10-26T02:00:00Z",
}

SCHEMA_MISSING = {
    "error": "schema_missing",
    "degraded": True,
    "relation": "coord.session_runs",
    "relations": ["coord.session_runs", "coord.session_run_hourly"],
    "route": "GET /coord/session-runs",
    "detail": "coord.session_runs / coord.session_run_hourly are not provisioned",
}

PAYLOADS = {
    LIST_ROUTE: LIST_PAYLOAD,
    STATS_ROUTE: STATS_PAYLOAD,
    CONCURRENCY_ROUTE: CONCURRENCY_PAYLOAD,
    GROWTH_ROUTE: GROWTH_PAYLOAD,
}

COORD_PATHS = {
    LIST_ROUTE: "/coord/session-runs",
    STATS_ROUTE: "/coord/session-runs/stats",
    CONCURRENCY_ROUTE: "/coord/session-runs/concurrency",
    GROWTH_ROUTE: "/coord/session-runs/growth",
}


class TestEveryRoute:
    @pytest.mark.parametrize("route", ALL_ROUTES)
    def test_forwards_the_body_untouched_to_the_matching_coord_path(
        self, auth_client: TestClient, route: str
    ):
        with _patch_httpx() as MockClient:
            mock = _client_returning(MockClient, _mock_response(200, PAYLOADS[route]))
            resp = auth_client.get(route)
        assert resp.status_code == 200
        assert resp.json() == PAYLOADS[route]
        assert mock.get.call_args[0][0].endswith(COORD_PATHS[route])
        assert mock.get.call_args.kwargs["headers"]["Authorization"] == (
            f"Bearer {TEST_BEARER}"
        )
        # No filter was asked for, so none goes on the wire — not even empty.
        assert mock.get.call_args.kwargs["params"] is None

    @pytest.mark.parametrize("route", ALL_ROUTES)
    def test_schema_missing_stays_a_503_with_coords_body(
        self, auth_client: TestClient, route: str
    ):
        with _patch_httpx() as MockClient:
            _client_returning(MockClient, _mock_response(503, SCHEMA_MISSING))
            resp = auth_client.get(route)
        assert resp.status_code == 503
        assert resp.json() == SCHEMA_MISSING

    @pytest.mark.parametrize("route", ALL_ROUTES)
    def test_route_not_deployed_404_keeps_its_status(
        self, auth_client: TestClient, route: str
    ):
        """A coord predating the run-record routes answers 404. The page renders
        that as UNKNOWN, so the status must survive rather than become an empty
        answer."""
        with _patch_httpx() as MockClient:
            _client_returning(MockClient, _mock_response(404, None, text=""))
            resp = auth_client.get(route)
        assert resp.status_code == 404
        assert resp.json() == {"error": "coord returned HTTP 404"}

    @pytest.mark.parametrize("route", ALL_ROUTES)
    def test_coord_unreachable_is_a_502_not_an_empty_answer(
        self, auth_client: TestClient, route: str
    ):
        with _patch_httpx() as MockClient:
            _client_returning(MockClient, side_effect=httpx.ConnectError("nope"))
            resp = auth_client.get(route)
        assert resp.status_code == 502
        body = resp.json()
        for key in ("runs", "groups", "devices", "series"):
            assert key not in body

    @pytest.mark.parametrize("route", ALL_ROUTES)
    def test_coord_timeout_is_a_504(self, auth_client: TestClient, route: str):
        with _patch_httpx() as MockClient:
            _client_returning(MockClient, side_effect=httpx.ReadTimeout("slow"))
            resp = auth_client.get(route)
        assert resp.status_code == 504


class TestSessionRunListProxy:
    def test_open_run_nulls_pass_through_as_null(self, auth_client: TestClient):
        with _patch_httpx() as MockClient:
            _client_returning(MockClient, _mock_response(200, LIST_PAYLOAD))
            resp = auth_client.get(LIST_ROUTE)
        run = resp.json()["runs"][0]
        assert run["wall_seconds"] is None
        assert run["ended_at"] is None
        assert run["history_complete"] is False

    def test_every_filter_reaches_coord_under_coords_name(
        self, auth_client: TestClient
    ):
        with _patch_httpx() as MockClient:
            mock = _client_returning(MockClient, _mock_response(200, LIST_PAYLOAD))
            resp = auth_client.get(
                LIST_ROUTE,
                params={
                    "work_type": "post_merge",
                    "device": DEVICE_ID,
                    "initiator": "runner_local",
                    "since": "2026-10-19T04:00:00+02:00",
                    "until": "2026-10-26T02:00:00Z",
                    "cursor": "2026-10-26T01:00:00.000000Z~" + RUN_ID,
                    "limit": 500,
                },
            )
        assert resp.status_code == 200
        assert mock.get.call_args.kwargs["params"] == {
            "work_type": "post_merge",
            "device": DEVICE_ID,
            "initiator": "runner_local",
            # Normalised to UTC: coord reads RFC 3339 `Z` timestamps.
            "since": "2026-10-19T02:00:00Z",
            "until": "2026-10-26T02:00:00Z",
            "cursor": "2026-10-26T01:00:00.000000Z~" + RUN_ID,
            "limit": 500,
        }

    def test_a_work_type_this_build_has_not_heard_of_still_filters(
        self, auth_client: TestClient
    ):
        """The vocabulary grows with coord's classifier; the edge checks shape."""
        with _patch_httpx() as MockClient:
            mock = _client_returning(MockClient, _mock_response(200, LIST_PAYLOAD))
            resp = auth_client.get(LIST_ROUTE, params={"work_type": "brand_new_type"})
        assert resp.status_code == 200
        assert mock.get.call_args.kwargs["params"] == {"work_type": "brand_new_type"}

    @pytest.mark.parametrize(
        "params",
        [
            {"work_type": "Post-Merge"},
            {"work_type": ""},
            {"initiator": "human"},
            {"device": "not-a-uuid"},
            # A naive timestamp names no instant; coord would have to guess.
            {"since": "2026-10-19T02:00:00"},
            {"limit": 501},
            {"limit": 0},
        ],
    )
    def test_out_of_grammar_values_stop_at_the_web_edge(
        self, auth_client: TestClient, params: dict
    ):
        with _patch_httpx() as MockClient:
            mock = _client_returning(MockClient, _mock_response(200, LIST_PAYLOAD))
            resp = auth_client.get(LIST_ROUTE, params=params)
        assert resp.status_code == 422
        mock.get.assert_not_called()


class TestSessionRunStatsProxy:
    def test_null_percentiles_stay_null(self, auth_client: TestClient):
        """A group with no observed end has no wall-time percentile — coord's
        UNKNOWN, which must not become 0 on the hop."""
        with _patch_httpx() as MockClient:
            _client_returning(MockClient, _mock_response(200, STATS_PAYLOAD))
            resp = auth_client.get(STATS_ROUTE)
        group = resp.json()["groups"][0]
        assert group["wall_seconds"]["p50"] is None
        assert group["held_after_finish_seconds"]["sum"] is None

    def test_window_and_group_by_reach_coord(self, auth_client: TestClient):
        with _patch_httpx() as MockClient:
            mock = _client_returning(MockClient, _mock_response(200, STATS_PAYLOAD))
            resp = auth_client.get(
                STATS_ROUTE, params={"window": "30d", "group_by": "device,work_type"}
            )
        assert resp.status_code == 200
        assert mock.get.call_args.kwargs["params"] == {
            "window": "30d",
            "group_by": "device,work_type",
        }

    def test_coords_400_keeps_its_body(self, auth_client: TestClient):
        """A window this edge accepts but coord bounds (past 400 days) is coord's
        typed refusal, passed through — not a generic failure."""
        body = {
            "error": "invalid_query_parameter",
            "field": "window",
            "reason": "must be 1h..=400d",
            "route": "GET /coord/session-runs/stats",
        }
        with _patch_httpx() as MockClient:
            _client_returning(MockClient, _mock_response(400, body))
            resp = auth_client.get(STATS_ROUTE, params={"window": "999d"})
        assert resp.status_code == 400
        assert resp.json() == body

    @pytest.mark.parametrize(
        "params",
        [
            {"window": "7w"},
            {"window": "0d"},
            {"window": "d"},
            {"window": "7 d"},
            {"group_by": "repo"},
        ],
    )
    def test_out_of_grammar_values_stop_at_the_web_edge(
        self, auth_client: TestClient, params: dict
    ):
        with _patch_httpx() as MockClient:
            mock = _client_returning(MockClient, _mock_response(200, STATS_PAYLOAD))
            resp = auth_client.get(STATS_ROUTE, params=params)
        assert resp.status_code == 422
        mock.get.assert_not_called()


class TestSessionRunConcurrencyProxy:
    def test_an_unpublished_budget_passes_through_as_none(
        self, auth_client: TestClient
    ):
        with _patch_httpx() as MockClient:
            _client_returning(MockClient, _mock_response(200, CONCURRENCY_PAYLOAD))
            resp = auth_client.get(CONCURRENCY_ROUTE)
        device = resp.json()["devices"][0]
        assert device["budget"] == {
            "state": "none",
            "value": None,
            "label": "configured session budget",
        }
        assert device["heartbeat_age_seconds"] is None

    def test_device_window_and_bucket_reach_coord(self, auth_client: TestClient):
        with _patch_httpx() as MockClient:
            mock = _client_returning(
                MockClient, _mock_response(200, CONCURRENCY_PAYLOAD)
            )
            resp = auth_client.get(
                CONCURRENCY_ROUTE,
                params={"device": DEVICE_ID, "window": "24h", "bucket": "15m"},
            )
        assert resp.status_code == 200
        assert mock.get.call_args.kwargs["params"] == {
            "device": DEVICE_ID,
            "window": "24h",
            "bucket": "15m",
        }

    @pytest.mark.parametrize(
        "params",
        [{"bucket": "2m"}, {"bucket": "month"}, {"device": "x"}, {"window": "1y"}],
    )
    def test_out_of_grammar_values_stop_at_the_web_edge(
        self, auth_client: TestClient, params: dict
    ):
        with _patch_httpx() as MockClient:
            mock = _client_returning(
                MockClient, _mock_response(200, CONCURRENCY_PAYLOAD)
            )
            resp = auth_client.get(CONCURRENCY_ROUTE, params=params)
        assert resp.status_code == 422
        mock.get.assert_not_called()


class TestSessionRunGrowthProxy:
    def test_an_unrecorded_history_passes_through_as_null(
        self, auth_client: TestClient
    ):
        with _patch_httpx() as MockClient:
            _client_returning(MockClient, _mock_response(200, GROWTH_PAYLOAD))
            resp = auth_client.get(GROWTH_ROUTE)
        assert resp.json()["recording_since"] is None
        assert resp.json()["devices_recording"] == []

    def test_a_no_budget_fleet_keeps_its_null_figure_and_state(
        self, auth_client: TestClient
    ):
        """No published budget is coord's ``null`` + ``available_state`` — it
        must not become an available capacity of 0 on the hop."""
        with _patch_httpx() as MockClient:
            _client_returning(MockClient, _mock_response(200, GROWTH_PAYLOAD))
            resp = auth_client.get(GROWTH_ROUTE)
        fleet = resp.json()["fleet"]
        assert fleet["available_slot_hours_per_day"] is None
        assert fleet["available_slot_hours_per_bucket"] is None
        assert fleet["available_state"] == "no_budget_published"

    def test_window_and_bucket_reach_coord(self, auth_client: TestClient):
        with _patch_httpx() as MockClient:
            mock = _client_returning(MockClient, _mock_response(200, GROWTH_PAYLOAD))
            resp = auth_client.get(
                GROWTH_ROUTE, params={"window": "90d", "bucket": "day"}
            )
        assert resp.status_code == 200
        assert mock.get.call_args.kwargs["params"] == {"window": "90d", "bucket": "day"}

    @pytest.mark.parametrize(
        "params", [{"bucket": "1h"}, {"bucket": "15m"}, {"window": "-1d"}]
    )
    def test_sub_day_buckets_stop_at_the_web_edge(
        self, auth_client: TestClient, params: dict
    ):
        with _patch_httpx() as MockClient:
            mock = _client_returning(MockClient, _mock_response(200, GROWTH_PAYLOAD))
            resp = auth_client.get(GROWTH_ROUTE, params=params)
        assert resp.status_code == 422
        mock.get.assert_not_called()


class TestSessionLoadIsAdminGated:
    """Every other test overrides ``require_coord_tenant_admin`` to pass, so
    without these, swapping a route back to ``get_tenant_id`` would stay green:
    the deny override below would then gate nothing and coord would be called.
    """

    @pytest.mark.parametrize("route", ALL_ROUTES)
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
