"""Integration tests for the operator-touch read proxies.

``GET /api/v1/operations/coord/operator-touches`` and
``GET /api/v1/operations/coord/operator-touches/constraint-verdict`` proxy
coord's first read doors over ``coord.operator_touches`` so the
``/admin/coord/operator-touches`` page can render without the browser
calling coord cross-origin.

Plan ``2026-08-27-operator-touch-read-and-surface`` Phase C3 (C3a item 3).

Mirrors ``test_operations_fleet_worktree_slots_proxy.py``: a minimal FastAPI
app + a mocked ``httpx.AsyncClient``, so no live coord is needed. The
properties under test:

* the payload is passed through UNTOUCHED — including a ``not_yet_measured``
  store's null rates, which the page renders as "Not yet measured" and never
  as a zero, and a ``before`` page's ``aggregate_included: false``;
* every query parameter reaches coord explicitly, and an unset one does not
  reach it at all;
* coord's typed 400/503 bodies reach the browser VERBATIM — the page branches
  on ``error`` to say "unknown", which a re-wrapped envelope would destroy;
* the operator bearer is forwarded and a transport failure is a 502/504,
  never a fabricated empty store.
"""

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID, uuid4

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

TEST_TENANT_ID = uuid4()
API_PREFIX = "/api/v1/operations"
TOUCHES_ROUTE = f"{API_PREFIX}/coord/operator-touches"
VERDICT_ROUTE = f"{API_PREFIX}/coord/operator-touches/constraint-verdict"

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
        # `_tenant_headers` reads back would be unset (see the worktree-slots
        # proxy test's note).
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


VERDICT = {
    "verdict": "unknown",
    "reason": "neither capacity input binds, and the operator-touch store is "
    "not yet measured",
    "inputs": {
        "operator_touches": {
            "measurement": "not_yet_measured",
            "window_days": 7,
            "touches": 0,
            "operator_reaching": 0,
            "operator_reaching_per_day": None,
        },
        "machines": None,
        "tokens": None,
        "emission_gap": None,
    },
    "unknown_inputs": [
        "machines: coord.device_resource_samples could not be read",
        "emission_gap: dropped_unacked is not published to coord (Plan B §2g)",
    ],
    "computed_at": "2026-09-27T10:00:00Z",
}

NOT_YET_MEASURED = {
    "aggregate_included": True,
    "measurement": "not_yet_measured",
    "measured_since": None,
    "covered_days": None,
    "window_days": 7,
    "totals": {
        "touches": 0,
        "operator_reaching": 0,
        "agent_dispatchable": 0,
        "unknown": 0,
    },
    "agent_absorbed_rate": None,
    "unknown_share": None,
    "policy_authorized_split": {"yes": 0, "no": 0, "unknown": 0},
    "reason_classes": [],
    "touches": [],
    "next_cursor": None,
    "constraint_verdict": VERDICT,
}

LATER_PAGE = {
    "aggregate_included": False,
    "measurement": None,
    "measured_since": None,
    "covered_days": None,
    "window_days": 30,
    "totals": None,
    "agent_absorbed_rate": None,
    "unknown_share": None,
    "policy_authorized_split": None,
    "reason_classes": None,
    "touches": [
        {
            "touch_id": str(uuid4()),
            "kind": "question",
            "source": "runner",
            "reason_code": "design_fork",
            "policy_authorized": "yes",
            "disposition": "operator_reaching",
            "emitted_at": "2026-09-26T09:00:00.123456Z",
            "resolved_at": None,
            "resolution": None,
            "work_unit_id": None,
            "gate_id": None,
            "answer_via": {"kind": "question", "id": str(uuid4()), "state": "pending"},
        }
    ],
    "next_cursor": None,
    "constraint_verdict": None,
}


