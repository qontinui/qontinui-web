"""Integration tests for the fleet worktree-slots proxy.

``GET /api/v1/operations/fleet/worktree-slots`` proxies coord's
``GET /coord/fleet/worktree-slots`` so the "Worktree slots" section on
``/admin/coord/devops`` can render without the browser hitting coord
cross-origin.

Plan ``2026-09-21-worktree-slots-devops-dashboard-view.md`` Phase 2.

Mirrors the testing pattern in ``test_operations_resource_samples_proxy.py``
and the fleet ``/volumes`` proxy it sits beside: minimal FastAPI app + mocked
``httpx.AsyncClient``, so no live coord is needed. The properties under test:

* the response is passed through UNTOUCHED, including ``census_recent_rows``
  and the ``occupants`` block — the caller, not this proxy, decides how a
  ``census_recent_rows == 0`` row renders (UNKNOWN, never idle/healthy),
* the operator bearer is forwarded (never an anonymous coord call),
* a transport failure surfaces as 502, never a fabricated empty device list,
* coord's own error status codes are propagated unchanged.
"""

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID, uuid4

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

TEST_TENANT_ID = uuid4()
API_PREFIX = "/api/v1/operations"
ROUTE = f"{API_PREFIX}/fleet/worktree-slots"

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
        # `_tenant_headers` reads the caller's bearer back out of this
        # ContextVar to build the `Authorization` header. `async def` is
        # load-bearing here: FastAPI runs a sync dependency in a worker
        # thread whose ContextVar writes never propagate back to the
        # request task, so a sync override would set the bearer somewhere
        # the endpoint can never read it (mirrors the resource-samples
        # proxy test's own note).
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


DEVICE_WITH_OCCUPANTS = {
    "device_id": str(uuid4()),
    "hostname": "merytshost",
    "active_worktrees": 3,
    "max_worktrees": 8,
    "census_recent_rows": 12,
    "occupants": {
        "shown": 3,
        "total": 3,
        "truncated": False,
        "rows": [
            {
                "repo": "qontinui-web",
                "worktree_path": "agent-worktrees/abc/qontinui-web",
                "age_secs": 412.5,
            },
        ],
    },
}

DEVICE_UNKNOWN = {
    "device_id": str(uuid4()),
    "hostname": "stale-box",
    "active_worktrees": 0,
    "max_worktrees": 8,
    # Ledger rows exist but no recent census hit — the UNKNOWN case, NOT the
    # same as a genuinely idle device.
    "census_recent_rows": 0,
    "occupants": {"shown": 0, "total": 0, "truncated": False, "rows": []},
}

COORD_PAYLOAD = {
    "tenant_id": str(TEST_TENANT_ID),
    "device_count": 2,
    "truncated": False,
    "device_cap": 100,
    "census_window_secs": 900,
    "devices": [DEVICE_WITH_OCCUPANTS, DEVICE_UNKNOWN],
}


class TestFleetWorktreeSlotsProxy:
    def test_forwards_the_response_untouched(self, auth_client: TestClient):
        """The device list, including ``census_recent_rows`` and
        ``occupants``, must survive the hop verbatim — the caller, not this
        proxy, is where the UNKNOWN-vs-idle distinction gets rendered.
        """
        with _patch_httpx() as MockClient:
            mock_instance = MagicMock()
            mock_instance.get = AsyncMock(
                return_value=_mock_response(200, COORD_PAYLOAD)
            )
            _configure_mock_client(MockClient, mock_instance)

            resp = auth_client.get(ROUTE)

        assert resp.status_code == 200
        assert resp.json() == COORD_PAYLOAD

    def test_census_recent_rows_zero_is_not_defaulted_or_dropped(
        self, auth_client: TestClient
    ):
        """The narrow-window UNKNOWN gate must reach the caller as `0`, not
        coerced or dropped — this proxy adds no defaults of its own.
        """
        with _patch_httpx() as MockClient:
            mock_instance = MagicMock()
            mock_instance.get = AsyncMock(
                return_value=_mock_response(200, COORD_PAYLOAD)
            )
            _configure_mock_client(MockClient, mock_instance)

            resp = auth_client.get(ROUTE)

        devices = resp.json()["devices"]
        unknown_device = next(
            d for d in devices if d["device_id"] == DEVICE_UNKNOWN["device_id"]
        )
        assert unknown_device["census_recent_rows"] == 0
        assert unknown_device["active_worktrees"] == 0

    def test_calls_the_coord_read_route(self, auth_client: TestClient):
        with _patch_httpx() as MockClient:
            mock_instance = MagicMock()
            mock_instance.get = AsyncMock(
                return_value=_mock_response(200, COORD_PAYLOAD)
            )
            _configure_mock_client(MockClient, mock_instance)

            auth_client.get(ROUTE)

        url = mock_instance.get.call_args[0][0]
        assert url.endswith("/coord/fleet/worktree-slots")

    def test_forwards_the_operator_bearer(self, auth_client: TestClient):
        """Never an anonymous coord call — mirrors the resource-samples and
        fleet-volumes proxies' own bearer-forwarding assertion.
        """
        with _patch_httpx() as MockClient:
            mock_instance = MagicMock()
            mock_instance.get = AsyncMock(
                return_value=_mock_response(200, COORD_PAYLOAD)
            )
            _configure_mock_client(MockClient, mock_instance)

            auth_client.get(ROUTE)

        headers = mock_instance.get.call_args.kwargs["headers"]
        assert headers is not None
        assert headers["Authorization"] == f"Bearer {TEST_BEARER}"

    def test_coord_unreachable_is_a_502_not_a_fabricated_empty_list(
        self, auth_client: TestClient
    ):
        """A transport failure must NOT look like "no devices have any
        worktrees allocated".
        """
        with _patch_httpx() as MockClient:
            mock_instance = MagicMock()
            mock_instance.get = AsyncMock(side_effect=httpx.ConnectError("nope"))
            _configure_mock_client(MockClient, mock_instance)

            resp = auth_client.get(ROUTE)

        assert resp.status_code == 502

    def test_coord_error_status_is_propagated(self, auth_client: TestClient):
        with _patch_httpx() as MockClient:
            mock_instance = MagicMock()
            mock_instance.get = AsyncMock(
                return_value=_mock_response(500, None, text="internal error")
            )
            _configure_mock_client(MockClient, mock_instance)

            resp = auth_client.get(ROUTE)

        assert resp.status_code == 500

    def test_truncated_device_list_survives_the_hop(self, auth_client: TestClient):
        """`truncated: true` at the device cap must not be quietly cleared."""
        truncated_payload = {
            **COORD_PAYLOAD,
            "device_count": 100,
            "truncated": True,
        }
        with _patch_httpx() as MockClient:
            mock_instance = MagicMock()
            mock_instance.get = AsyncMock(
                return_value=_mock_response(200, truncated_payload)
            )
            _configure_mock_client(MockClient, mock_instance)

            resp = auth_client.get(ROUTE)

        body = resp.json()
        assert body["truncated"] is True
        assert body["device_count"] == 100
