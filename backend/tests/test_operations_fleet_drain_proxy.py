"""The machine drain / undrain proxy — its wire body and its refusals.

Plan ``2026-09-01-device-drain-does-not-reach-agent-session-spawning``
Phase 4b. Three routes under ``/api/v1/operations``:

* ``GET  /fleet/drain``    — which machines coord is holding out of the fleet
* ``POST /fleet/drain``    — hold one, until a REQUIRED deadline
* ``POST /fleet/undrain``  — release one early

The properties under test are the ones that make the surface honest rather
than merely working, and each is a rule this proxy would otherwise be free to
break silently:

1. **The write body is CLOSED and assembled here.** Coord's ``DrainRequest``
   and ``UndrainRequest`` are ``#[serde(deny_unknown_fields)]``, so one extra
   key is a 422 for the whole write. The browser's dict is never forwarded
   verbatim, and ``drained_by`` in particular can never reach the wire —
   coord stamps the author from its authenticated operator context, and an
   audit trail with a client-asserted author is not an audit trail.
2. **The expiry is mandatory and bounded**, mirroring coord's own
   ``validate_drain``: a drain with no deadline is how a machine silently
   leaves the fleet forever, and one 90 days out is a permanent removal
   wearing an expiry's clothes.
3. **Coord's status codes and typed refusals survive the hop.**
   ``admin_required`` and ``device_not_in_tenant`` are different facts calling
   for different next steps; collapsing them into "failed" leaves an operator
   unable to tell "you are not an admin" from "that machine is not yours".
4. **A failed READ is never dressed up as an empty one.** Coord keeps
   ``DrainSet::Known(vec![])`` and ``DrainSet::Unknown`` apart on purpose, and
   this hop adds no default that would undo it — the browser client renders
   UNKNOWN on a 404/5xx, which is only possible because the status arrives.

Same minimal-app + mocked-``httpx`` shape as
``test_operations_fleet_health_proxy.py``; no live coord is needed.
"""

from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID, uuid4

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

TEST_TENANT_ID = uuid4()
API_PREFIX = "/api/v1/operations"
READ_ROUTE = f"{API_PREFIX}/fleet/drain"
DRAIN_ROUTE = f"{API_PREFIX}/fleet/drain"
UNDRAIN_ROUTE = f"{API_PREFIX}/fleet/undrain"

TEST_BEARER = "test-cognito-access-token"
DEVICE_ID = "3f4c1a52-9a1e-4b6f-9f0f-8c2f0f0a11bd"


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
    mock_user.email = "testuser@example.com"
    mock_user.is_active = True
    mock_user.is_verified = True
    test_app.dependency_overrides[get_current_active_user_async] = lambda: mock_user

    async def _tenant_override() -> UUID:
        # `async def` is load-bearing: FastAPI runs a SYNC dependency in a
        # worker thread whose ContextVar writes never reach the request task,
        # and `_tenant_headers` reads the bearer back out of that ContextVar.
        operations_module._caller_bearer.set(TEST_BEARER)
        return TEST_TENANT_ID

    test_app.dependency_overrides[get_tenant_id] = _tenant_override
    # The admin gate itself is pinned in
    # `test_operations_coord_dashboard_proxy.py`; here it is setup. Coord
    # re-checks with `rbac::is_tenant_admin` plus a `coord.tenant_devices`
    # ownership floor, so this override widens nothing real.
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
    resp.text = text or (str(json_data) if json_data else "")
    return resp


def _patch_httpx():
    return patch("app.api.v1.endpoints.operations.httpx.AsyncClient")


def _configure_mock_client(MockClient, mock_instance):
    mock_instance.__aenter__ = AsyncMock(return_value=mock_instance)
    mock_instance.__aexit__ = AsyncMock(return_value=False)
    MockClient.return_value = mock_instance


def _future(hours: int = 4) -> str:
    return (datetime.now(UTC) + timedelta(hours=hours)).isoformat()


# ---------------------------------------------------------------------------
# GET /fleet/drain
# ---------------------------------------------------------------------------


