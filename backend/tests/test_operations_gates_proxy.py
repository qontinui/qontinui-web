"""Integration tests for the coord gates-dashboard proxy endpoints.

These endpoints (under ``/api/v1/operations/gates/*``) proxy gate state +
light management actions from coord so the ``/operations`` gates panel can
render and act without the browser hitting coord cross-origin.

Plan ``2026-06-05-plan-gate-web-surface-and-productization`` Phase 2 (the
new ``mute``/``unmute``/``snooze`` proxies) on top of the existing
``list``/``approve``/``reject`` proxies (plan
``2026-05-18-agent-spawn-coordination.md`` Phase 5).

Mirrors the testing pattern in ``test_operations_claims_proxy.py``:
minimal FastAPI app + mocked ``httpx.AsyncClient`` so no live coord is
needed.

The cross-tenant isolation test is the binding lesson from prior coord
read-auth work (plan §5 "Cross-tenant leak"): the tenant is derived
server-side from the authenticated operator (coord resolves it from the
forwarded bearer); a client-supplied ``?tenant_id=<other>`` must NEVER
influence the upstream coord call.
"""

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient


def _build_test_app(*, server_tenant=None, authenticated: bool = True) -> FastAPI:
    """Build a minimal FastAPI app exposing the operations router.

    ``server_tenant`` — the tenant the (overridden) ``get_tenant_id``
    dependency resolves from the authenticated operator. Passing a fixed
    value lets the isolation test prove the resolved tenant — not a
    client-supplied one — is what the proxy uses.
    """
    from app.api.deps import get_current_active_user_async
    from app.api.v1.endpoints.operations import (
        get_tenant_id,
        require_coord_tenant_admin,
    )
    from app.api.v1.endpoints.operations import router as operations_router

    test_app = FastAPI()
    if authenticated:
        mock_user = MagicMock()
        mock_user.id = uuid4()
        mock_user.email = "testuser@example.com"
        mock_user.is_active = True
        mock_user.is_verified = True
        test_app.dependency_overrides[get_current_active_user_async] = lambda: mock_user
        # get_tenant_id resolves the operator's home tenant server-side (in
        # prod from coord's /admin/coord/me over the forwarded bearer).
        # Override it so the proxy path doesn't hit a real DB / coord, and
        # so the isolation test can pin the *server-resolved* tenant.
        resolved = server_tenant if server_tenant is not None else uuid4()
        test_app.dependency_overrides[get_tenant_id] = lambda: resolved
        # The gate *mutation* actions (approve/reject/mute/unmute/snooze) are
        # admin-gated via require_coord_tenant_admin; in prod it resolves the
        # same home tenant AND asserts is_admin. Override it to the same
        # resolved tenant so these tests exercise the proxy path as a coord
        # admin without hitting a real coord.
        test_app.dependency_overrides[require_coord_tenant_admin] = lambda: resolved
    test_app.include_router(operations_router, prefix="/api/v1/operations")
    return test_app


@pytest.fixture()
def auth_client() -> TestClient:
    return TestClient(_build_test_app(authenticated=True))


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


API_PREFIX = "/api/v1/operations"


# ---------------------------------------------------------------------------
# GET /operations/gates/list
# ---------------------------------------------------------------------------


class TestGetGatesList:
    def test_returns_gates(self, auth_client: TestClient):
        coord_payload = {
            "gates": [
                {
                    "gate_id": "11111111-1111-1111-1111-111111111111",
                    "claim_kind": None,
                    "resource_key": None,
                    "plan_id": "22222222-2222-2222-2222-222222222222",
                    "phase_name": "Phase 1",
                    "predicate": {"kind": "operator_approval", "prompt": "ok?"},
                    "verdict": "open",
                    "verdict_reason": "awaiting operator",
                    "evaluated_at": "2026-06-05T12:00:00Z",
                }
            ],
            "count": 1,
        }
        mock_resp = _mock_response(json_data=coord_payload)
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)
            resp = auth_client.get(f"{API_PREFIX}/gates/list?verdict=open")
        assert resp.status_code == 200
        assert resp.json() == coord_payload
        called_url = instance.get.call_args.args[0]
        assert called_url.endswith("/coord/gates")
        called_params = instance.get.call_args.kwargs.get("params", {})
        assert called_params.get("verdict") == "open"

    def test_exclude_orphans_forwarded(self, auth_client: TestClient):
        """`exclude_orphans` passes through to coord verbatim (truthy string);
        omitting it must NOT inject the key (coord's default is the raw,
        unfiltered list)."""
        mock_resp = _mock_response(json_data={"gates": [], "count": 0})
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)
            resp = auth_client.get(f"{API_PREFIX}/gates/list?exclude_orphans=1")
        assert resp.status_code == 200
        called_params = instance.get.call_args.kwargs.get("params", {})
        assert called_params.get("exclude_orphans") == "1"

        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)
            resp = auth_client.get(f"{API_PREFIX}/gates/list")
        assert resp.status_code == 200
        called_params = instance.get.call_args.kwargs.get("params") or {}
        assert "exclude_orphans" not in called_params

    def test_coord_unreachable_returns_502(self, auth_client: TestClient):
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.side_effect = httpx.ConnectError("refused")
            _configure_mock_client(MockClient, instance)
            resp = auth_client.get(f"{API_PREFIX}/gates/list")
        assert resp.status_code == 502


