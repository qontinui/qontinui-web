"""Integration tests for the overlord pass-ledger read proxies.

``GET /api/v1/operations/coord/overlord/flow``,
``GET /api/v1/operations/coord/overlord/passes`` and
``GET /api/v1/operations/coord/overlord/passes/{pass_id}`` proxy coord's reads
over ``coord.overlord_passes`` / ``coord.overlord_pass_rows`` so the
``/admin/coord/overlord/flow`` page can render without the browser calling
coord cross-origin.

Plan ``2026-10-23-the-overlord-keeps-no-record-of-session-flow-so-its-
development-runs-on-anecdote`` Phase 4.

Mirrors ``test_operations_operator_touches_proxy.py``: a minimal FastAPI app +
a mocked ``httpx.AsyncClient``, so no live coord is needed. The properties
under test:

* the payload is passed through UNTOUCHED — including the ``null`` medians and
  rates coord sends when nothing was measurable, which the page renders as
  "no data" and never as a zero;
* every contract query parameter reaches coord explicitly and unchanged, an
  unset one does not reach it at all, and one the contract does not name is
  dropped;
* there is no edge 422 on a query VALUE: coord validates its own bounds, and
  its typed 422 / 503 ``schema_migration_pending`` / 404 bodies reach the
  browser VERBATIM;
* ``pass_id`` — the one input spliced into a URL path — is validated as a
  UUID before coord is called, and forwarded in canonical form;
* the operator bearer is forwarded and a transport failure is a 502/504, never
  a fabricated empty ledger.
"""

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID, uuid4

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

TEST_TENANT_ID = uuid4()
API_PREFIX = "/api/v1/operations"
FLOW_ROUTE = f"{API_PREFIX}/coord/overlord/flow"
PASSES_ROUTE = f"{API_PREFIX}/coord/overlord/passes"

TEST_BEARER = "test-cognito-access-token"


def _build_test_app() -> FastAPI:
    from app.api.deps import get_current_active_user_async
    from app.api.v1.endpoints import operations as operations_module
    from app.api.v1.endpoints.operations import get_tenant_id
    from app.api.v1.endpoints.operations import router as operations_router

    test_app = FastAPI()
    mock_user = MagicMock()
    mock_user.id = uuid4()
    mock_user.email = "testuser@example.com"
    mock_user.is_active = True
    mock_user.is_verified = True
    test_app.dependency_overrides[get_current_active_user_async] = lambda: mock_user

    async def _tenant_override() -> UUID:
        # `async def` is load-bearing: a sync override runs in a worker thread
        # whose ContextVar write never reaches the request task, so the bearer
        # `_tenant_headers` reads back would be unset.
        operations_module._caller_bearer.set(TEST_BEARER)
        return TEST_TENANT_ID

    test_app.dependency_overrides[get_tenant_id] = _tenant_override
    test_app.include_router(operations_router, prefix="/api/v1/operations")
    return test_app


@pytest.fixture()
def auth_client() -> TestClient:
    return TestClient(_build_test_app())


def _mock_response(status_code: int = 200, json_data=None) -> MagicMock:
    resp = MagicMock(spec=httpx.Response)
    resp.status_code = status_code
    resp.json.return_value = json_data
    resp.text = str(json_data) if json_data is not None else ""
    return resp


def _get(auth_client: TestClient, url: str, resp: MagicMock | None = None, **kw):
    with patch("app.api.v1.endpoints.operations.httpx.AsyncClient") as MockClient:
        mock_instance = MagicMock()
        if "side_effect" in kw:
            mock_instance.get = AsyncMock(side_effect=kw["side_effect"])
        else:
            mock_instance.get = AsyncMock(return_value=resp)
        mock_instance.__aenter__ = AsyncMock(return_value=mock_instance)
        mock_instance.__aexit__ = AsyncMock(return_value=False)
        MockClient.return_value = mock_instance
        out = auth_client.get(url)
    return out, mock_instance


PASS_ID = str(uuid4())
SESSION_ID = str(uuid4())