class TestReadDrain:
    def test_proxies_coords_read_route(self, auth_client: TestClient):
        body = {
            "drained": {
                DEVICE_ID: {
                    "until": _future(),
                    "reason": "rebuilding the runner",
                    "drained_by": "jspinak@gmail.com",
                    "drained_at": datetime.now(UTC).isoformat(),
                }
            }
        }
        with _patch_httpx() as MockClient:
            mock_instance = MagicMock()
            mock_instance.get = AsyncMock(return_value=_mock_response(200, body))
            _configure_mock_client(MockClient, mock_instance)
            resp = auth_client.get(READ_ROUTE)

        assert resp.status_code == 200
        called_url = mock_instance.get.call_args[0][0]
        assert called_url.endswith("/coord/fleet/drain")
        # Passed through untouched — no `response_model` filters a field a
        # newer coord adds, and the four provenance fields are exactly what the
        # console renders as "drained until X by Y, reason Z".
        entry = resp.json()["drained"][DEVICE_ID]
        assert entry["drained_by"] == "jspinak@gmail.com"
        assert entry["reason"] == "rebuilding the runner"

    def test_carries_coords_redacted_actor_through_as_a_value(
        self, auth_client: TestClient
    ):
        # "someone drained this and you are not being told who" is a different
        # fact from "nobody is recorded". Coord ships the placeholder for that
        # reason; nothing here may normalise it to null.
        body = {
            "drained": {
                DEVICE_ID: {
                    "until": _future(),
                    "reason": "rebuild",
                    "drained_by": "[redacted]",
                    "drained_at": datetime.now(UTC).isoformat(),
                }
            }
        }
        with _patch_httpx() as MockClient:
            mock_instance = MagicMock()
            mock_instance.get = AsyncMock(return_value=_mock_response(200, body))
            _configure_mock_client(MockClient, mock_instance)
            resp = auth_client.get(READ_ROUTE)

        assert resp.json()["drained"][DEVICE_ID]["drained_by"] == "[redacted]"

    def test_a_404_from_coord_arrives_as_a_404(self, auth_client: TestClient):
        # The deploy window: this console is ahead of coord's read route. The
        # STATUS is what lets the browser render UNKNOWN instead of "nothing is
        # drained", so it must not be swallowed into a 200 with an empty body.
        with _patch_httpx() as MockClient:
            mock_instance = MagicMock()
            mock_instance.get = AsyncMock(
                return_value=_mock_response(404, None, text="not found")
            )
            _configure_mock_client(MockClient, mock_instance)
            resp = auth_client.get(READ_ROUTE)

        assert resp.status_code == 404

    def test_an_unreachable_coord_is_a_502_not_an_empty_drain_map(
        self, auth_client: TestClient
    ):
        with _patch_httpx() as MockClient:
            mock_instance = MagicMock()
            mock_instance.get = AsyncMock(side_effect=httpx.ConnectError("refused"))
            _configure_mock_client(MockClient, mock_instance)
            resp = auth_client.get(READ_ROUTE)

        assert resp.status_code == 502
        assert resp.json() == {"detail": "coord is not reachable"}


# ---------------------------------------------------------------------------
# POST /fleet/drain
# ---------------------------------------------------------------------------


