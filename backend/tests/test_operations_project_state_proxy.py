"""Tests for the project-state proxy, ``GET /api/v1/operations/project-state``.

Plan
``2026-09-20-what-is-the-state-of-my-projects-and-what-needs-me-is-answerable-from-one-screen``
Phase 4. The route is a plain pass-through of coord's operator route
``GET /coord/project-state`` — ``/admin/coord/home`` and the ``/overview``
progress panel render coord's bytes. What is pinned:

* the coord path, and that the caller's bearer is forwarded (coord resolves
  the tenant from it; nothing tenant-shaped goes on the query string);
* the body arrives UNCOERCED — in particular a block whose ``state`` is not
  ``read`` arrives with NO counts, and the proxy must not invent any (an
  absent count and a zero are different claims; the page renders the first as
  unknown);
* a coord it cannot reach is a 502, never an empty 200.
"""

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID, uuid4

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

TEST_TENANT_ID = uuid4()
ROUTE = "/api/v1/operations/project-state"
TEST_BEARER = "test-cognito-access-token"

_CLASSES = {
    "shipped": 4,
    "in_flight": 2,
    "stalled": 1,
    "blocked_on_dependency": 0,
    "waiting_on_gate": 1,
    "not_started": 3,
    "closed_other": 0,
    "off_vocabulary": 0,
    "unset": 0,
}

COORD_BODY = {
    "schema": 1,
    "generated_at": "2026-09-30T12:00:00Z",
    "tenant_id": str(TEST_TENANT_ID),
    "scope": "operator",
    "on_track": {
        "state": "read",
        "totals": {"row_count": 11, "classes": _CLASSES},
        "groups": [],
        "stall_window_secs": 1209600,
    },
    "correctness": {
        "state": "unknown",
        "reason": "verification_metrics_door_absent",
        "inputs": None,
    },
    "needs_me": {"state": "not_implemented"},
    "degradations": {
        "state": "could_not_read",
        "headline": "unknown",
        "error": "timeout",
    },
    "does_not_know": [
        {
            "source": "work_units",
            "state": "read",
            "as_of": "2026-09-30T12:00:00Z",
            "freshness_bound_secs": None,
            "rows_considered": 11,
            "rows_excluded": None,
            "exclusion_reason": None,
            "error": None,
        }
    ],
}


def _build_test_app() -> FastAPI:
    from app.api.deps import get_current_active_user_async
    from app.api.v1.endpoints import operations as operations_module
    from app.api.v1.endpoints.operations import get_tenant_id
    from app.api.v1.endpoints.operations import router as operations_router

    test_app = FastAPI()
    mock_user = MagicMock()
    mock_user.id = uuid4()
    mock_user.is_active = True
    mock_user.is_verified = True
    test_app.dependency_overrides[get_current_active_user_async] = lambda: mock_user

    async def _tenant_override() -> UUID:
        # `async def` is load-bearing: FastAPI runs a sync dependency in a
        # worker thread whose ContextVar writes never reach the request task,
        # and `_tenant_headers` reads the captured bearer back from one.
        operations_module._caller_bearer.set(TEST_BEARER)
        return TEST_TENANT_ID

    test_app.dependency_overrides[get_tenant_id] = _tenant_override
    test_app.include_router(operations_router, prefix="/api/v1/operations")
    return test_app


@pytest.fixture()
def client() -> TestClient:
    return TestClient(_build_test_app())


def _mock_response(status_code: int = 200, json_data=None) -> MagicMock:
    resp = MagicMock(spec=httpx.Response)
    resp.status_code = status_code
    resp.json.return_value = json_data
    resp.text = str(json_data) if json_data else ""
    return resp


def _patched_client(response: MagicMock | None = None, error: Exception | None = None):
    patcher = patch("app.api.v1.endpoints.operations.httpx.AsyncClient")
    MockClient = patcher.start()
    instance = MagicMock()
    instance.get = AsyncMock(return_value=response, side_effect=error)
    instance.__aenter__ = AsyncMock(return_value=instance)
    instance.__aexit__ = AsyncMock(return_value=False)
    MockClient.return_value = instance
    return patcher, instance


def test_proxies_coord_operator_route_with_the_bearer(client: TestClient) -> None:
    patcher, instance = _patched_client(_mock_response(200, COORD_BODY))
    try:
        resp = client.get(ROUTE)
    finally:
        patcher.stop()
    assert resp.status_code == 200
    call = instance.get.call_args
    assert call.args[0].endswith("/coord/project-state")
    assert call.kwargs.get("params") is None
    headers = call.kwargs.get("headers") or {}
    assert headers.get("Authorization") == f"Bearer {TEST_BEARER}"


def test_body_passes_through_uncoerced(client: TestClient) -> None:
    """A non-read block arrives WITHOUT counts; the proxy adds none."""
    patcher, _ = _patched_client(_mock_response(200, COORD_BODY))
    try:
        body = client.get(ROUTE).json()
    finally:
        patcher.stop()
    assert body == COORD_BODY
    assert body["needs_me"] == {"state": "not_implemented"}
    assert "open" not in body["degradations"]
    assert body["correctness"]["inputs"] is None


def test_coord_unreachable_is_502_not_an_empty_200(client: TestClient) -> None:
    patcher, _ = _patched_client(error=httpx.ConnectError("refused"))
    try:
        resp = client.get(ROUTE)
    finally:
        patcher.stop()
    assert resp.status_code == 502
