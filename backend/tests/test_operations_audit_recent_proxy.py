"""Integration tests for the operator-audit proxy.

``GET /operations/coord/audit/recent`` is plan
``2026-08-20-fleet-page-runner-enable-disable-switch`` Phase 5, and it closes
that plan's §7 metric rather than adding a feature: coord has WRITTEN
``coord.operator_audit`` all along and mounts ``GET /admin/coord/audit/recent``
behind its admin router, but qontinui-web had no proxy — so the table was
written and unreadable from the console. §1 is the case: the 2026-08-20 delabel
of ``msi-wsl`` was later reversed and nothing anywhere records who did either.

Auth posture: ``require_coord_tenant_admin``, matching coord's own
``rbac::require_role(admin)`` gate on the route it fronts.

The two things under test are the forwarding grammar (coord owns the prefix
``*``, the RFC 3339 windows and the limit clamp) and the ``metadata``
pass-through, which is where the blast radius lives and which has no fixed
schema to normalise into.
"""

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

API_PREFIX = "/api/v1/operations"
AUDIT_PATH = f"{API_PREFIX}/coord/audit/recent"

_DRAIN_ROW = {
    "audit_id": "aaaaaaaa-0000-0000-0000-00000000000a",
    "operator_id": "11111111-1111-1111-1111-111111111111",
    "action": "fleet.drain.set",
    "resource_kind": "coord.fleet_runtime_policy",
    "resource_key": "drain:22222222-2222-2222-2222-222222222222",
    "metadata": {
        "device_id": "22222222-2222-2222-2222-222222222222",
        "drained": True,
        "until": "2026-09-01T12:00:00Z",
        "reason": "clippy failing 2/2 on this host",
        "version": 17,
    },
    "occurred_at": "2026-08-31T12:00:00Z",
}


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


class TestAuditRecentProxy:
    def test_proxies_the_admin_route(self, client: TestClient):
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = _mock_response(
                json_data={"audit": [_DRAIN_ROW], "count": 1}
            )
            _configure_mock_client(MockClient, instance)

            resp = client.get(AUDIT_PATH)

        assert resp.status_code == 200
        assert instance.get.call_args.args[0].endswith("/admin/coord/audit/recent")

    def test_sends_no_params_when_none_were_asked_for(self, client: TestClient):
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = _mock_response(
                json_data={"audit": [], "count": 0}
            )
            _configure_mock_client(MockClient, instance)

            client.get(AUDIT_PATH)

        assert instance.get.call_args.kwargs["params"] is None

    def test_forwards_the_prefix_grammar_verbatim(self, client: TestClient):
        """The trailing ``*`` IS the filter — coord turns it into a LIKE. A
        proxy that stripped or escaped it would silently narrow to an exact
        match on a literal ``fleet.*``, which matches nothing."""
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = _mock_response(
                json_data={"audit": [_DRAIN_ROW], "count": 1}
            )
            _configure_mock_client(MockClient, instance)

            client.get(f"{AUDIT_PATH}?action=fleet.*&limit=100")

        params = instance.get.call_args.kwargs["params"]
        assert params["action"] == "fleet.*"
        assert params["limit"] == 100

    def test_forwards_the_time_window(self, client: TestClient):
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = _mock_response(
                json_data={"audit": [], "count": 0}
            )
            _configure_mock_client(MockClient, instance)

            client.get(
                f"{AUDIT_PATH}?since=2026-08-01T00:00:00Z&before=2026-09-01T00:00:00Z"
            )

        params = instance.get.call_args.kwargs["params"]
        assert params["since"] == "2026-08-01T00:00:00Z"
        assert params["before"] == "2026-09-01T00:00:00Z"

    def test_metadata_passes_through_untouched(self, client: TestClient):
        """``metadata`` is where the blast radius lives and it has no fixed
        schema — ``operator_disable`` stamps ``affected_tenant_ids``, the kill
        switch stamps ``affected_repos``, a drain stamps ``device_id`` /
        ``until``. Normalising it here would drop whatever the next writer
        computes."""
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = _mock_response(
                json_data={"audit": [_DRAIN_ROW], "count": 1}
            )
            _configure_mock_client(MockClient, instance)

            body = client.get(AUDIT_PATH).json()

        assert body["audit"][0]["metadata"] == _DRAIN_ROW["metadata"]

    def test_an_unrecognised_blast_radius_key_survives(self, client: TestClient):
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = _mock_response(
                json_data={
                    "audit": [
                        {
                            **_DRAIN_ROW,
                            "metadata": {"affected_widgets": ["w-1", "w-2"]},
                        }
                    ],
                    "count": 1,
                }
            )
            _configure_mock_client(MockClient, instance)

            body = client.get(AUDIT_PATH).json()

        assert body["audit"][0]["metadata"]["affected_widgets"] == ["w-1", "w-2"]

    def test_an_empty_trail_is_served_as_an_empty_trail(self, client: TestClient):
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = _mock_response(
                json_data={"audit": [], "count": 0}
            )
            _configure_mock_client(MockClient, instance)

            resp = client.get(AUDIT_PATH)

        assert resp.status_code == 200
        assert resp.json() == {"audit": [], "count": 0}

    def test_coord_403_is_forwarded_rather_than_read_as_empty(self, client: TestClient):
        """A 403 means the account lacks coord's ``admin`` role. It must not
        degrade into "nobody has done anything"."""
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = _mock_response(
                status_code=403, json_data=None, text="forbidden"
            )
            _configure_mock_client(MockClient, instance)

            resp = client.get(AUDIT_PATH)

        assert resp.status_code == 403

    def test_a_zero_limit_is_refused_here(self, client: TestClient):
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            _configure_mock_client(MockClient, instance)

            resp = client.get(f"{AUDIT_PATH}?limit=0")

        assert resp.status_code == 422
        assert instance.get.await_count == 0
