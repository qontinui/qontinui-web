"""Tests for the two operations-ratchet read proxies.

Plan ``2026-09-20-the-second-ratchet-domain-is-operations-and-its-cost-is-compared-to-the-first``:

* ``GET /api/v1/operations/domain-cost`` → coord ``GET /coord/domain-cost``
  (Phase 2), optional ``as_of``.
* ``GET /api/v1/operations/alerts/fault-to-visibility`` → coord
  ``GET /coord/alerts/fault-to-visibility`` (Phase 4), optional ``window``.

Both are verbatim pass-throughs. What is pinned is the part a proxy can get
wrong silently:

* the coord path, and the operator bearer forwarded to it,
* an optional query parameter forwarded when set and ABSENT from the wire when
  not (coord owns the default; an empty ``?as_of=`` from us would override it),
* the body surviving uncoerced — the ledger's ``null`` values carry a
  ``reason`` and a ``null`` ratio means "below the coverage floor", so a proxy
  that dropped or zeroed them would turn UNKNOWN into a number,
* ``/alerts/fault-to-visibility`` is NOT swallowed by another ``/alerts*``
  route,
* coord's own 4xx (a ``window`` it cannot parse) and an unreachable coord
  surface as errors, never as an empty 200.

Mirrors ``test_operations_fleet_health_proxy.py``: minimal FastAPI app +
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
DOMAIN_COST_ROUTE = f"{API_PREFIX}/domain-cost"
FTV_ROUTE = f"{API_PREFIX}/alerts/fault-to-visibility"

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


def _assert_forwarded(get: MagicMock, coord_path: str) -> dict[str, Any] | None:
    """Assert the coord URL + bearer; return the forwarded params."""
    get.assert_awaited_once()
    assert get.call_args.args[0].endswith(coord_path), get.call_args.args[0]
    headers = get.call_args.kwargs.get("headers") or {}
    assert headers.get("Authorization") == f"Bearer {TEST_BEARER}", headers
    params: dict[str, Any] | None = get.call_args.kwargs.get("params")
    return params


# ---- /domain-cost ----------------------------------------------------------

# A ledger shaped the way Phase 2 specifies it: every dimension in the
# {value, coverage_n, population_n, basis} shape, a producer-less dimension as
# value null + reason, and a below-floor ratio as R null.
LEDGER = {
    "computed_at": "2026-09-30T12:00:00Z",
    "roster": {"domains": ["ui-bridge", "operations"]},
    "roster_source": {
        "repo": "qontinui-dev-notes",
        "sha": "01b39792",
        "read_at": "2026-09-30T11:59:58Z",
    },
    "domains": [
        {
            "domain": "operations",
            "dimensions": {
                "work_units": {
                    "value": 12,
                    "coverage_n": 12,
                    "population_n": 40,
                    "basis": "area",
                },
                "tokens": {
                    "value": None,
                    "coverage_n": 0,
                    "population_n": 40,
                    "basis": None,
                    "reason": "no_producer",
                },
            },
            "R": {"work_units": None, "tokens": None},
            "verdict": "unfalsifiable",
        }
    ],
    "unmapped_areas": ["not-a-domain"],
    "unattributed_units_n": 28,
}


def test_domain_cost_forwards_to_coord_without_as_of(auth_client: TestClient) -> None:
    resp, get = _get(auth_client, DOMAIN_COST_ROUTE, _mock_response(200, LEDGER))
    assert resp.status_code == 200
    params = _assert_forwarded(get, "/coord/domain-cost")
    assert not params, f"an unset as_of must not reach the wire, got {params!r}"


def test_domain_cost_forwards_as_of_verbatim(auth_client: TestClient) -> None:
    as_of = "2026-09-01T00:00:00Z"
    resp, get = _get(
        auth_client,
        f"{DOMAIN_COST_ROUTE}?as_of={as_of}",
        _mock_response(200, LEDGER),
    )
    assert resp.status_code == 200
    assert _assert_forwarded(get, "/coord/domain-cost") == {"as_of": as_of}


def test_domain_cost_body_passes_through_with_unknowns_intact(
    auth_client: TestClient,
) -> None:
    resp, _ = _get(auth_client, DOMAIN_COST_ROUTE, _mock_response(200, LEDGER))
    body = resp.json()
    assert body == LEDGER
    tokens = body["domains"][0]["dimensions"]["tokens"]
    assert tokens["value"] is None and tokens["reason"] == "no_producer"
    assert body["domains"][0]["R"]["work_units"] is None


def test_domain_cost_unreadable_roster_is_not_an_empty_ledger(
    auth_client: TestClient,
) -> None:
    payload = {
        "computed_at": "2026-09-30T12:00:00Z",
        "roster": None,
        "roster_error": "mirror read failed: no such path",
        "domains": None,
    }
    resp, _ = _get(auth_client, DOMAIN_COST_ROUTE, _mock_response(200, payload))
    assert resp.status_code == 200
    body = resp.json()
    assert body["roster"] is None
    assert body["roster_error"] == "mirror read failed: no such path"
    assert body["domains"] is None, "a null domain list must not become []"


def test_domain_cost_coord_error_is_raised_not_zeroed(auth_client: TestClient) -> None:
    resp, _ = _get(
        auth_client,
        DOMAIN_COST_ROUTE,
        _mock_response(500, None, text='{"error":"db_error"}'),
    )
    assert resp.status_code == 500
    assert "db_error" in resp.text


def test_domain_cost_unreachable_coord_is_502(auth_client: TestClient) -> None:
    resp, _ = _get(
        auth_client,
        DOMAIN_COST_ROUTE,
        side_effect=httpx.ConnectError("connection refused"),
    )
    assert resp.status_code == 502


# ---- /alerts/fault-to-visibility -------------------------------------------

FTV = {
    "window": "30d",
    "kinds": [
        {
            "kind": "device_memory_low",
            "episodes_n": 10,
            "onset_known_n": 4,
            "p50_secs": 120,
            "p90_secs": 900,
        },
        {
            "kind": "runner_wedged",
            "episodes_n": 3,
            "onset_known_n": 0,
            "p50_secs": None,
            "p90_secs": None,
        },
    ],
}


def test_ftv_routes_to_its_own_coord_path_not_alerts(auth_client: TestClient) -> None:
    resp, get = _get(auth_client, FTV_ROUTE, _mock_response(200, FTV))
    assert resp.status_code == 200
    params = _assert_forwarded(get, "/coord/alerts/fault-to-visibility")
    assert not params, f"an unset window must not reach the wire, got {params!r}"


def test_ftv_forwards_window_verbatim(auth_client: TestClient) -> None:
    resp, get = _get(auth_client, f"{FTV_ROUTE}?window=7d", _mock_response(200, FTV))
    assert resp.status_code == 200
    assert _assert_forwarded(get, "/coord/alerts/fault-to-visibility") == {
        "window": "7d"
    }


def test_ftv_body_keeps_onset_share_and_null_percentiles(
    auth_client: TestClient,
) -> None:
    resp, _ = _get(auth_client, FTV_ROUTE, _mock_response(200, FTV))
    body = resp.json()
    assert body == FTV
    wedged = body["kinds"][1]
    assert (wedged["onset_known_n"], wedged["episodes_n"]) == (0, 3)
    assert wedged["p90_secs"] is None, "no known onset must stay null, not 0"


def test_ftv_coord_rejection_of_window_passes_through(auth_client: TestClient) -> None:
    resp, _ = _get(
        auth_client,
        f"{FTV_ROUTE}?window=bogus",
        _mock_response(400, None, text='{"error":"invalid window"}'),
    )
    assert resp.status_code == 400
    assert "invalid window" in resp.text


def test_ftv_coord_timeout_is_504(auth_client: TestClient) -> None:
    resp, _ = _get(
        auth_client,
        FTV_ROUTE,
        side_effect=httpx.ReadTimeout("slow"),
    )
    assert resp.status_code == 504