# ---------------------------------------------------------------------------
# POST /operations/gates/{id}/approve | mute | unmute | snooze — happy path
# ---------------------------------------------------------------------------


class TestGateActionsHappyPath:
    GATE_ID = "33333333-3333-3333-3333-333333333333"

    def test_approve_proxies(self, auth_client: TestClient):
        mock_resp = _mock_response(
            json_data={"gate_id": self.GATE_ID, "verdict": "cleared"}
        )
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.post.return_value = mock_resp
            _configure_mock_client(MockClient, instance)
            resp = auth_client.post(f"{API_PREFIX}/gates/{self.GATE_ID}/approve")
        assert resp.status_code == 200
        called_url = instance.post.call_args.args[0]
        assert called_url.endswith(f"/coord/gates/{self.GATE_ID}/approve")

    def test_mute_proxies(self, auth_client: TestClient):
        mock_resp = _mock_response(json_data={"gate_id": self.GATE_ID, "muted": True})
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.post.return_value = mock_resp
            _configure_mock_client(MockClient, instance)
            resp = auth_client.post(f"{API_PREFIX}/gates/{self.GATE_ID}/mute")
        assert resp.status_code == 200
        assert resp.json()["muted"] is True
        called_url = instance.post.call_args.args[0]
        assert called_url.endswith(f"/coord/gates/{self.GATE_ID}/mute")
        # Empty body forwarded (mirrors approve's shape).
        assert instance.post.call_args.kwargs.get("json") == {}

    def test_unmute_proxies(self, auth_client: TestClient):
        mock_resp = _mock_response(json_data={"gate_id": self.GATE_ID, "muted": False})
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.post.return_value = mock_resp
            _configure_mock_client(MockClient, instance)
            resp = auth_client.post(f"{API_PREFIX}/gates/{self.GATE_ID}/unmute")
        assert resp.status_code == 200
        assert resp.json()["muted"] is False
        called_url = instance.post.call_args.args[0]
        assert called_url.endswith(f"/coord/gates/{self.GATE_ID}/unmute")

    def test_snooze_forwards_until(self, auth_client: TestClient):
        until = "2026-06-12T00:00:00Z"
        mock_resp = _mock_response(
            json_data={"gate_id": self.GATE_ID, "snoozed_until": until}
        )
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.post.return_value = mock_resp
            _configure_mock_client(MockClient, instance)
            resp = auth_client.post(
                f"{API_PREFIX}/gates/{self.GATE_ID}/snooze",
                json={"until": until},
            )
        assert resp.status_code == 200
        called_url = instance.post.call_args.args[0]
        assert called_url.endswith(f"/coord/gates/{self.GATE_ID}/snooze")
        # The until value is forwarded verbatim in the upstream body.
        assert instance.post.call_args.kwargs.get("json") == {"until": until}

    def test_coord_error_passed_through(self, auth_client: TestClient):
        # Proxying to a not-yet-deployed coord route surfaces the upstream
        # error verbatim (e.g. 404 while the coord PR is unmerged).
        mock_resp = _mock_response(status_code=404, text='{"error":"no such route"}')
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.post.return_value = mock_resp
            _configure_mock_client(MockClient, instance)
            resp = auth_client.post(f"{API_PREFIX}/gates/{self.GATE_ID}/mute")
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Cross-tenant isolation — the binding lesson (plan §5 "Cross-tenant leak")
# ---------------------------------------------------------------------------


