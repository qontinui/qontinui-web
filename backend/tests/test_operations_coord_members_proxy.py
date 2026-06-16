"""Integration tests for the coord tenant-member management admin-proxy.

These endpoints (under ``/api/v1/operations/coord/*``) let an authenticated
coordination ADMIN manage coord tenant members + roles from the dashboard,
forwarding their own Cognito bearer to coord's ``/admin/coord/*`` operator /
group-role endpoints.

Mirrors the testing pattern in ``test_operations_gates_proxy.py``: minimal
FastAPI app + mocked ``httpx.AsyncClient`` so no live coord is needed. The
``require_coord_tenant_admin`` gate is overridden to a fixed tenant so the
proxy path is exercised as a coord admin without hitting a real coord.

The DELETE-with-body cases are the load-bearing ones: coord's role-revoke +
group-mapping-delete take a JSON body, and the proxy must forward it (not
silently drop it).
"""

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient


def _build_test_app(*, server_tenant=None, authenticated: bool = True) -> FastAPI:
    from app.api.deps import get_current_active_user_async
    from app.api.v1.endpoints.operations import (
        require_coord_tenant_admin,
    )
    from app.api.v1.endpoints.operations import router as operations_router

    test_app = FastAPI()
    if authenticated:
        mock_user = MagicMock()
        mock_user.id = uuid4()
        mock_user.email = "admin@example.com"
        mock_user.is_active = True
        mock_user.is_verified = True
        test_app.dependency_overrides[get_current_active_user_async] = lambda: mock_user
        resolved = server_tenant if server_tenant is not None else uuid4()
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
    resp.content = b"x" if json_data is not None else b""
    resp.text = text or (str(json_data) if json_data else "")
    return resp


def _patch_httpx():
    return patch("app.api.v1.endpoints.operations.httpx.AsyncClient")


def _configure_mock_client(MockClient, mock_instance):
    mock_instance.__aenter__ = AsyncMock(return_value=mock_instance)
    mock_instance.__aexit__ = AsyncMock(return_value=False)
    MockClient.return_value = mock_instance


API_PREFIX = "/api/v1/operations"


class TestMembersGet:
    def test_list_members_proxies(self, auth_client: TestClient):
        payload = {"operators": [{"operator_id": "x", "email": "a@b.c", "roles": []}]}
        mock_resp = _mock_response(json_data=payload)
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)
            resp = auth_client.get(f"{API_PREFIX}/coord/members")
        assert resp.status_code == 200
        assert resp.json() == payload
        assert instance.get.call_args.args[0].endswith("/admin/coord/operators")

    def test_my_tenants_proxies(self, auth_client: TestClient):
        mock_resp = _mock_response(json_data={"is_admin": True, "tenants": []})
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)
            resp = auth_client.get(f"{API_PREFIX}/coord/my-tenants")
        assert resp.status_code == 200
        assert instance.get.call_args.args[0].endswith("/admin/coord/me")

    def test_group_roles_list_proxies(self, auth_client: TestClient):
        mock_resp = _mock_response(json_data={"group_tenant_roles": []})
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = mock_resp
            _configure_mock_client(MockClient, instance)
            resp = auth_client.get(f"{API_PREFIX}/coord/group-tenant-roles")
        assert resp.status_code == 200
        assert instance.get.call_args.args[0].endswith(
            "/admin/coord/group-tenant-roles"
        )


class TestMembersPost:
    def test_create_member_forwards_body(self, auth_client: TestClient):
        body = {"email": "new@x.io", "sso_subject": "sub1", "sso_provider": "cognito"}
        mock_resp = _mock_response(json_data={"operator_id": "op-1"})
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.post.return_value = mock_resp
            _configure_mock_client(MockClient, instance)
            resp = auth_client.post(f"{API_PREFIX}/coord/members", json=body)
        assert resp.status_code == 200
        assert instance.post.call_args.args[0].endswith("/admin/coord/operators")
        assert instance.post.call_args.kwargs.get("json") == body

    def test_grant_role_forwards_body_and_target(self, auth_client: TestClient):
        body = {"role": "admin", "target_tenant_id": "tid-2"}
        mock_resp = _mock_response(json_data={"ok": True})
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.post.return_value = mock_resp
            _configure_mock_client(MockClient, instance)
            resp = auth_client.post(f"{API_PREFIX}/coord/members/op-9/roles", json=body)
        assert resp.status_code == 200
        assert instance.post.call_args.args[0].endswith(
            "/admin/coord/operators/op-9/roles"
        )
        assert instance.post.call_args.kwargs.get("json") == body

    def test_create_group_role_forwards_body(self, auth_client: TestClient):
        body = {
            "group_id": "g1",
            "tenant_slug": "pizzeria",
            "role": "operator",
            "auto_create_tenant": False,
        }
        mock_resp = _mock_response(json_data=body)
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.post.return_value = mock_resp
            _configure_mock_client(MockClient, instance)
            resp = auth_client.post(f"{API_PREFIX}/coord/group-tenant-roles", json=body)
        assert resp.status_code == 200
        assert instance.post.call_args.args[0].endswith(
            "/admin/coord/group-tenant-roles"
        )
        assert instance.post.call_args.kwargs.get("json") == body


class TestMembersDeleteWithBody:
    """The load-bearing case: DELETE must forward the JSON body to coord."""

    def test_revoke_role_forwards_body_on_delete(self, auth_client: TestClient):
        body = {"role": "admin"}
        mock_resp = _mock_response(json_data={"ok": True})
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.request.return_value = mock_resp
            _configure_mock_client(MockClient, instance)
            resp = auth_client.request(
                "DELETE", f"{API_PREFIX}/coord/members/op-9/roles", json=body
            )
        assert resp.status_code == 200
        # Body-bearing DELETE routes through client.request("DELETE", ...).
        method, url = (
            instance.request.call_args.args[0],
            instance.request.call_args.args[1],
        )
        assert method == "DELETE"
        assert url.endswith("/admin/coord/operators/op-9/roles")
        assert instance.request.call_args.kwargs.get("json") == body
        instance.delete.assert_not_called()

    def test_delete_group_role_forwards_body_on_delete(self, auth_client: TestClient):
        body = {"group_id": "g1", "tenant_slug": "pizzeria", "role": "operator"}
        mock_resp = _mock_response(json_data={"ok": True, "deleted": 1})
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.request.return_value = mock_resp
            _configure_mock_client(MockClient, instance)
            resp = auth_client.request(
                "DELETE", f"{API_PREFIX}/coord/group-tenant-roles", json=body
            )
        assert resp.status_code == 200
        method, url = (
            instance.request.call_args.args[0],
            instance.request.call_args.args[1],
        )
        assert method == "DELETE"
        assert url.endswith("/admin/coord/group-tenant-roles")
        assert instance.request.call_args.kwargs.get("json") == body


class TestCoordErrorPassthrough:
    def test_coord_403_passed_through(self, auth_client: TestClient):
        mock_resp = _mock_response(
            status_code=403, text='{"error":"not_admin_in_target_tenant"}'
        )
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.post.return_value = mock_resp
            _configure_mock_client(MockClient, instance)
            resp = auth_client.post(
                f"{API_PREFIX}/coord/members/op-9/roles",
                json={"role": "admin", "target_tenant_id": "other"},
            )
        assert resp.status_code == 403

    def test_coord_unreachable_returns_502(self, auth_client: TestClient):
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.side_effect = httpx.ConnectError("refused")
            _configure_mock_client(MockClient, instance)
            resp = auth_client.get(f"{API_PREFIX}/coord/members")
        assert resp.status_code == 502
