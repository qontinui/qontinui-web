"""Integration tests for the fleet resource-stops proxy.

``GET /api/v1/operations/fleet/resource-stops`` proxies coord's
``GET /coord/devices/resource-stops`` so the ``/admin/coord/devops``
"Pressure stops" table renders without the browser hitting coord
cross-origin.

Plan ``2026-11-24-pressure-stops-record-box-stats-in-coord`` Phase 4.

The properties under test are the ones that keep the table honest:

* a row reaches the caller untouched, **nullable stats staying null** (a
  fabricated ``0`` session count would read as an idle box at the moment it
  refused work),
* ``table_present: false`` and an empty ``stops`` list survive the hop, since
  that pair is how the caller tells "table not migrated yet" (UNKNOWN) from
  "no stops",
* the filters are forwarded verbatim and unset ones are NOT put on the wire,
* the operator bearer is forwarded (never an anonymous coord call),
* a coord refusal keeps its status and an unreachable coord is a 502, never a
  fabricated empty list.

Mirrors ``test_operations_resource_samples_proxy.py``: minimal FastAPI app +
mocked ``httpx.AsyncClient``.
"""

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID, uuid4

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

TEST_TENANT_ID = uuid4()
API_PREFIX = "/api/v1/operations"
ROUTE = f"{API_PREFIX}/fleet/resource-stops"
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
        # `async def` is load-bearing: a sync override would run in a worker
        # thread whose ContextVar write never reaches the request task, and the
        # bearer-forwarding assertion below would pass vacuously.
        operations_module._caller_bearer.set(TEST_BEARER)
        return TEST_TENANT_ID

    test_app.dependency_overrides[get_tenant_id] = _tenant_override
    test_app.include_router(operations_router, prefix="/api/v1/operations")
    return test_app


@pytest.fixture()
def auth_client() -> TestClient:
    return TestClient(_build_test_app())


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


def _client_returning(MockClient, response: MagicMock) -> MagicMock:
    mock_instance = MagicMock()
    mock_instance.get = AsyncMock(return_value=response)
    _configure_mock_client(MockClient, mock_instance)
    return mock_instance


STOP_ROW = {
    "event_id": str(uuid4()),
    "device_id": str(uuid4()),
    "client_event_id": "evt-1",
    "observed_at": "2026-11-24T09:00:00Z",
    "recorded_at": "2026-11-24T09:00:01Z",
    "stop_kind": "refused_spawn",
    "lane": "memory_free_commit",
    "guard_lane": "wsl",
    "severity": "critical",
    "what_class": "terminal_spawn",
    "observed": 3_221_225_472,
    "limit_value": 4_294_967_296,
    "reason": "memory:critical:3221225472_under_4294967296",
    # UNKNOWN stays null: the live-claude census was stale at refusal time.
    "session_count_terminal": 7,
    "session_count_live_claude": None,
    "active_ci_runners": 2,
    "ci_jobs_queued": None,
    "calibration": {"thread_ceilings": {"source": "machine_scaled"}},
    "fleet_calibration": None,
    "suppressed_count": 3,
    "dropped_before": 0,
    "box_stats": {},
}


class TestResourceStopsProxy:
    def test_forwards_rows_untouched_and_keeps_unknown_null(
        self, auth_client: TestClient
    ):
        coord_payload = {
            "table_present": True,
            "count": 1,
            "stops": [STOP_ROW],
            "bounded": False,
            "limit": 100,
            "limit_clamped": False,
            "summary": None,
        }
        with _patch_httpx() as MockClient:
            mock_instance = _client_returning(
                MockClient, _mock_response(200, coord_payload)
            )
            resp = auth_client.get(ROUTE)

        assert resp.status_code == 200
        body = resp.json()
        assert body == coord_payload
        row = body["stops"][0]
        assert row["session_count_live_claude"] is None
        assert row["ci_jobs_queued"] is None
        assert row["fleet_calibration"] is None
        assert row["guard_lane"] == "wsl"
        url = mock_instance.get.call_args[0][0]
        assert url.endswith("/coord/devices/resource-stops")

    def test_table_not_present_is_forwarded_not_flattened_to_empty(
        self, auth_client: TestClient
    ):
        coord_payload = {
            "table_present": False,
            "stops": [],
            "count": 0,
            "bounded": False,
            "limit": 100,
            "limit_clamped": False,
            "summary": None,
        }
        with _patch_httpx() as MockClient:
            _client_returning(MockClient, _mock_response(200, coord_payload))
            resp = auth_client.get(ROUTE)

        assert resp.status_code == 200
        assert resp.json()["table_present"] is False
        assert resp.json()["stops"] == []

    def test_forwards_the_operator_bearer(self, auth_client: TestClient):
        with _patch_httpx() as MockClient:
            mock_instance = _client_returning(
                MockClient, _mock_response(200, {"table_present": True, "stops": []})
            )
            auth_client.get(ROUTE)

        headers = mock_instance.get.call_args.kwargs["headers"]
        assert headers is not None
        assert headers["Authorization"] == f"Bearer {TEST_BEARER}"

    def test_forwards_every_filter_verbatim(self, auth_client: TestClient):
        device_id = str(uuid4())
        with _patch_httpx() as MockClient:
            mock_instance = _client_returning(
                MockClient, _mock_response(200, {"table_present": True, "stops": []})
            )
            auth_client.get(
                ROUTE,
                params={
                    "device_id": device_id,
                    "lane": "thread_pressure",
                    "guard_lane": "threads",
                    "since": "2026-11-23",
                    "limit": 25,
                    "summary": "true",
                },
            )

        sent = mock_instance.get.call_args.kwargs["params"]
        assert sent == {
            "device_id": device_id,
            "lane": "thread_pressure",
            "guard_lane": "threads",
            "since": "2026-11-23",
            "limit": 25,
            "summary": True,
        }

    def test_unset_filters_put_nothing_on_the_wire(self, auth_client: TestClient):
        with _patch_httpx() as MockClient:
            mock_instance = _client_returning(
                MockClient, _mock_response(200, {"table_present": True, "stops": []})
            )
            auth_client.get(ROUTE)

        assert mock_instance.get.call_args.kwargs.get("params") is None

    def test_coord_unreachable_is_a_502_not_a_fabricated_empty_set(
        self, auth_client: TestClient
    ):
        with _patch_httpx() as MockClient:
            mock_instance = MagicMock()
            mock_instance.get = AsyncMock(side_effect=httpx.ConnectError("nope"))
            _configure_mock_client(MockClient, mock_instance)
            resp = auth_client.get(ROUTE)

        assert resp.status_code == 502

    def test_coord_refusal_status_is_propagated(self, auth_client: TestClient):
        with _patch_httpx() as MockClient:
            _client_returning(
                MockClient, _mock_response(422, None, text="unknown lane")
            )
            resp = auth_client.get(ROUTE, params={"lane": "bogus"})

        assert resp.status_code == 422