class TestGatesTenantIsolation:
    """The proxy must derive the tenant server-side from the authenticated
    operator and NEVER let a client-supplied ``?tenant_id=`` influence the
    upstream coord call.

    Coord's ``TenantId`` extractor resolves the tenant from the forwarded
    Cognito bearer (``gate_routes.rs``), and the web proxy forwards ONLY
    that bearer (``_tenant_headers`` — no ``X-Qontinui-Tenant-Id`` header,
    no ``tenant_id`` query param). These tests assert the wire shape:
    whatever ``tenant_id`` the client tries to inject is absent from both
    the upstream URL and the upstream params/headers.
    """

    ATTACKER_TENANT = "99999999-9999-9999-9999-999999999999"

    def _client_with_fixed_tenant(self) -> tuple[TestClient, str]:
        server_tenant = uuid4()
        app = _build_test_app(server_tenant=server_tenant, authenticated=True)
        return TestClient(app), str(server_tenant)

    def test_list_ignores_client_supplied_tenant_id(self):
        client, _server_tenant = self._client_with_fixed_tenant()
        mock_resp = _mock_response(json_data={"gates": [], "count": 0})
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)
            # Client attempts to read another tenant's gates.
            resp = client.get(
                f"{API_PREFIX}/gates/list?tenant_id={self.ATTACKER_TENANT}"
            )
        assert resp.status_code == 200

        called_url = instance.get.call_args.args[0]
        called_params = instance.get.call_args.kwargs.get("params", {}) or {}
        called_headers = instance.get.call_args.kwargs.get("headers", {}) or {}

        # The attacker tenant never reaches coord — not in the URL, not in
        # the forwarded params, not in any forwarded header value.
        assert self.ATTACKER_TENANT not in called_url
        assert self.ATTACKER_TENANT not in str(called_params)
        assert self.ATTACKER_TENANT not in str(called_headers)
        # And no client-controllable tenant key is forwarded at all: the
        # web proxy does not put any tenant on the wire (coord derives it
        # from the bearer). ``tenant_id`` is an *unknown* query param to the
        # list endpoint, so FastAPI drops it; it must not have been
        # smuggled into the upstream params.
        assert "tenant_id" not in called_params

    def test_mute_ignores_client_supplied_tenant_id(self):
        client, _server_tenant = self._client_with_fixed_tenant()
        gate_id = "44444444-4444-4444-4444-444444444444"
        mock_resp = _mock_response(json_data={"gate_id": gate_id, "muted": True})
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.post.return_value = mock_resp
            _configure_mock_client(MockClient, instance)
            resp = client.post(
                f"{API_PREFIX}/gates/{gate_id}/mute?tenant_id={self.ATTACKER_TENANT}"
            )
        assert resp.status_code == 200

        called_url = instance.post.call_args.args[0]
        called_body = instance.post.call_args.kwargs.get("json", {}) or {}
        called_headers = instance.post.call_args.kwargs.get("headers", {}) or {}

        assert self.ATTACKER_TENANT not in called_url
        assert self.ATTACKER_TENANT not in str(called_body)
        assert self.ATTACKER_TENANT not in str(called_headers)
        # Mute forwards an empty body — no client-injected tenant rides along.
        assert called_body == {}

    def test_snooze_ignores_client_supplied_tenant_id(self):
        client, _server_tenant = self._client_with_fixed_tenant()
        gate_id = "55555555-5555-5555-5555-555555555555"
        until = "2026-06-12T00:00:00Z"
        mock_resp = _mock_response(
            json_data={"gate_id": gate_id, "snoozed_until": until}
        )
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.post.return_value = mock_resp
            _configure_mock_client(MockClient, instance)
            # Attacker tries to smuggle a tenant both in the query AND the body.
            resp = client.post(
                f"{API_PREFIX}/gates/{gate_id}/snooze?tenant_id={self.ATTACKER_TENANT}",
                json={"until": until, "tenant_id": self.ATTACKER_TENANT},
            )
        assert resp.status_code == 200

        called_url = instance.post.call_args.args[0]
        called_body = instance.post.call_args.kwargs.get("json", {}) or {}
        called_headers = instance.post.call_args.kwargs.get("headers", {}) or {}

        assert self.ATTACKER_TENANT not in called_url
        assert self.ATTACKER_TENANT not in str(called_headers)
        # Only the whitelisted ``until`` is forwarded; the body-injected
        # tenant_id is stripped (the handler reads only ``until``).
        assert called_body == {"until": until}
        assert "tenant_id" not in called_body
