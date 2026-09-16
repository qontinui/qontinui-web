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
        require_coord_tenant_admin_target,
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
        # `require_coord_tenant_admin_target` re-resolves the coord identity
        # to find the EFFECTIVE tenant, which would reach coord over its own
        # httpx client (in `app.services.coord_identity`, not the one these
        # tests patch). Overriding it keeps the proxy path under test.
        test_app.dependency_overrides[require_coord_tenant_admin_target] = lambda: (
            resolved
        )
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


class TestAddTenantMemberByEmail:
    """``POST /coord/tenant-members`` — plan
    ``2026-09-15-simplify-tenant-member-add-by-email`` Phase 1.

    The route above it (``POST /coord/members``) makes a tenant admin
    hand-type a Cognito ``sub`` and an SSO provider string to add one
    colleague. This one takes an email and a role, resolves the identity
    server-side, and composes coord's two existing operator writes.

    Cognito is mocked at ``cognito_admin.resolve_identity_for_email`` (the
    resolver's own behaviour is pinned in
    ``tests/services/test_cognito_identity_resolution.py``); coord is mocked
    the same way as every other test in this file.
    """

    TENANT = uuid4()

    def _client(self) -> TestClient:
        return TestClient(_build_test_app(server_tenant=self.TENANT))

    @staticmethod
    def _patch_resolver(**kwargs):
        return patch(
            "app.services.cognito_admin.resolve_identity_for_email",
            MagicMock(**kwargs),
        )

    def test_tenant_member_added_composes_both_coord_writes(self):
        from app.services.cognito_admin import CognitoIdentity

        upsert = _mock_response(json_data={"operator_id": "op-1"})
        grant = _mock_response(json_data={"ok": True})
        with (
            self._patch_resolver(
                return_value=CognitoIdentity(username="josh", sub="sub-9f3c")
            ),
            _patch_httpx() as MockClient,
        ):
            instance = AsyncMock()
            instance.post.side_effect = [upsert, grant]
            _configure_mock_client(MockClient, instance)
            resp = self._client().post(
                f"{API_PREFIX}/coord/tenant-members",
                json={"email": "colleague@x.io", "role": "admin"},
            )

        assert resp.status_code == 200
        assert resp.json() == {
            "status": "added",
            "operator_id": "op-1",
            "role": "admin",
        }

        first, second = instance.post.call_args_list
        assert first.args[0].endswith("/admin/coord/operators")
        # The RESOLVED sub goes on the wire — the caller never supplied one.
        assert first.kwargs["json"] == {
            "email": "colleague@x.io",
            "sso_subject": "sub-9f3c",
            "sso_provider": "cognito",
        }
        # The upsert must not carry `roles`: it guarantees the operator row
        # exists, it does not grant. Granting here would skip coord's
        # admin-in-target-tenant re-check on the roles route.
        assert "roles" not in first.kwargs["json"]

        assert second.args[0].endswith("/admin/coord/operators/op-1/roles")
        assert second.kwargs["json"] == {
            "role": "admin",
            "target_tenant_id": str(self.TENANT),
        }

    def test_tenant_member_operator_role_is_granted_verbatim(self):
        from app.services.cognito_admin import CognitoIdentity

        with (
            self._patch_resolver(
                return_value=CognitoIdentity(username="u1", sub="s-1")
            ),
            _patch_httpx() as MockClient,
        ):
            instance = AsyncMock()
            instance.post.side_effect = [
                _mock_response(json_data={"operator_id": "op-2"}),
                _mock_response(json_data={"ok": True}),
            ]
            _configure_mock_client(MockClient, instance)
            resp = self._client().post(
                f"{API_PREFIX}/coord/tenant-members",
                json={"email": "u1@x.io", "role": "operator"},
            )

        assert resp.status_code == 200
        assert resp.json()["role"] == "operator"
        assert instance.post.call_args_list[1].kwargs["json"]["role"] == "operator"

    def test_tenant_member_invite_required_writes_nothing(self):
        """No Cognito account -> ``invite_required`` and NOTHING written.

        Real invitation is a later phase. Creating the coord operator row
        anyway would leave a member the tenant can see and nobody can sign in
        as, and answering "added" would be a lie the admin only discovers
        when their colleague never arrives.
        """
        with self._patch_resolver(return_value=None), _patch_httpx() as MockClient:
            instance = AsyncMock()
            _configure_mock_client(MockClient, instance)
            resp = self._client().post(
                f"{API_PREFIX}/coord/tenant-members",
                json={"email": "stranger@x.io", "role": "operator"},
            )

        assert resp.status_code == 200
        assert resp.json() == {"status": "invite_required"}
        instance.post.assert_not_called()

    def test_tenant_member_ambiguous_email_is_409(self):
        from app.services.cognito_admin import CognitoAmbiguousEmailError

        with (
            self._patch_resolver(
                side_effect=CognitoAmbiguousEmailError(
                    "Multiple users match email: dupe@x.io"
                )
            ),
            _patch_httpx() as MockClient,
        ):
            instance = AsyncMock()
            _configure_mock_client(MockClient, instance)
            resp = self._client().post(
                f"{API_PREFIX}/coord/tenant-members",
                json={"email": "dupe@x.io", "role": "admin"},
            )

        assert resp.status_code == 409
        assert "dupe@x.io" in str(resp.json()["detail"])
        # Picking one of several matching humans is the thing 409 exists to
        # refuse, so nothing may have been written first.
        instance.post.assert_not_called()

    def test_tenant_member_cognito_failure_is_not_invite_required(self):
        """A broken pool must not read as "they have no account" — that is
        the misreport the resolver's full-paging fix exists to prevent, one
        layer up."""
        from app.services.cognito_admin import CognitoAdminError

        with (
            self._patch_resolver(side_effect=CognitoAdminError("ListUsers failed")),
            _patch_httpx() as MockClient,
        ):
            instance = AsyncMock()
            _configure_mock_client(MockClient, instance)
            resp = self._client().post(
                f"{API_PREFIX}/coord/tenant-members",
                json={"email": "u1@x.io", "role": "admin"},
            )

        assert resp.status_code == 502
        instance.post.assert_not_called()

    def test_tenant_member_coord_typed_403_passes_through_verbatim(self):
        """Coord's ``not_admin_in_target_tenant`` is an answer the dashboard
        can render. Collapsing it to a 500 would tell the admin the server
        broke when in fact their grant was refused, and why."""
        from app.services.cognito_admin import CognitoIdentity

        refusal = _mock_response(
            status_code=403,
            json_data={"error": "not_admin_in_target_tenant"},
            text='{"error":"not_admin_in_target_tenant"}',
        )
        with (
            self._patch_resolver(
                return_value=CognitoIdentity(username="u1", sub="s-1")
            ),
            _patch_httpx() as MockClient,
        ):
            instance = AsyncMock()
            instance.post.side_effect = [
                _mock_response(json_data={"operator_id": "op-3"}),
                refusal,
            ]
            _configure_mock_client(MockClient, instance)
            resp = self._client().post(
                f"{API_PREFIX}/coord/tenant-members",
                json={"email": "u1@x.io", "role": "admin"},
            )

        assert resp.status_code == 403
        assert resp.json()["detail"] == {"error": "not_admin_in_target_tenant"}

    def test_tenant_member_coord_upsert_without_operator_id_is_502(self):
        from app.services.cognito_admin import CognitoIdentity

        with (
            self._patch_resolver(
                return_value=CognitoIdentity(username="u1", sub="s-1")
            ),
            _patch_httpx() as MockClient,
        ):
            instance = AsyncMock()
            instance.post.side_effect = [_mock_response(json_data={"ok": True})]
            _configure_mock_client(MockClient, instance)
            resp = self._client().post(
                f"{API_PREFIX}/coord/tenant-members",
                json={"email": "u1@x.io", "role": "admin"},
            )

        assert resp.status_code == 502
        # The role grant is never attempted against an id we do not have.
        assert instance.post.call_count == 1