class TestOperatorTouchesProxy:
    def test_not_yet_measured_passes_through_with_nulls_intact(
        self, auth_client: TestClient
    ):
        """The empty store's null rates must reach the page as null — a proxy
        that defaulted them would turn "not yet measured" into a healthy 0%.
        """
        resp, mock_instance = _get(
            auth_client, TOUCHES_ROUTE, _mock_response(200, NOT_YET_MEASURED)
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body == NOT_YET_MEASURED
        assert body["agent_absorbed_rate"] is None
        assert body["constraint_verdict"]["verdict"] == "unknown"
        assert mock_instance.get.call_args[0][0].endswith("/coord/operator-touches")

    def test_a_before_page_keeps_aggregate_included_false(
        self, auth_client: TestClient
    ):
        resp, _ = _get(auth_client, TOUCHES_ROUTE, _mock_response(200, LATER_PAGE))
        assert resp.status_code == 200
        body = resp.json()
        assert body["aggregate_included"] is False
        assert body["constraint_verdict"] is None
        assert body["touches"][0]["answer_via"]["state"] == "pending"

    def test_every_set_query_param_is_forwarded(self, auth_client: TestClient):
        cursor = "2026-09-26T09:00:00.123456Z_" + str(uuid4())
        url = (
            f"{TOUCHES_ROUTE}?window_days=30&disposition=agent_dispatchable"
            f"&open_only=true&actionable_only=false&limit=25&before={cursor}"
        )
        _, mock_instance = _get(auth_client, url, _mock_response(200, LATER_PAGE))
        params = mock_instance.get.call_args.kwargs["params"]
        assert params == {
            "window_days": "30",
            "disposition": "agent_dispatchable",
            "open_only": "true",
            "actionable_only": "false",
            "limit": "25",
            "before": cursor,
        }

    def test_no_query_sends_no_params(self, auth_client: TestClient):
        """An unset filter must be ABSENT on the wire, not an empty value."""
        _, mock_instance = _get(
            auth_client, TOUCHES_ROUTE, _mock_response(200, NOT_YET_MEASURED)
        )
        assert mock_instance.get.call_args.kwargs["params"] is None

    def test_forwards_the_operator_bearer(self, auth_client: TestClient):
        _, mock_instance = _get(
            auth_client, TOUCHES_ROUTE, _mock_response(200, NOT_YET_MEASURED)
        )
        headers = mock_instance.get.call_args.kwargs["headers"]
        assert headers["Authorization"] == f"Bearer {TEST_BEARER}"

    @pytest.mark.parametrize("query", ["limit=500", "window_days=abc", "open_only=yes"])
    def test_values_coord_validates_reach_coord_unchanged(
        self, auth_client: TestClient, query: str
    ):
        """No edge 422: coord clamps ``limit`` and answers anything malformed
        with its own typed 400, which is the shape the page reads. A FastAPI
        422 here would be a different body blamed on coord."""
        key, value = query.split("=")
        resp, mock_instance = _get(
            auth_client,
            f"{TOUCHES_ROUTE}?{query}",
            _mock_response(400, {"error": "bad_request", "detail": "x"}),
        )
        assert resp.status_code == 400
        assert resp.json() == {"error": "bad_request", "detail": "x"}
        assert mock_instance.get.call_args.kwargs["params"] == {key: value}

    @pytest.mark.parametrize(
        "status,body",
        [
            (503, {"error": "schema_migration_pending", "detail": "42P01"}),
            (503, {"error": "db_unavailable", "detail": "pool timeout"}),
            (
                400,
                {
                    "error": "bad_request",
                    "detail": "window_days must be one of [7, 30], got 14",
                },
            ),
        ],
    )
    def test_coord_error_bodies_are_verbatim(
        self, auth_client: TestClient, status: int, body: dict
    ):
        resp, _ = _get(
            auth_client, f"{TOUCHES_ROUTE}?window_days=14", _mock_response(status, body)
        )
        assert resp.status_code == status
        assert resp.json() == body

    def test_coord_unreachable_is_a_502_not_an_empty_store(
        self, auth_client: TestClient
    ):
        resp, _ = _get(
            auth_client, TOUCHES_ROUTE, side_effect=httpx.ConnectError("nope")
        )
        assert resp.status_code == 502

    def test_coord_timeout_is_a_504(self, auth_client: TestClient):
        resp, _ = _get(
            auth_client, TOUCHES_ROUTE, side_effect=httpx.ReadTimeout("slow")
        )
        assert resp.status_code == 504


class TestConstraintVerdictProxy:
    def test_verdict_passes_through_untouched(self, auth_client: TestClient):
        resp, mock_instance = _get(
            auth_client, f"{VERDICT_ROUTE}?window_days=30", _mock_response(200, VERDICT)
        )
        assert resp.status_code == 200
        assert resp.json() == VERDICT
        assert mock_instance.get.call_args[0][0].endswith(
            "/coord/operator-touches/constraint-verdict"
        )
        assert mock_instance.get.call_args.kwargs["params"] == {"window_days": "30"}

    def test_no_window_sends_no_params(self, auth_client: TestClient):
        _, mock_instance = _get(
            auth_client, VERDICT_ROUTE, _mock_response(200, VERDICT)
        )
        assert mock_instance.get.call_args.kwargs["params"] is None

    def test_bad_window_400_is_verbatim(self, auth_client: TestClient):
        body = {
            "error": "bad_request",
            "detail": "window_days must be one of [7, 30], got 1",
        }
        resp, _ = _get(
            auth_client, f"{VERDICT_ROUTE}?window_days=1", _mock_response(400, body)
        )
        assert resp.status_code == 400
        assert resp.json() == body


class TestSloProxyCarriesTheTouchBlock:
    """``/pr-merge/slo`` returns coord's JSON as-is, so the tenant-level
    ``operator_touch`` block and ``structurally_zero`` survive the hop."""

    def test_operator_touch_and_structurally_zero_survive(
        self, auth_client: TestClient
    ):
        window = {
            "measurement": "not_yet_measured",
            "unreadable_reason": None,
            "measured_since": None,
            "covered_days": None,
            "touches": None,
            "operator_reaching": None,
            "operator_reaching_per_day": None,
            "agent_absorbed_rate": None,
            "unknown_share": None,
            "policy_authorized_split": None,
        }
        payload = {
            "tenant_id": str(TEST_TENANT_ID),
            "repos": [],
            "kill_switch_history_last_30d": [],
            "generated_at": "2026-09-27T10:00:00Z",
            "operator_touch": {
                "last_7d": window,
                "last_30d": {
                    **window,
                    "measurement": "unreadable",
                    "unreadable_reason": "db_unavailable",
                },
            },
            "structurally_zero": ["operator_override_rate", "escalation_rate"],
        }
        resp, _ = _get(
            auth_client, f"{API_PREFIX}/pr-merge/slo", _mock_response(200, payload)
        )
        assert resp.status_code == 200
        assert resp.json() == payload