FLOW = {
    "ok": True,
    "window": {"since": "2026-10-17T00:00:00Z", "until": "2026-10-24T00:00:00Z"},
    "truncated": False,
    "passes_considered": 12,
    "full_passes_considered": 9,
    "time_to_close": {
        "count": 4,
        "median_secs": 5400,
        "p90_secs": 20000,
        "closed_by": {"triage": 3, "absent": 1},
        "sessions": [
            {
                "key": SESSION_ID,
                "first_stopped_at": "2026-10-20T10:00:00Z",
                "closed_at": "2026-10-20T11:30:00Z",
                "secs": 5400,
                "closed_by": "triage",
            }
        ],
    },
    "nudge": {
        "nudged": 10,
        "progressed": 4,
        "finished": 2,
        "progress_rate": 0.4,
        "finish_rate": 0.2,
        "unmeasured_progress": 3,
    },
    "unchanged": [
        {
            "key": SESSION_ID,
            "claude_session_id": SESSION_ID,
            "terminal_id": "term-7",
            "session_name": "1234 fix the thing",
            "verdict": "STOPPED",
            "reason_codes": ["stopped.no_progress"],
            "consecutive_full_passes": 3,
            "first_seen_at": "2026-10-23T08:00:00Z",
            "last_seen_at": "2026-10-23T20:00:00Z",
        }
    ],
    "unknown_share": [
        {
            "pass_id": PASS_ID,
            "started_at": "2026-10-23T20:00:00Z",
            "rows": 40,
            "unknown_rows": 2,
            "share": 0.05,
        }
    ],
    "verdict_series": [
        {
            "pass_id": PASS_ID,
            "started_at": "2026-10-23T20:00:00Z",
            "scope": "full",
            "mode": "report",
            "histogram": {"STOPPED": 3, "BUSY": 9},
        }
    ],
}

# An empty window: coord says "not measurable" with nulls, never zeros.
EMPTY_FLOW = {
    "ok": True,
    "window": {"since": "2026-10-23T00:00:00Z", "until": "2026-10-24T00:00:00Z"},
    "truncated": False,
    "passes_considered": 0,
    "full_passes_considered": 0,
    "time_to_close": {
        "count": 0,
        "median_secs": None,
        "p90_secs": None,
        "closed_by": {},
        "sessions": [],
    },
    "nudge": {
        "nudged": 0,
        "progressed": 0,
        "finished": 0,
        "progress_rate": None,
        "finish_rate": None,
        "unmeasured_progress": 0,
    },
    "unchanged": [],
    "unknown_share": [],
    "verdict_series": [],
}

PASS_ROW: dict[str, Any] = {
    "pass_id": PASS_ID,
    "device_id": str(uuid4()),
    "runner_port": 9876,
    "runner_build": None,
    "scope": "full",
    "filter": {},
    "mode": "report",
    "skipped_steps": ["layout"],
    "started_at": "2026-10-23T20:00:00Z",
    "ended_at": None,
    "recorded_at": "2026-10-23T20:01:00Z",
    "exit_code": None,
    "step_counts": {},
    "verdict_histogram": {"STOPPED": 3},
    "overlord_versions": {},
    "row_count": 3,
}

PASS_LIST = {
    "ok": True,
    "passes": [
        PASS_ROW,
    ],
    "total_matching": 1,
    "truncated": False,
    "limit": 50,
    "offset": 0,
}


