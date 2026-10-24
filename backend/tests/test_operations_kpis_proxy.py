"""Tests for the work-unit KPI read proxy.

Plan ``2026-10-09-kpi-telemetry-and-dashboards`` Phase 4:

* ``GET /api/v1/operations/kpis`` → coord ``GET /coord/kpis`` (schema
  ``kpis/v1``), optional ``window`` and ``repos``.

A verbatim pass-through. What is pinned is the part a proxy can get wrong
silently:

* the coord path, and the operator bearer forwarded to it,
* ``window``, ``repos``, ``slug`` and ``limit`` forwarded VERBATIM when set
  (the comma list is not split, re-joined or percent-mangled; ``limit`` is not
  coerced or range-checked — coord owns its 200 ceiling) and ABSENT from the
  wire when not — coord owns the defaults, and an empty ``?window=`` from us
  would override them,
* nothing else is forwarded: the contract defines exactly those four, so a
  client-supplied extra must not be invented onto the wire,
* the body surviving uncoerced — every figure is
  ``{value, coverage_n, population_n, basis, reason}``, and a ``null`` value
  carries the ``reason`` that makes it UNKNOWN rather than zero. A proxy that
  dropped, zeroed or defaulted one would turn UNKNOWN into a number,
* coord's own 4xx (a ``window`` it cannot parse), a 404 from a coord that does
  not serve the route yet, a 5xx, and an unreachable or slow coord all surface
  as errors with their status, never as an empty 200.

Mirrors ``test_operations_domain_cost_proxy.py``: minimal FastAPI app +
mocked ``httpx.AsyncClient``, so no live coord is needed.
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
KPIS_ROUTE = f"{API_PREFIX}/kpis"
COORD_PATH = "/coord/kpis"

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
        # The real `get_tenant_id` captures the caller's Cognito token into
        # this ContextVar and `_tenant_headers` reads it back. `async def` is
        # load-bearing: FastAPI runs a SYNC dependency in a worker thread
        # whose ContextVar writes never reach the request task.
        operations_module._caller_bearer.set(TEST_BEARER)
        return TEST_TENANT_ID

    test_app.dependency_overrides[get_tenant_id] = _tenant_override
    test_app.include_router(operations_router, prefix="/api/v1/operations")
    return test_app


@pytest.fixture()
def auth_client() -> TestClient:
    return TestClient(_build_test_app())


def _mock_response(
    status_code: int = 200, json_data: Any = None, text: str = ""
) -> MagicMock:
    resp = MagicMock(spec=httpx.Response)
    resp.status_code = status_code
    resp.json.return_value = json_data
    resp.text = text or (str(json_data) if json_data else "")
    return resp


def _get(
    client: TestClient,
    route: str,
    response: MagicMock | None = None,
    side_effect: Exception | None = None,
) -> tuple[Any, MagicMock]:
    """GET ``route`` against a mocked coord; return (response, mocked get)."""
    with patch("app.api.v1.endpoints.operations.httpx.AsyncClient") as MockClient:
        instance = MagicMock()
        instance.__aenter__ = AsyncMock(return_value=instance)
        instance.__aexit__ = AsyncMock(return_value=False)
        instance.get = AsyncMock(return_value=response, side_effect=side_effect)
        MockClient.return_value = instance
        return client.get(route), instance.get


def _assert_forwarded(get: MagicMock) -> dict[str, Any] | None:
    """Assert the coord URL + bearer; return the forwarded params."""
    get.assert_awaited_once()
    assert get.call_args.args[0].endswith(COORD_PATH), get.call_args.args[0]
    headers = get.call_args.kwargs.get("headers") or {}
    assert headers.get("Authorization") == f"Bearer {TEST_BEARER}", headers
    params: dict[str, Any] | None = get.call_args.kwargs.get("params")
    return params


def _kpi(
    value: Any,
    *,
    coverage_n: int,
    population_n: int,
    basis: str,
    reason: str | None = None,
) -> dict[str, Any]:
    return {
        "value": value,
        "coverage_n": coverage_n,
        "population_n": population_n,
        "basis": basis,
        "reason": reason,
    }


# A `kpis/v1` body shaped the way the frozen contract specifies it: a measured
# figure, a partially covered one, a list-price cost whose basis says so, and
# figures that are UNKNOWN (value null + a reason from the closed vocabulary).
KPIS = {
    "schema": "kpis/v1",
    "generated_at": "2026-10-24T12:00:00Z",
    "window": {
        "days": 28,
        "from": "2026-09-26T12:00:00Z",
        "to": "2026-10-24T12:00:00Z",
    },
    "repos": None,
    "population": {"shipped_units": 3, "units_returned": 3, "truncated": False},
    "aggregates": {
        "lead_time_seconds_median": _kpi(
            5400, coverage_n=3, population_n=3, basis="shipped units in window"
        ),
        "lead_time_seconds_p90": _kpi(
            None,
            coverage_n=0,
            population_n=3,
            basis="shipped units in window",
            reason="empty_population",
        ),
        "autonomy_rate": _kpi(
            None,
            coverage_n=0,
            population_n=3,
            basis="shipped units with zero operator-reaching touches",
            reason="not_yet_measured",
        ),
        "cost_per_shipped_task_microusd_median": _kpi(
            2_500_000,
            coverage_n=2,
            population_n=3,
            basis="list-price equivalent; 1 reported, 1 estimated",
        ),
        "land_rate": _kpi(0.75, coverage_n=3, population_n=3, basis="cited PRs"),
        "red_to_green_per_pr_median": _kpi(
            None,
            coverage_n=0,
            population_n=3,
            basis="landed cited PRs",
            reason="no_cited_prs",
        ),
        "rework_rate": _kpi(
            None,
            coverage_n=0,
            population_n=3,
            basis="landed cited PRs",
            reason="revert_probe_not_run",
        ),
    },
    "units": [
        {
            "slug": "2026-10-01-a-plan",
            "work_unit_id": "5d3c1d9e-0000-4000-8000-000000000001",
            "status": "shipped",
            "shipped_at": "2026-10-03T08:00:00Z",
            "lead_time_seconds": _kpi(
                5400, coverage_n=1, population_n=1, basis="first in_progress to last PR"
            ),
            "lead_time_segments": {
                "in_progress_to_first_pr_opened_seconds": _kpi(
                    1800, coverage_n=1, population_n=1, basis="segment"
                ),
                "first_pr_opened_to_last_landed_seconds": _kpi(
                    3600, coverage_n=1, population_n=1, basis="segment"
                ),
            },
            "sessions": _kpi(3, coverage_n=2, population_n=3, basis="sessions"),
            "tokens": {
                "input": _kpi(
                    None,
                    coverage_n=0,
                    population_n=3,
                    basis="sessions with usage",
                    reason="no_usage_rows",
                ),
                "output": _kpi(
                    None,
                    coverage_n=0,
                    population_n=3,
                    basis="sessions with usage",
                    reason="no_usage_rows",
                ),
                "cache_creation_input": _kpi(
                    None,
                    coverage_n=0,
                    population_n=3,
                    basis="sessions with usage",
                    reason="no_usage_rows",
                ),
                "cache_read_input": _kpi(
                    None,
                    coverage_n=0,
                    population_n=3,
                    basis="sessions with usage",
                    reason="no_usage_rows",
                ),
            },
            "cost_microusd": _kpi(
                None,
                coverage_n=0,
                population_n=3,
                basis="list-price equivalent",
                reason="no_usage_rows",
            ),
            "ci_attempts": _kpi(4, coverage_n=1, population_n=1, basis="cited PRs"),
            "red_to_green_iterations": _kpi(
                1, coverage_n=1, population_n=1, basis="cited PRs"
            ),
            "interventions": _kpi(
                None,
                coverage_n=0,
                population_n=1,
                basis="operator touches",
                reason="not_yet_measured",
            ),
            "interventions_split": {
                "policy_authorized_true": None,
                "policy_authorized_false": None,
                "policy_authorized_unknown": None,
            },
            "rework": _kpi(
                None,
                coverage_n=0,
                population_n=1,
                basis="landed cited PRs",
                reason="revert_probe_not_run",
            ),
            "prs": {"cited": 1, "landed": 1},
        }
    ],
}


def test_kpis_forwards_to_coord_without_params(auth_client: TestClient) -> None:
    resp, get = _get(auth_client, KPIS_ROUTE, _mock_response(200, KPIS))
    assert resp.status_code == 200
    params = _assert_forwarded(get)
    assert not params, f"unset window/repos must not reach the wire, got {params!r}"


def test_kpis_forwards_window_verbatim(auth_client: TestClient) -> None:
    resp, get = _get(auth_client, f"{KPIS_ROUTE}?window=7d", _mock_response(200, KPIS))
    assert resp.status_code == 200
    assert _assert_forwarded(get) == {"window": "7d"}


def test_kpis_forwards_repos_verbatim_as_one_comma_list(
    auth_client: TestClient,
) -> None:
    repos = "qontinui/qontinui-web,qontinui/qontinui-coord"
    resp, get = _get(
        auth_client, f"{KPIS_ROUTE}?repos={repos}", _mock_response(200, KPIS)
    )
    assert resp.status_code == 200
    # One string, exactly as sent: coord owns the comma grammar and validates
    # each `owner/name`, so splitting it into a repeated key here would change
    # what coord parses.
    assert _assert_forwarded(get) == {"repos": repos}


def test_kpis_forwards_window_and_repos_together(auth_client: TestClient) -> None:
    resp, get = _get(
        auth_client,
        f"{KPIS_ROUTE}?window=90d&repos=qontinui/qontinui-web",
        _mock_response(200, KPIS),
    )
    assert resp.status_code == 200
    assert _assert_forwarded(get) == {
        "window": "90d",
        "repos": "qontinui/qontinui-web",
    }


def test_kpis_forwards_slug_verbatim(auth_client: TestClient) -> None:
    resp, get = _get(
        auth_client,
        f"{KPIS_ROUTE}?slug=2026-10-01-a-plan",
        _mock_response(200, KPIS),
    )
    assert resp.status_code == 200
    assert _assert_forwarded(get) == {"slug": "2026-10-01-a-plan"}


def test_kpis_forwards_limit_verbatim_as_the_string_it_was_sent(
    auth_client: TestClient,
) -> None:
    resp, get = _get(auth_client, f"{KPIS_ROUTE}?limit=200", _mock_response(200, KPIS))
    assert resp.status_code == 200
    # A string, not an int: this module does not own limit's grammar.
    assert _assert_forwarded(get) == {"limit": "200"}


def test_kpis_forwards_all_four_params_together(auth_client: TestClient) -> None:
    resp, get = _get(
        auth_client,
        f"{KPIS_ROUTE}?window=90d&repos=qontinui/qontinui-web"
        "&slug=2026-10-01-a-plan&limit=50",
        _mock_response(200, KPIS),
    )
    assert resp.status_code == 200
    assert _assert_forwarded(get) == {
        "window": "90d",
        "repos": "qontinui/qontinui-web",
        "slug": "2026-10-01-a-plan",
        "limit": "50",
    }


def test_kpis_does_not_validate_limit_itself(auth_client: TestClient) -> None:
    # Over coord's ceiling and not a number at all: both reach coord unchanged.
    # If this module typed `limit` as an int, the second would be a 422 raised
    # here, a grammar of this module's own.
    for sent in ("201", "abc", "-1"):
        resp, get = _get(
            auth_client, f"{KPIS_ROUTE}?limit={sent}", _mock_response(200, KPIS)
        )
        assert resp.status_code == 200, sent
        assert _assert_forwarded(get) == {"limit": sent}


def test_kpis_does_not_invent_params_the_contract_does_not_define(
    auth_client: TestClient,
) -> None:
    resp, get = _get(
        auth_client,
        f"{KPIS_ROUTE}?window=7d&offset=5&extra=1",
        _mock_response(200, KPIS),
    )
    assert resp.status_code == 200
    assert _assert_forwarded(get) == {"window": "7d"}


def test_kpis_body_passes_through_with_unknowns_intact(
    auth_client: TestClient,
) -> None:
    resp, _ = _get(auth_client, KPIS_ROUTE, _mock_response(200, KPIS))
    body = resp.json()
    assert body == KPIS
    assert body["schema"] == "kpis/v1"
    agg = body["aggregates"]
    # UNKNOWN stays UNKNOWN: null + its reason, never 0 and never dropped.
    assert agg["autonomy_rate"]["value"] is None
    assert agg["autonomy_rate"]["reason"] == "not_yet_measured"
    assert agg["rework_rate"]["reason"] == "revert_probe_not_run"
    # A partially covered figure keeps both halves of its coverage.
    cost = agg["cost_per_shipped_task_microusd_median"]
    assert (cost["coverage_n"], cost["population_n"]) == (2, 3)
    assert "list-price equivalent" in cost["basis"]
    unit = body["units"][0]
    assert unit["cost_microusd"]["value"] is None
    assert unit["cost_microusd"]["reason"] == "no_usage_rows"
    assert unit["tokens"]["input"]["value"] is None
    assert unit["interventions_split"]["policy_authorized_true"] is None
    assert unit["prs"] == {"cited": 1, "landed": 1}


def test_kpis_unknown_field_from_a_newer_coord_is_not_stripped(
    auth_client: TestClient,
) -> None:
    newer = {**KPIS, "added_by_a_later_coord": {"x": 1}}
    resp, _ = _get(auth_client, KPIS_ROUTE, _mock_response(200, newer))
    assert resp.json()["added_by_a_later_coord"] == {"x": 1}


def test_kpis_slug_response_with_no_row_stays_an_empty_units_list(
    auth_client: TestClient,
) -> None:
    # With `slug`, coord's `units` holds that one unit — and is EMPTY when coord
    # has no row for it. Aggregates are still over the window's shipped units.
    # The proxy must pass the empty list through as [], not drop or fill it.
    body = {**KPIS, "units": []}
    resp, _ = _get(
        auth_client, f"{KPIS_ROUTE}?slug=no-such-unit", _mock_response(200, body)
    )
    assert resp.status_code == 200
    out = resp.json()
    assert out["units"] == []
    assert out["aggregates"] == KPIS["aggregates"]


def test_kpis_coord_rejection_of_limit_over_its_ceiling_passes_through(
    auth_client: TestClient,
) -> None:
    resp, get = _get(
        auth_client,
        f"{KPIS_ROUTE}?limit=201",
        _mock_response(400, None, text='{"error":"limit must be <= 200"}'),
    )
    assert resp.status_code == 400
    assert "limit must be <= 200" in resp.text
    assert _assert_forwarded(get) == {"limit": "201"}


def test_kpis_coord_rejection_of_window_passes_through(
    auth_client: TestClient,
) -> None:
    resp, _ = _get(
        auth_client,
        f"{KPIS_ROUTE}?window=bogus",
        _mock_response(400, None, text='{"error":"invalid window"}'),
    )
    assert resp.status_code == 400
    assert "invalid window" in resp.text


def test_kpis_coord_without_the_route_is_a_404_not_an_empty_200(
    auth_client: TestClient,
) -> None:
    # The window where this console is a deploy ahead of coord: the page must
    # be able to tell "coord does not serve it" from "no KPIs".
    resp, _ = _get(
        auth_client,
        KPIS_ROUTE,
        _mock_response(404, None, text='{"error":"no_such_route"}'),
    )
    assert resp.status_code == 404
    assert "no_such_route" in resp.text


def test_kpis_coord_error_is_raised_not_zeroed(auth_client: TestClient) -> None:
    resp, _ = _get(
        auth_client,
        KPIS_ROUTE,
        _mock_response(500, None, text='{"error":"db_error"}'),
    )
    assert resp.status_code == 500
    assert "db_error" in resp.text


def test_kpis_unreachable_coord_is_502(auth_client: TestClient) -> None:
    resp, _ = _get(
        auth_client,
        KPIS_ROUTE,
        side_effect=httpx.ConnectError("connection refused"),
    )
    assert resp.status_code == 502


def test_kpis_coord_timeout_is_504(auth_client: TestClient) -> None:
    resp, _ = _get(auth_client, KPIS_ROUTE, side_effect=httpx.ReadTimeout("slow"))
    assert resp.status_code == 504