class TestTenantMemberBodyRefusesIdpFields:
    """The contract test for the whole plan.

    A body carrying ``sso_subject`` or ``sso_provider`` is REFUSED, not
    ignored. Ignoring would be quieter and worse: a client could keep sending
    them, a later edit could start reading them, and the surface where the
    caller decides which Cognito identity receives a tenant grant would be
    back without anyone deciding to bring it back.
    """

    @pytest.mark.parametrize(
        "extra",
        [
            {"sso_subject": "attacker-sub"},
            {"sso_provider": "cognito"},
            {"sso_subject": "attacker-sub", "sso_provider": "cognito"},
        ],
    )
    def test_tenant_member_body_rejects_idp_fields(self, extra):
        body = {"email": "u1@x.io", "role": "admin", **extra}
        with (
            patch("app.services.cognito_admin.resolve_identity_for_email") as resolver,
            _patch_httpx() as MockClient,
        ):
            instance = AsyncMock()
            _configure_mock_client(MockClient, instance)
            resp = TestClient(_build_test_app()).post(
                f"{API_PREFIX}/coord/tenant-members", json=body
            )

        assert resp.status_code == 422
        # Refused at the door: neither Cognito nor coord was touched.
        resolver.assert_not_called()
        instance.post.assert_not_called()

    @pytest.mark.parametrize("role", ["owner", "agent_supervisor", "", "Admin"])
    def test_tenant_member_role_outside_the_two_value_set_is_422(self, role):
        with (
            patch("app.services.cognito_admin.resolve_identity_for_email") as resolver,
            _patch_httpx() as MockClient,
        ):
            instance = AsyncMock()
            _configure_mock_client(MockClient, instance)
            resp = TestClient(_build_test_app()).post(
                f"{API_PREFIX}/coord/tenant-members",
                json={"email": "u1@x.io", "role": role},
            )

        assert resp.status_code == 422
        resolver.assert_not_called()

    def test_tenant_member_blank_email_is_refused(self):
        with (
            patch("app.services.cognito_admin.resolve_identity_for_email") as resolver,
            _patch_httpx() as MockClient,
        ):
            instance = AsyncMock()
            _configure_mock_client(MockClient, instance)
            client = TestClient(_build_test_app())
            empty = client.post(
                f"{API_PREFIX}/coord/tenant-members",
                json={"email": "", "role": "admin"},
            )
            whitespace = client.post(
                f"{API_PREFIX}/coord/tenant-members",
                json={"email": "   ", "role": "admin"},
            )

        assert empty.status_code == 422
        assert whitespace.status_code == 400
        resolver.assert_not_called()