class TestOverlordFlowProxy:
    def test_flow_passes_through_untouched(self, auth_client: TestClient):
        resp, mock_instance = _get(auth_client, FLOW_ROUTE, _mock_response(200, FLOW))
        assert resp.status_code == 200
        assert resp.json() == FLOW
        assert mock_instance.get.call_args[0][0].endswith("/coord/overlord/flow")

    def test_null_metrics_reach_the_page_as_null(self, auth_client: TestClient):
        """A proxy that defaulted these would turn "no data" into a healthy 0."""
        resp, _ = _get(auth_client, FLOW_ROUTE, _mock_response(200, EMPTY_FLOW))
        body = resp.json()
        assert body["time_to_close"]["median_secs"] is None
        assert body["time_to_close"]["p90_secs"] is None
        assert body["nudge"]["progress_rate"] is None
        assert body["nudge"]["finish_rate"] is None

    def test_every_set_query_param_is_forwarded_unchanged(
        self, auth_client: TestClient
    ):
        device = str(uuid4())
        url = (
            f"{FLOW_ROUTE}?window_hours=720&device_id={device}&runner_port=9876"
            "&unchanged_min_passes=4&nudge_window_passes=2"
            "&group_by=overlord_version"
        )
        _, mock_instance = _get(auth_client, url, _mock_response(200, FLOW))
        assert mock_instance.get.call_args.kwargs["params"] == {
            "window_hours": "720",
            "device_id": device,
            "runner_port": "9876",
            "unchanged_min_passes": "4",
            "nudge_window_passes": "2",
            "group_by": "overlord_version",
        }

    def test_no_query_sends_no_params(self, auth_client: TestClient):
        """An unset parameter must be ABSENT on the wire, not an empty value."""
        _, mock_instance = _get(auth_client, FLOW_ROUTE, _mock_response(200, FLOW))
        assert mock_instance.get.call_args.kwargs["params"] is None

    def test_an_empty_value_is_not_forwarded(self, auth_client: TestClient):
        _, mock_instance = _get(
            auth_client,
            f"{FLOW_ROUTE}?window_hours=&group_by=",
            _mock_response(200, FLOW),
        )
        assert mock_instance.get.call_args.kwargs["params"] is None

    def test_a_param_the_contract_does_not_name_is_dropped(
        self, auth_client: TestClient
    ):
        _, mock_instance = _get(
            auth_client,
            f"{FLOW_ROUTE}?window_hours=24&tenant_id={uuid4()}&rows=all",
            _mock_response(200, FLOW),
        )
        assert mock_instance.get.call_args.kwargs["params"] == {"window_hours": "24"}

    @pytest.mark.parametrize(
        "query",
        [
            "window_hours=99999",
            "window_hours=abc",
            "unchanged_min_passes=1",
            "group_by=account",
        ],
    )
    def test_a_bad_value_reaches_coord_and_its_422_is_verbatim(
        self, auth_client: TestClient, query: str
    ):
        """No edge 422 on a query value: coord owns the bounds, and its typed
        refusal naming the field is what the page must show."""
        key, value = query.split("=")
        body = {
            "error": "invalid_overlord_flow_query",
            "field": key,
            "detail": f"{key}: {value} is out of range",
        }
        resp, mock_instance = _get(
            auth_client, f"{FLOW_ROUTE}?{query}", _mock_response(422, body)
        )
        assert resp.status_code == 422
        assert resp.json() == body
        assert mock_instance.get.call_args.kwargs["params"] == {key: value}

    def test_schema_migration_pending_503_is_verbatim(self, auth_client: TestClient):
        """The page branches on ``error`` to say UNKNOWN — a re-wrapped
        envelope would destroy that."""
        body = {
            "error": "schema_migration_pending",
            "detail": "coord.overlord_passes is not provisioned (42P01)",
        }
        resp, _ = _get(auth_client, FLOW_ROUTE, _mock_response(503, body))
        assert resp.status_code == 503
        assert resp.json() == body

    def test_a_non_json_coord_error_keeps_coords_status(self, auth_client: TestClient):
        with patch("app.api.v1.endpoints.operations.httpx.AsyncClient") as MockClient:
            mock_instance = MagicMock()
            resp_mock = MagicMock(spec=httpx.Response)
            resp_mock.status_code = 400
            resp_mock.json.side_effect = ValueError("not json")
            resp_mock.text = "Failed to deserialize query string"
            mock_instance.get = AsyncMock(return_value=resp_mock)
            mock_instance.__aenter__ = AsyncMock(return_value=mock_instance)
            mock_instance.__aexit__ = AsyncMock(return_value=False)
            MockClient.return_value = mock_instance
            resp = auth_client.get(f"{FLOW_ROUTE}?runner_port=x")
        assert resp.status_code == 400
        assert resp.json() == {"error": "Failed to deserialize query string"}

    def test_forwards_the_operator_bearer(self, auth_client: TestClient):
        _, mock_instance = _get(auth_client, FLOW_ROUTE, _mock_response(200, FLOW))
        headers = mock_instance.get.call_args.kwargs["headers"]
        assert headers["Authorization"] == f"Bearer {TEST_BEARER}"

    def test_coord_unreachable_is_a_502_not_an_empty_ledger(
        self, auth_client: TestClient
    ):
        resp, _ = _get(auth_client, FLOW_ROUTE, side_effect=httpx.ConnectError("x"))
        assert resp.status_code == 502

    def test_coord_timeout_is_a_504(self, auth_client: TestClient):
        resp, _ = _get(auth_client, FLOW_ROUTE, side_effect=httpx.ReadTimeout("x"))
        assert resp.status_code == 504


