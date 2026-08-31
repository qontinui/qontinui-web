"""Integration tests for the machine drain / undrain proxies.

``POST /operations/fleet/drain`` and ``POST /operations/fleet/undrain`` are
plan ``2026-08-20-fleet-page-runner-enable-disable-switch`` Phase 1: the web
proxy for coord's ``POST /coord/fleet/{drain,undrain}``, which have shipped
since ``2026-08-02-fleet-resource-telemetry-and-ci-allocation`` §D2 and which
qontinui-web had no way to reach.

Auth posture: ``require_coord_tenant_admin`` on BOTH — the same dependency as
``post_pr_merge_kill_switch``, whose shape these copy. Coord's own gate is
stricter still (an SSO ``OperatorContext`` holding ``admin`` PLUS the device
bound to that tenant), and it re-validates; this door exists so a
non-administrator never gets as far as a 403 from two services away.

What is under test here, and it is deliberately narrow:

1. The expiry is a FIRST-CLASS REQUIRED field. A drain with no ``until`` is
   refused at this door with a message naming the field — never defaulted, and
   never forwarded to coord to be rejected as an opaque serde error.
2. The body reaches coord verbatim on the right path, with the timestamp
   serialised as RFC 3339 so coord's ``DateTime<Utc>`` parses the instant the
   operator chose.
3. Coord's status codes and bodies come back unchanged — including the
   ``changed: false`` no-op arm, which must not be dressed up as a release.

Testing mirrors ``test_operations_blast_radius_proxy.py``: a minimal FastAPI
app with a mocked ``httpx.AsyncClient``, no live coord.
"""

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

API_PREFIX = "/api/v1/operations"
DEVICE_ID = "11111111-2222-3333-4444-555555555555"


def _build_test_app() -> FastAPI:
    from app.api.deps import get_current_active_user_async
    from app.api.v1.endpoints.operations import require_coord_tenant_admin
    from app.api.v1.endpoints.operations import router as operations_router

    test_app = FastAPI()
    mock_user = MagicMock()
    mock_user.id = uuid4()
    mock_user.email = "operator@example.com"
    mock_user.is_active = True
    mock_user.is_verified = True
    test_app.dependency_overrides[get_current_active_user_async] = lambda: mock_user
    test_app.dependency_overrides[require_coord_tenant_admin] = lambda: uuid4()
    test_app.include_router(operations_router, prefix=API_PREFIX)
    return test_app


@pytest.fixture()
def client() -> TestClient:
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


_DRAIN_OK = {
    "device_id": DEVICE_ID,
    "drained": True,
    "until": "2026-09-01T12:00:00Z",
    "reason": "clippy failing 2/2 on this host",
    "drained_by": "operator@example.com",
    "drained_at": "2026-08-31T12:00:00Z",
    "version": 17,
    "changed": True,
}