class TestDrainWrite:
    def _post(self, client: TestClient, payload: dict):
        with _patch_httpx() as MockClient:
            mock_instance = MagicMock()
            mock_instance.post = AsyncMock(
                return_value=_mock_response(
                    200,
                    {
                        "device_id": DEVICE_ID,
                        "drained": True,
                        "changed": True,
                        "version": 12,
                    },
                )
            )
            _configure_mock_client(MockClient, mock_instance)
            resp = client.post(DRAIN_ROUTE, json=payload)
            return resp, mock_instance

    def test_sends_exactly_the_three_fields_coord_declares(
        self, auth_client: TestClient
    ):
        until = _future()
        resp, mock_instance = self._post(
            auth_client,
            {"device_id": DEVICE_ID, "until": until, "reason": "rebuilding"},
        )

        assert resp.status_code == 200
        called_url = mock_instance.post.call_args[0][0]
        assert called_url.endswith("/coord/fleet/drain")
        sent = mock_instance.post.call_args.kwargs["json"]
        # `deny_unknown_fields` on coord's side: one extra key is a 422 for the
        # whole write.
        assert set(sent) == {"device_id", "until", "reason"}
        assert sent["device_id"] == DEVICE_ID
        assert sent["reason"] == "rebuilding"

    def test_never_forwards_a_client_asserted_author(self, auth_client: TestClient):
        # An audit trail with a client-asserted author is not an audit trail,
        # and coord's own wire has no such field to spoof. The closed model
        # rejects it at the door rather than letting coord 422 it.
        resp = auth_client.post(
            DRAIN_ROUTE,
            json={
                "device_id": DEVICE_ID,
                "until": _future(),
                "reason": "rebuilding",
                "drained_by": "someone-else@example.com",
            },
        )
        assert resp.status_code == 422

    def test_requires_an_expiry(self, auth_client: TestClient):
        # There is no defaulted forever. §D2's mandatory deadline is the whole
        # reason a hard filter is safe.
        resp = auth_client.post(
            DRAIN_ROUTE, json={"device_id": DEVICE_ID, "reason": "rebuilding"}
        )
        assert resp.status_code == 422

    def test_rejects_a_past_expiry(self, auth_client: TestClient):
        resp = auth_client.post(
            DRAIN_ROUTE,
            json={
                "device_id": DEVICE_ID,
                "until": (datetime.now(UTC) - timedelta(minutes=1)).isoformat(),
                "reason": "rebuilding",
            },
        )
        assert resp.status_code == 422

    def test_rejects_an_expiry_beyond_coords_ceiling(self, auth_client: TestClient):
        resp = auth_client.post(
            DRAIN_ROUTE,
            json={
                "device_id": DEVICE_ID,
                "until": (datetime.now(UTC) + timedelta(days=90)).isoformat(),
                "reason": "rebuilding",
            },
        )
        assert resp.status_code == 422

    def test_rejects_a_blank_reason(self, auth_client: TestClient):
        # `min_length=1` alone admits "   ", which coord then refuses. The
        # reason is what the audit row and the other operators' alert say.
        resp = auth_client.post(
            DRAIN_ROUTE,
            json={"device_id": DEVICE_ID, "until": _future(), "reason": "   "},
        )
        assert resp.status_code == 422

    def test_rejects_a_device_id_that_is_not_a_uuid(self, auth_client: TestClient):
        resp = auth_client.post(
            DRAIN_ROUTE,
            json={"device_id": "spaceship", "until": _future(), "reason": "x"},
        )
        assert resp.status_code == 422

    def test_reads_a_naive_deadline_as_utc_rather_than_refusing_it(
        self, auth_client: TestClient
    ):
        naive = (datetime.now(UTC) + timedelta(hours=2)).replace(tzinfo=None)
        resp, _ = self._post(
            auth_client,
            {
                "device_id": DEVICE_ID,
                "until": naive.isoformat(),
                "reason": "rebuilding",
            },
        )
        assert resp.status_code == 200

    def test_surfaces_coords_typed_refusal_with_its_own_status(
        self, auth_client: TestClient
    ):
        # `device_not_in_tenant` and `admin_required` call for different next
        # steps; a collapsed "failed" leaves the operator unable to tell them
        # apart.
        with _patch_httpx() as MockClient:
            mock_instance = MagicMock()
            mock_instance.post = AsyncMock(
                return_value=_mock_response(
                    403,
                    {
                        "error": "device_not_in_tenant",
                        "detail": "this device is not bound to your tenant",
                    },
                )
            )
            _configure_mock_client(MockClient, mock_instance)
            resp = auth_client.post(
                DRAIN_ROUTE,
                json={
                    "device_id": DEVICE_ID,
                    "until": _future(),
                    "reason": "rebuilding",
                },
            )

        assert resp.status_code == 403
        assert resp.json()["detail"]["error"] == "device_not_in_tenant"


# ---------------------------------------------------------------------------
# POST /fleet/undrain
# ---------------------------------------------------------------------------


class TestUndrainWrite:
    def test_sends_device_id_and_reason_only(self, auth_client: TestClient):
        with _patch_httpx() as MockClient:
            mock_instance = MagicMock()
            mock_instance.post = AsyncMock(
                return_value=_mock_response(
                    200, {"device_id": DEVICE_ID, "drained": False, "changed": True}
                )
            )
            _configure_mock_client(MockClient, mock_instance)
            resp = auth_client.post(
                UNDRAIN_ROUTE,
                json={"device_id": DEVICE_ID, "reason": "rebuild finished"},
            )

        assert resp.status_code == 200
        assert mock_instance.post.call_args[0][0].endswith("/coord/fleet/undrain")
        sent = mock_instance.post.call_args.kwargs["json"]
        assert set(sent) == {"device_id", "reason"}

    def test_requires_a_reason(self, auth_client: TestClient):
        resp = auth_client.post(UNDRAIN_ROUTE, json={"device_id": DEVICE_ID})
        assert resp.status_code == 422

    def test_passes_a_no_op_release_through_rather_than_claiming_success(
        self, auth_client: TestClient
    ):
        # `changed: false` is an undrain of a machine that was not held. "I
        # released it" and "it was not held" are different outcomes.
        with _patch_httpx() as MockClient:
            mock_instance = MagicMock()
            mock_instance.post = AsyncMock(
                return_value=_mock_response(
                    200, {"device_id": DEVICE_ID, "drained": False, "changed": False}
                )
            )
            _configure_mock_client(MockClient, mock_instance)
            resp = auth_client.post(
                UNDRAIN_ROUTE, json={"device_id": DEVICE_ID, "reason": "already back"}
            )

        assert resp.status_code == 200
        assert resp.json()["changed"] is False