class TestOverlordPassesProxy:
    def test_list_passes_through_untouched(self, auth_client: TestClient):
        resp, mock_instance = _get(
            auth_client, PASSES_ROUTE, _mock_response(200, PASS_LIST)
        )
        assert resp.status_code == 200
        assert resp.json() == PASS_LIST
        assert mock_instance.get.call_args[0][0].endswith("/coord/overlord/passes")
        assert mock_instance.get.call_args.kwargs["params"] is None

    def test_every_list_filter_is_forwarded_unchanged(self, auth_client: TestClient):
        device = str(uuid4())
        url = (
            f"{PASSES_ROUTE}?device_id={device}&runner_port=9876&scope=full"
            "&mode=act&since=2026-10-20T00:00:00Z&limit=200&offset=0"
        )
        _, mock_instance = _get(auth_client, url, _mock_response(200, PASS_LIST))
        assert mock_instance.get.call_args.kwargs["params"] == {
            "device_id": device,
            "runner_port": "9876",
            "scope": "full",
            "mode": "act",
            "since": "2026-10-20T00:00:00Z",
            "limit": "200",
            "offset": "0",
        }

    def test_a_bad_filter_value_reaches_coord_and_its_422_is_verbatim(
        self, auth_client: TestClient
    ):
        body = {
            "error": "invalid_overlord_pass_query",
            "field": "scope",
            "accepted": ["full", "filtered"],
        }
        resp, mock_instance = _get(
            auth_client, f"{PASSES_ROUTE}?scope=partial", _mock_response(422, body)
        )
        assert resp.status_code == 422
        assert resp.json() == body
        assert mock_instance.get.call_args.kwargs["params"] == {"scope": "partial"}

    def test_by_id_forwards_the_canonical_uuid(self, auth_client: TestClient):
        upper = PASS_ID.upper()
        body = {"ok": True, "pass": {**PASS_ROW, "rows": []}}
        resp, mock_instance = _get(
            auth_client, f"{PASSES_ROUTE}/{upper}", _mock_response(200, body)
        )
        assert resp.status_code == 200
        assert resp.json() == body
        assert mock_instance.get.call_args[0][0].endswith(
            f"/coord/overlord/passes/{PASS_ID}"
        )

    def test_by_id_not_found_404_is_verbatim(self, auth_client: TestClient):
        body = {"error": "pass_not_found"}
        resp, _ = _get(
            auth_client, f"{PASSES_ROUTE}/{PASS_ID}", _mock_response(404, body)
        )
        assert resp.status_code == 404
        assert resp.json() == body

    def test_by_id_schema_migration_pending_503_is_verbatim(
        self, auth_client: TestClient
    ):
        body = {"error": "schema_migration_pending", "detail": "42P01"}
        resp, _ = _get(
            auth_client, f"{PASSES_ROUTE}/{PASS_ID}", _mock_response(503, body)
        )
        assert resp.status_code == 503
        assert resp.json() == body

    @pytest.mark.parametrize("bad", ["not-a-uuid", "..", "%2E%2E", "1234"])
    def test_a_malformed_pass_id_never_reaches_coord(
        self, auth_client: TestClient, bad: str
    ):
        """``pass_id`` is spliced into the coord URL PATH, so anything but a
        UUID is refused at this edge — coord is never called with it."""
        resp, mock_instance = _get(
            auth_client, f"{PASSES_ROUTE}/{bad}", _mock_response(200, {"ok": True})
        )
        assert resp.status_code in (404, 422)
        mock_instance.get.assert_not_called()