class TestFleetDrain:
    def test_forwards_to_coord_with_rfc3339_until(self, client: TestClient):
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.post.return_value = _mock_response(json_data=_DRAIN_OK)
            _configure_mock_client(MockClient, instance)

            resp = client.post(
                f"{API_PREFIX}/fleet/drain",
                json={
                    "device_id": DEVICE_ID,
                    "until": "2026-09-01T12:00:00Z",
                    "reason": "clippy failing 2/2 on this host",
                },
            )

        assert resp.status_code == 200
        assert resp.json() == _DRAIN_OK
        url = instance.post.call_args.args[0]
        assert url.endswith("/coord/fleet/drain")
        sent = instance.post.call_args.kwargs["json"]
        assert sent["device_id"] == DEVICE_ID
        assert sent["reason"] == "clippy failing 2/2 on this host"
        # Serialised, not a datetime object, and carrying an explicit offset so
        # coord's `DateTime<Utc>` parses the instant the operator chose.
        assert isinstance(sent["until"], str)
        assert sent["until"].startswith("2026-09-01T12:00:00")
        assert sent["until"].endswith("Z") or "+00:00" in sent["until"]

    def test_missing_until_is_refused_here_and_never_reaches_coord(
        self, client: TestClient
    ):
        """The expiry is the §D2 safety property — a missing one is not a
        default, it is a rejected request naming the field."""
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            _configure_mock_client(MockClient, instance)

            resp = client.post(
                f"{API_PREFIX}/fleet/drain",
                json={"device_id": DEVICE_ID, "reason": "because"},
            )

        assert resp.status_code == 422
        assert instance.post.await_count == 0
        locs = [tuple(e["loc"]) for e in resp.json()["detail"]]
        assert ("body", "until") in locs

    def test_naive_until_is_refused(self, client: TestClient):
        """A timestamp with no offset has no defined instant; coord would read
        it as UTC and silently move the deadline by the operator's offset."""
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            _configure_mock_client(MockClient, instance)

            resp = client.post(
                f"{API_PREFIX}/fleet/drain",
                json={
                    "device_id": DEVICE_ID,
                    "until": "2026-09-01T12:00:00",
                    "reason": "because",
                },
            )

        assert resp.status_code == 422
        assert instance.post.await_count == 0
        assert "UTC offset" in resp.text

    def test_blank_reason_is_refused(self, client: TestClient):
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            _configure_mock_client(MockClient, instance)

            resp = client.post(
                f"{API_PREFIX}/fleet/drain",
                json={
                    "device_id": DEVICE_ID,
                    "until": "2026-09-01T12:00:00Z",
                    "reason": "   ",
                },
            )

        assert resp.status_code == 422
        assert instance.post.await_count == 0

    def test_unknown_field_is_refused(self, client: TestClient):
        """Coord's struct carries ``deny_unknown_fields``; a typo must fail
        here with a field-level message rather than as a serde error."""
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            _configure_mock_client(MockClient, instance)

            resp = client.post(
                f"{API_PREFIX}/fleet/drain",
                json={
                    "device_id": DEVICE_ID,
                    "until": "2026-09-01T12:00:00Z",
                    "reason": "because",
                    "untill": "2026-09-01T12:00:00Z",
                },
            )

        assert resp.status_code == 422
        assert instance.post.await_count == 0

    def test_coord_400_is_forwarded(self, client: TestClient):
        """Coord owns the RANGE rule (``MAX_DRAIN_DAYS``, "must be in the
        future"); this proxy does not hold a second copy of it."""
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.post.return_value = _mock_response(
                status_code=400,
                json_data=None,
                text="until: must be at most 30 days out",
            )
            _configure_mock_client(MockClient, instance)

            resp = client.post(
                f"{API_PREFIX}/fleet/drain",
                json={
                    "device_id": DEVICE_ID,
                    "until": "2099-01-01T00:00:00Z",
                    "reason": "because",
                },
            )

        assert resp.status_code == 400
        assert "30 days" in resp.json()["detail"]


class TestFleetUndrain:
    def test_forwards_to_coord(self, client: TestClient):
        released = {**_DRAIN_OK, "drained": False, "until": None}
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.post.return_value = _mock_response(json_data=released)
            _configure_mock_client(MockClient, instance)

            resp = client.post(
                f"{API_PREFIX}/fleet/undrain",
                json={"device_id": DEVICE_ID, "reason": "host is healthy again"},
            )

        assert resp.status_code == 200
        assert resp.json()["drained"] is False
        assert instance.post.call_args.args[0].endswith("/coord/fleet/undrain")
        assert instance.post.call_args.kwargs["json"] == {
            "device_id": DEVICE_ID,
            "reason": "host is healthy again",
        }

    def test_no_op_release_is_reported_as_such(self, client: TestClient):
        """``changed: false`` must reach the console unchanged: coord writes no
        audit side effects when nothing changed, so "I released it" and "it was
        not held" are different answers."""
        no_op = {
            "device_id": DEVICE_ID,
            "drained": False,
            "until": None,
            "reason": None,
            "drained_by": None,
            "drained_at": None,
            "version": None,
            "changed": False,
        }
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.post.return_value = _mock_response(json_data=no_op)
            _configure_mock_client(MockClient, instance)

            resp = client.post(
                f"{API_PREFIX}/fleet/undrain",
                json={"device_id": DEVICE_ID, "reason": "just checking"},
            )

        assert resp.status_code == 200
        assert resp.json()["changed"] is False

    def test_undrain_takes_no_until(self, client: TestClient):
        """Releasing a hold has no deadline; offering one would invite the
        reader to think a release can be scheduled."""
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            _configure_mock_client(MockClient, instance)

            resp = client.post(
                f"{API_PREFIX}/fleet/undrain",
                json={
                    "device_id": DEVICE_ID,
                    "reason": "because",
                    "until": "2026-09-01T12:00:00Z",
                },
            )

        assert resp.status_code == 422
        assert instance.post.await_count == 0

    def test_blank_reason_is_refused(self, client: TestClient):
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            _configure_mock_client(MockClient, instance)

            resp = client.post(
                f"{API_PREFIX}/fleet/undrain",
                json={"device_id": DEVICE_ID, "reason": ""},
            )

        assert resp.status_code == 422
        assert instance.post.await_count == 0
