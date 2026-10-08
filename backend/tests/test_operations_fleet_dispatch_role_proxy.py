"""The machine dispatch-role proxy — its wire body, its gate and its refusals.

Plan ``2026-10-02-fleet-machine-roles-workhorse-bench-ci-node`` Phase 6
(minimal). Two routes under ``/api/v1/operations``:

* ``GET /fleet/dispatch-roles`` — every machine's role, passed through
* ``PUT /fleet/dispatch-role``  — set one machine's role (operator-only)

The properties pinned here:

1. **The write is operator-only at THIS tier**, before any coord call — coord
   re-checks (§D9), but a proxy forwarding any member's write would make coord
   the only gate.
2. **The write body is CLOSED**: exactly one machine key, no client-asserted
   author, one of the three roles the table CHECKs.
3. **Coord's typed refusals survive the hop as STRUCTURED objects** with
   coord's own status — ``last_open_lane`` and ``no_agent_host`` call for
   different operator actions (one admits Force, the other does not), so the
   console must be able to tell them apart without parsing a string.
4. **A failed READ keeps its status**, so the browser renders UNKNOWN rather
   than "every machine unassigned".
"""

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID, uuid4

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

TEST_TENANT_ID = uuid4()
API_PREFIX = "/api/v1/operations"
READ_ROUTE = f"{API_PREFIX}/fleet/dispatch-roles"
WRITE_ROUTE = f"{API_PREFIX}/fleet/dispatch-role"

TEST_BEARER = "test-cognito-access-token"
DEVICE_ID = "3e7e4b04-75de-4efb-b718-c8ce8fcf7b17"


def _build_test_app() -> FastAPI:
    from app.api.deps import get_current_active_user_async
    from app.api.v1.endpoints import operations as operations_module
    from app.api.v1.endpoints.operations import (
        get_tenant_id,
        require_coord_tenant_admin,
    )
    from app.api.v1.endpoints.operations import router as operations_router

    test_app = FastAPI()
    mock_user = MagicMock()
    mock_user.id = uuid4()
    mock_user.is_active = True
    test_app.dependency_overrides[get_current_active_user_async] = lambda: mock_user

    async def _tenant_override() -> UUID:
        # `async def` is load-bearing: `_tenant_headers` reads the bearer out
        # of a ContextVar a sync dependency's worker thread would not reach.
        operations_module._caller_bearer.set(TEST_BEARER)
        return TEST_TENANT_ID

    test_app.dependency_overrides[get_tenant_id] = _tenant_override
    test_app.dependency_overrides[require_coord_tenant_admin] = _tenant_override
    test_app.include_router(operations_router, prefix="/api/v1/operations")
    return test_app


@pytest.fixture()
def auth_client() -> TestClient:
    return TestClient(_build_test_app())


def _mock_response(status_code: int = 200, json_data=None, text: str = "") -> MagicMock:
    resp = MagicMock(spec=httpx.Response)
    resp.status_code = status_code
    resp.json.return_value = json_data
    resp.text = text or (str(json_data) if json_data is not None else "")
    resp.content = (resp.text or "").encode()
    return resp


def _patch_httpx():
    return patch("app.api.v1.endpoints.operations.httpx.AsyncClient")


def _configure_mock_client(MockClient, mock_instance):
    mock_instance.__aenter__ = AsyncMock(return_value=mock_instance)
    mock_instance.__aexit__ = AsyncMock(return_value=False)
    MockClient.return_value = mock_instance


# ---------------------------------------------------------------------------
# GET /fleet/dispatch-roles
# ---------------------------------------------------------------------------


class TestReadRoles:
    def test_proxies_coords_read_untouched(self, auth_client: TestClient):
        body = {
            "machines": [
                {
                    "device_id": DEVICE_ID,
                    "name": "monster",
                    "dispatch_role": "unassigned",
                    "suggestion": {"role": "bench", "mem_total_bytes": 33e9},
                    "lanes": {
                        "agent": {"state": "closed_by_drain"},
                        "ci": {"state": "open"},
                    },
                    "a_field_a_newer_coord_adds": True,
                }
            ]
        }
        with _patch_httpx() as MockClient:
            mock_instance = MagicMock()
            mock_instance.get = AsyncMock(return_value=_mock_response(200, body))
            _configure_mock_client(MockClient, mock_instance)
            resp = auth_client.get(READ_ROUTE)

        assert resp.status_code == 200
        assert mock_instance.get.call_args[0][0].endswith("/coord/fleet/dispatch-roles")
        # The bearer rides along, so coord scopes the read to the operator.
        headers = mock_instance.get.call_args.kwargs["headers"]
        assert headers["Authorization"] == f"Bearer {TEST_BEARER}"
        # No response_model: nothing here filters a field coord adds.
        assert resp.json() == body

    @pytest.mark.parametrize("status", [404, 500])
    def test_a_failed_read_keeps_its_status(self, auth_client: TestClient, status):
        # The status is what lets the browser render UNKNOWN rather than
        # "every machine unassigned" (= every machine a workhorse).
        with _patch_httpx() as MockClient:
            mock_instance = MagicMock()
            mock_instance.get = AsyncMock(
                return_value=_mock_response(status, None, text="nope")
            )
            _configure_mock_client(MockClient, mock_instance)
            resp = auth_client.get(READ_ROUTE)
        assert resp.status_code == status

    def test_an_unreachable_coord_is_a_502(self, auth_client: TestClient):
        with _patch_httpx() as MockClient:
            mock_instance = MagicMock()
            mock_instance.get = AsyncMock(side_effect=httpx.ConnectError("refused"))
            _configure_mock_client(MockClient, mock_instance)
            resp = auth_client.get(READ_ROUTE)
        assert resp.status_code == 502


# ---------------------------------------------------------------------------
# PUT /fleet/dispatch-role
# ---------------------------------------------------------------------------


def _put(client: TestClient, payload: dict, coord_resp: MagicMock | None = None):
    with _patch_httpx() as MockClient:
        mock_instance = MagicMock()
        mock_instance.put = AsyncMock(
            return_value=coord_resp
            or _mock_response(200, {"dispatch_role": payload.get("dispatch_role")})
        )
        _configure_mock_client(MockClient, mock_instance)
        resp = client.put(WRITE_ROUTE, json=payload)
        return resp, mock_instance


class TestWriteBody:
    def test_device_keyed_write_sends_exactly_coords_fields(
        self, auth_client: TestClient
    ):
        resp, mock_instance = _put(
            auth_client,
            {"device_id": DEVICE_ID, "dispatch_role": "bench", "reason": " rebuild "},
        )
        assert resp.status_code == 200
        assert mock_instance.put.call_args[0][0].endswith("/coord/fleet/dispatch-role")
        sent = mock_instance.put.call_args.kwargs["json"]
        assert sent == {
            "device_id": DEVICE_ID,
            "dispatch_role": "bench",
            "reason": "rebuild",
            "force": False,
        }

    def test_host_keyed_write_for_an_unregistered_machine(
        self, auth_client: TestClient
    ):
        # dell-2020 / dell-2024 are not registered in coord (plan §0a): the
        # role is written against the host name and applies when a runner
        # registers under it.
        resp, mock_instance = _put(
            auth_client,
            {
                "ci_host_name": " dell-2020 ",
                "dispatch_role": "ci_node",
                "reason": "remote CI box",
                "force": True,
            },
        )
        assert resp.status_code == 200
        sent = mock_instance.put.call_args.kwargs["json"]
        assert sent == {
            "ci_host_name": "dell-2020",
            "dispatch_role": "ci_node",
            "reason": "remote CI box",
            "force": True,
        }

    @pytest.mark.parametrize(
        "payload",
        [
            # neither key
            {"dispatch_role": "bench", "reason": "r"},
            # both keys
            {
                "device_id": DEVICE_ID,
                "ci_host_name": "dell-2020",
                "dispatch_role": "bench",
                "reason": "r",
            },
            # a role the table CHECK does not admit
            {"device_id": DEVICE_ID, "dispatch_role": "unassigned", "reason": "r"},
            # blank reason
            {"device_id": DEVICE_ID, "dispatch_role": "bench", "reason": "   "},
            # missing reason
            {"device_id": DEVICE_ID, "dispatch_role": "bench"},
            # a client-asserted author
            {
                "device_id": DEVICE_ID,
                "dispatch_role": "bench",
                "reason": "r",
                "updated_by": "someone-else@example.com",
            },
            # whitespace inside a host name (mdroles_01's CHECK)
            {"ci_host_name": "dell 2020", "dispatch_role": "bench", "reason": "r"},
        ],
    )
    def test_malformed_bodies_never_reach_coord(
        self, auth_client: TestClient, payload: dict
    ):
        resp, mock_instance = _put(auth_client, payload)
        assert resp.status_code == 422
        assert mock_instance.put.await_count == 0


class TestRefusalsPassThrough:
    @pytest.mark.parametrize(
        ("status", "refusal"),
        [
            # Coord's own bodies (dispatch_role_routes.rs, plan Phase 3).
            (
                409,
                {
                    "error": "last_open_lane",
                    "detail": "pass `force: true` to apply it anyway",
                    "lanes": [
                        {"lane": "agent", "remaining": [], "offline_only": False}
                    ],
                },
            ),
            (422, {"error": "no_agent_host", "detail": "no workstation runner"}),
            (403, {"error": "admin_required"}),
        ],
    )
    def test_typed_refusal_arrives_structured_with_coords_status(
        self, auth_client: TestClient, status: int, refusal: dict
    ):
        resp, _ = _put(
            auth_client,
            {"device_id": DEVICE_ID, "dispatch_role": "workhorse", "reason": "r"},
            coord_resp=_mock_response(status, refusal),
        )
        assert resp.status_code == status
        # A dict, not an escaped string: the console branches on `error`.
        assert resp.json()["detail"] == refusal

    def test_a_non_json_refusal_falls_back_to_text(self, auth_client: TestClient):
        bad = _mock_response(400, None, text="<html>bad gateway</html>")
        bad.json.side_effect = ValueError("not json")
        resp, _ = _put(
            auth_client,
            {"device_id": DEVICE_ID, "dispatch_role": "bench", "reason": "r"},
            coord_resp=bad,
        )
        assert resp.status_code == 400
        assert resp.json()["detail"] == "<html>bad gateway</html>"


def test_the_write_is_admin_gated_before_any_coord_call() -> None:
    """``PUT`` gates on ``require_coord_tenant_admin`` at THIS tier.

    Every other write test overrides that dependency with a passing resolver,
    so without this case swapping the route to ``get_tenant_id`` would keep the
    suite green.
    """
    from fastapi import HTTPException

    from app.api.v1.endpoints.operations import require_coord_tenant_admin

    def _deny() -> None:
        raise HTTPException(status_code=403, detail="not_coord_tenant_admin")

    app = _build_test_app()
    app.dependency_overrides[require_coord_tenant_admin] = _deny
    client = TestClient(app)
    resp, mock_instance = _put(
        client, {"device_id": DEVICE_ID, "dispatch_role": "bench", "reason": "r"}
    )
    assert mock_instance.put.await_count == 0
    assert resp.status_code == 403
    assert "not_coord_tenant_admin" in resp.text
