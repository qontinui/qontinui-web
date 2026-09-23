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
from uuid import UUID, uuid4

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from slowapi.errors import RateLimitExceeded
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.middleware.error_handler import http_exception_handler
from app.middleware.rate_limit import rate_limit_exceeded_handler, user_limiter


def _build_test_app(
    *,
    server_tenant=None,
    authenticated: bool = True,
    override_target_gate: bool = True,
    real_error_envelope: bool = False,
    superuser: bool = False,
) -> FastAPI:
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
        # Set explicitly. The route reads `is_superuser is True`, so a bare
        # MagicMock attribute would make every caller a NON-superuser and the
        # superuser tests would fail for the wrong reason.
        mock_user.is_superuser = superuser
        test_app.dependency_overrides[get_current_active_user_async] = lambda: mock_user
        resolved = server_tenant if server_tenant is not None else uuid4()
        test_app.dependency_overrides[require_coord_tenant_admin] = lambda: resolved
        # `require_coord_tenant_admin_target` re-resolves the coord identity
        # to find the EFFECTIVE tenant, which would reach coord over its own
        # httpx client (in `app.services.coord_identity`, not the one these
        # tests patch). Overriding it keeps the proxy path under test.
        #
        # It also DEFEATS the thing that gate exists for, which is why
        # `override_target_gate=False` exists: with both gates pinned to one
        # uuid, "the write targeted the effective tenant" is an assertion
        # about the override and would pass byte-identically against the
        # `Depends(require_coord_tenant_admin)` bug the gate replaced. The
        # tests in `TestTheGrantTargetsTheEffectiveTenant` turn it off and
        # patch `get_coord_identity` instead, so home and effective differ.
        if override_target_gate:
            test_app.dependency_overrides[require_coord_tenant_admin_target] = lambda: (
                resolved
            )
    # Rate-limited routes raise `RateLimitExceeded`; without its handler a
    # throttled call is a 500 that says nothing about the limit.
    test_app.add_exception_handler(RateLimitExceeded, rate_limit_exceeded_handler)
    if real_error_envelope:
        # What a BROWSER receives. `app/main.py` registers this over FastAPI's
        # default handler, and it rewrites every `HTTPException` into
        # `{error, message, timestamp, path, …}` — with no `detail` key at
        # all. Every other test here builds a bare `FastAPI()` and so sees the
        # default `{"detail": …}` shape, which is not what ships.
        test_app.add_exception_handler(StarletteHTTPException, http_exception_handler)
    test_app.include_router(operations_router, prefix="/api/v1/operations")
    return test_app


@pytest.fixture(autouse=True)
def _fresh_rate_limit_bucket():
    """One budget per test. `POST /coord/tenant-members` is rate-limited per
    caller, and every test here presents the same (absent) credential, so an
    unreset bucket would leak one test's calls into the next one's."""
    user_limiter.reset()
    yield
    user_limiter.reset()


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


def _recording(order, name, mock):
    """A ``side_effect`` that logs ``name`` into ``order``, then behaves the
    way ``mock`` was configured: its original ``side_effect`` exception or
    function, else its ``return_value``."""
    original = mock.side_effect

    def _call(*args, **kwargs):
        order.append(name)
        if isinstance(original, BaseException):
            raise original
        if callable(original):
            return original(*args, **kwargs)
        return mock.return_value

    return _call


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

    The old raw proxy (``POST /coord/members``) made a tenant admin
    hand-type a Cognito ``sub`` and an SSO provider string to add one
    colleague, and was deleted once nothing called it any more (coord
    finding 130b6938). This route takes an email and a role, resolves the
    identity server-side, and composes coord's two existing operator writes.

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

    # ---- Phase 3: inviting somebody with no account -----------------------

    @staticmethod
    def _pending(username="new@x.io", sub="s-new"):
        from app.services.cognito_admin import (
            INVITATION_PENDING_STATUS,
            CognitoIdentity,
        )

        return CognitoIdentity(
            username=username, sub=sub, status=INVITATION_PENDING_STATUS
        )

    @staticmethod
    def _confirmed(username="u1", sub="s-1"):
        from app.services.cognito_admin import CognitoIdentity

        return CognitoIdentity(username=username, sub=sub, status="CONFIRMED")

    def _post_with(
        self,
        *,
        resolver,
        create=None,
        send=None,
        coord=None,
        email="new@x.io",
        superuser=True,
    ):
        """Drive the route with Cognito and coord mocked.

        Returns a namespace with the response, the coord mock, each Cognito
        mock, and ``order`` — how the Cognito and coord calls interleaved.
        """
        from types import SimpleNamespace

        order: list[str] = []
        mocks = SimpleNamespace(
            resolver=resolver,
            create=create or MagicMock(return_value=self._pending()),
            send=send or MagicMock(return_value=None),
        )
        for name in ("create", "send"):
            mock = getattr(mocks, name)
            mock.side_effect = _recording(order, name, mock)
        coord_responses = list(
            coord
            or [
                _mock_response(json_data={"operator_id": "op-new"}),
                _mock_response(json_data={"ok": True}),
            ]
        )
        with (
            patch(
                "app.services.cognito_admin.resolve_identity_for_email",
                mocks.resolver,
            ),
            patch("app.services.cognito_admin.create_invited_user", mocks.create),
            patch("app.services.cognito_admin.send_invitation", mocks.send),
            _patch_httpx() as MockClient,
        ):
            instance = AsyncMock()

            async def _post(url, *args, **kwargs):
                order.append("coord:" + url.rsplit("/admin/coord", 1)[-1])
                return coord_responses.pop(0)

            instance.post.side_effect = _post
            _configure_mock_client(MockClient, instance)
            client = TestClient(
                _build_test_app(server_tenant=self.TENANT, superuser=superuser)
            )
            mocks.resp = client.post(
                f"{API_PREFIX}/coord/tenant-members",
                json={"email": email, "role": "operator"},
            )
        mocks.coord = instance
        mocks.order = order
        return mocks

    def test_superuser_invite_sends_the_email_after_the_grant(self):
        r = self._post_with(resolver=MagicMock(return_value=None))

        assert r.resp.status_code == 200
        assert r.resp.json() == {
            "status": "invited",
            "operator_id": "op-new",
            "role": "operator",
        }
        r.create.assert_called_once_with("new@x.io")
        # Addressed by pool Username alone — no attributes on a RESEND.
        r.send.assert_called_once_with("new@x.io")
        # Account first (it mints the sub), grant second, email LAST: an
        # invitation must never go out for access that was then refused.
        assert r.order == [
            "create",
            "coord:/operators",
            "coord:/operators/op-new/roles",
            "send",
        ]

    def test_tenant_admin_cannot_create_an_account(self):
        """Invite-only: the pool's allowlist exempts AdminCreateUser, and
        every signed-in user administers a personal tenant. A tenant admin
        naming an unknown email must create nothing and send nothing."""
        r = self._post_with(resolver=MagicMock(return_value=None), superuser=False)

        assert r.resp.status_code == 200
        assert r.resp.json() == {"status": "invite_required"}
        r.create.assert_not_called()
        r.send.assert_not_called()
        r.coord.post.assert_not_called()

    def test_tenant_admin_can_still_add_an_existing_account(self):
        r = self._post_with(
            resolver=MagicMock(return_value=self._confirmed()), superuser=False
        )

        assert r.resp.status_code == 200
        assert r.resp.json()["status"] == "added"
        r.send.assert_not_called()

    def test_tenant_admin_granting_a_pending_invitee_sends_nothing(self):
        r = self._post_with(
            resolver=MagicMock(return_value=self._pending(username="Pending")),
            superuser=False,
        )

        assert r.resp.status_code == 200
        assert r.resp.json()["status"] == "invitation_pending"
        assert r.coord.post.call_count == 2
        r.create.assert_not_called()
        r.send.assert_not_called()

    def test_invite_upserts_the_cognito_assigned_sub(self):
        r = self._post_with(
            resolver=MagicMock(return_value=None),
            create=MagicMock(return_value=self._pending(sub="cognito-assigned")),
        )

        assert r.resp.status_code == 200
        upsert = r.coord.post.call_args_list[0]
        assert upsert.kwargs["json"]["sso_subject"] == "cognito-assigned"
        assert "roles" not in upsert.kwargs["json"]

    def test_pending_invite_is_regranted_and_resent(self):
        """Adding somebody again before they accept is how an admin recovers
        a lost or expired invitation: no second account, and a fresh send."""
        r = self._post_with(
            resolver=MagicMock(
                return_value=self._pending(username="Existing-User", sub="s-old")
            )
        )

        assert r.resp.status_code == 200
        assert r.resp.json()["status"] == "invited"
        r.create.assert_not_called()
        r.send.assert_called_once_with("Existing-User")

    def test_confirmed_account_is_added_without_email(self):
        r = self._post_with(resolver=MagicMock(return_value=self._confirmed()))

        assert r.resp.status_code == 200
        assert r.resp.json()["status"] == "added"
        r.create.assert_not_called()
        r.send.assert_not_called()

    def test_concurrent_create_resolves_the_raced_account(self):
        from app.services.cognito_admin import CognitoUserExistsError

        r = self._post_with(
            resolver=MagicMock(side_effect=[None, self._pending("raced", "s-r")]),
            create=MagicMock(side_effect=CognitoUserExistsError("exists")),
        )

        assert r.resp.status_code == 200
        assert r.coord.post.call_args_list[0].kwargs["json"]["sso_subject"] == "s-r"
        r.send.assert_called_once_with("raced")

    def test_refused_grant_after_a_create_sends_nothing_and_keeps_the_account(
        self,
    ):
        """Nothing is sent, and nothing is deleted: the pending account is
        inert, and a retry converges on it (see the next test)."""
        refusal = _mock_response(
            status_code=403, json_data={"error": "not_admin_in_target_tenant"}
        )
        with patch("app.services.cognito_admin._get_client") as get_client:
            r = self._post_with(
                resolver=MagicMock(return_value=None),
                coord=[_mock_response(json_data={"operator_id": "op-new"}), refusal],
            )

        assert r.resp.status_code == 403
        r.create.assert_called_once()
        r.send.assert_not_called()
        get_client.assert_not_called()

    def test_a_retry_after_a_refused_grant_converges_on_the_same_account(self):
        """Two requests against one pool: the first creates and is refused,
        the second finds that account pending and completes it — same sub,
        no second account."""
        made = self._pending(username="kept", sub="s-kept")
        pool: list = []

        def resolve(_email):
            return pool[0] if pool else None

        def create(_email):
            pool.append(made)
            return made

        refusal = _mock_response(
            status_code=403, json_data={"error": "not_admin_in_target_tenant"}
        )
        first = self._post_with(
            resolver=MagicMock(side_effect=resolve),
            create=MagicMock(side_effect=create),
            coord=[_mock_response(json_data={"operator_id": "op-k"}), refusal],
        )
        second = self._post_with(
            resolver=MagicMock(side_effect=resolve),
            create=MagicMock(side_effect=create),
            coord=[
                _mock_response(json_data={"operator_id": "op-k"}),
                _mock_response(json_data={"ok": True}),
            ],
        )

        assert first.resp.status_code == 403
        assert second.resp.status_code == 200
        assert second.resp.json()["status"] == "invited"
        second.create.assert_not_called()
        assert len(pool) == 1
        upserted = second.coord.post.call_args_list[0].kwargs["json"]["sso_subject"]
        assert upserted == "s-kept"
        second.send.assert_called_once_with("kept")

    def test_a_race_that_finds_two_accounts_is_409(self):
        from app.services.cognito_admin import (
            CognitoAmbiguousEmailError,
            CognitoUserExistsError,
        )

        r = self._post_with(
            resolver=MagicMock(side_effect=[None, CognitoAmbiguousEmailError("two")]),
            create=MagicMock(side_effect=CognitoUserExistsError("exists")),
        )

        assert r.resp.status_code == 409
        r.coord.post.assert_not_called()
        r.send.assert_not_called()

    def test_an_address_cognito_rejects_on_create_is_400(self):
        from app.services.cognito_admin import CognitoInvalidParameterError

        r = self._post_with(
            resolver=MagicMock(return_value=None),
            create=MagicMock(
                side_effect=CognitoInvalidParameterError(
                    "Invalid email address format."
                )
            ),
        )

        assert r.resp.status_code == 400
        assert "Invalid email address format" in str(r.resp.json())
        r.coord.post.assert_not_called()

    def test_a_new_account_and_its_coord_row_are_lowercase(self):
        resolver = MagicMock(return_value=None)
        r = self._post_with(resolver=resolver, email="Stefan@X.io")

        assert r.resp.status_code == 200
        resolver.assert_called_once_with("Stefan@X.io")
        r.create.assert_called_once_with("stefan@x.io")
        assert r.coord.post.call_args_list[0].kwargs["json"]["email"] == "stefan@x.io"

    def test_a_race_that_returns_an_accepted_account_is_added(self):
        from app.services.cognito_admin import CognitoUserExistsError

        r = self._post_with(
            resolver=MagicMock(side_effect=[None, self._confirmed("won", "s-w")]),
            create=MagicMock(side_effect=CognitoUserExistsError("exists")),
        )

        assert r.resp.status_code == 200
        assert r.resp.json()["status"] == "added"
        r.send.assert_not_called()

    def test_a_race_whose_account_cannot_be_found_is_502(self):
        from app.services.cognito_admin import CognitoUserExistsError

        r = self._post_with(
            resolver=MagicMock(side_effect=[None, None]),
            create=MagicMock(side_effect=CognitoUserExistsError("exists")),
        )

        assert r.resp.status_code == 502
        r.coord.post.assert_not_called()
        r.send.assert_not_called()

    def test_create_failure_writes_nothing(self):
        from app.services.cognito_admin import CognitoAdminError

        r = self._post_with(
            resolver=MagicMock(return_value=None),
            create=MagicMock(side_effect=CognitoAdminError("AccessDenied")),
        )

        assert r.resp.status_code == 502
        r.coord.post.assert_not_called()
        r.send.assert_not_called()

    def test_unsent_invitation_says_access_was_granted(self):
        """The grant landed and the email did not. A bare failure would send
        the admin hunting for a grant that exists; a success would leave the
        invitee with no way in."""
        from app.services.cognito_admin import CognitoAdminError

        r = self._post_with(
            resolver=MagicMock(return_value=None),
            send=MagicMock(side_effect=CognitoAdminError("SES down")),
        )

        assert r.resp.status_code == 502
        assert r.coord.post.call_count == 2
        detail = r.resp.json()["detail"]
        assert detail["error"] == "invitation_not_sent"
        assert "given access" in detail["message"]

    def test_an_invitation_accepted_mid_request_reads_as_added(self):
        from app.services.cognito_admin import CognitoAdminError

        r = self._post_with(
            resolver=MagicMock(return_value=self._pending()),
            send=MagicMock(
                side_effect=CognitoAdminError(
                    "state", aws_error_code="UnsupportedUserStateException"
                )
            ),
        )

        assert r.resp.status_code == 200
        assert r.resp.json()["status"] == "added"

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

    def test_tenant_member_cognito_failure_is_not_an_invitation(self):
        """A broken pool must not read as "they have no account" — that is
        the misreport the resolver's full-paging fix exists to prevent, one
        layer up, and here it would also mint a duplicate account."""
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
        detail = resp.json()["detail"]
        # Coord's typed key survives the hop unchanged — the dashboard
        # branches on it.
        assert detail["error"] == "not_admin_in_target_tenant"
        # …and a human sentence rides along. Without it the production error
        # envelope renders `str(detail)` — a Python `repr` of this dict — in
        # the one field the operator reads. See
        # `TestTenantMemberErrorsReachTheBrowser`.
        assert "not_admin_in_target_tenant" in detail["message"]
        assert not detail["message"].startswith("{")

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


# ---------------------------------------------------------------------------
# The shape a BROWSER receives, and the pace bound on the route
# ---------------------------------------------------------------------------


class TestTenantMemberErrorsReachTheBrowser:
    """Every refusal on this route, as a browser actually receives it.

    Every other test in this file builds a bare ``FastAPI()``, which uses
    FastAPI's default handler and renders ``{"detail": ...}``. The deployed
    app does NOT: ``app/main.py`` registers
    ``app.middleware.error_handler.http_exception_handler`` for every
    ``StarletteHTTPException``, and it rewrites the body into
    ``{"error", "message", "timestamp", "path", ...}`` — **there is no**
    ``detail`` **key in a production error body at all**.

    That matters more here than on a route that only answers strings: this
    one opted into ``structured_errors=True`` precisely so coord's
    ``403 not_admin_in_target_tenant`` would reach the dashboard. A dict
    detail with no ``message`` key makes that handler fall back to
    ``str(detail_value)`` — a Python ``repr`` of a dict — in the single field
    the operator reads.
    """

    TENANT = uuid4()

    def _client(self) -> TestClient:
        return TestClient(
            _build_test_app(server_tenant=self.TENANT, real_error_envelope=True)
        )

    @staticmethod
    def _patch_resolver(**kwargs):
        return patch(
            "app.services.cognito_admin.resolve_identity_for_email",
            MagicMock(**kwargs),
        )

    def _post_with_coord_refusal(self, refusal):
        from app.services.cognito_admin import CognitoIdentity

        with (
            self._patch_resolver(
                return_value=CognitoIdentity(username="u1", sub="s-1")
            ),
            _patch_httpx() as MockClient,
        ):
            instance = AsyncMock()
            instance.post.side_effect = [
                _mock_response(json_data={"operator_id": "op-1"}),
                refusal,
            ]
            _configure_mock_client(MockClient, instance)
            return self._client().post(
                f"{API_PREFIX}/coord/tenant-members",
                json={"email": "u1@x.io", "role": "admin"},
            )

    def test_a_coord_typed_refusal_carries_a_readable_message(self):
        resp = self._post_with_coord_refusal(
            _mock_response(
                status_code=403,
                json_data={"error": "not_admin_in_target_tenant"},
                text='{"error":"not_admin_in_target_tenant"}',
            )
        )

        assert resp.status_code == 403
        body = resp.json()
        # The envelope, not FastAPI's default.
        assert "detail" not in body
        # coord's typed code is spliced to the top level, for the branch...
        assert body["error"] == "not_admin_in_target_tenant"
        # ...and the sentence beside it names the refusal. The two defects
        # this pins are precise: a Python repr of coord's dict reaching the
        # operator, and the frontend finding no sentence and printing a bare
        # `HTTP 403`.
        assert "not_admin_in_target_tenant" in body["message"]
        assert not body["message"].startswith("{")
        assert "'error'" not in body["message"]

    def test_a_coord_hint_is_appended_to_the_sentence(self):
        resp = self._post_with_coord_refusal(
            _mock_response(
                status_code=409,
                json_data={
                    "error": "role_already_granted",
                    "hint": "revoke it first",
                },
                text="{}",
            )
        )

        assert resp.status_code == 409
        body = resp.json()
        assert "role_already_granted" in body["message"]
        assert "revoke it first" in body["message"]
        # The typed fields still ride along for a machine reader.
        assert body["hint"] == "revoke it first"

    def test_coords_own_message_is_never_overwritten(self):
        """A coord that grew a ``message`` knows more than anything composed
        on this side, so the composed sentence must not replace it."""
        resp = self._post_with_coord_refusal(
            _mock_response(
                status_code=403,
                json_data={
                    "error": "not_admin_in_target_tenant",
                    "message": "You administer acme, not globex.",
                },
                text="{}",
            )
        )

        assert resp.json()["message"] == "You administer acme, not globex."

    def test_the_blank_email_400_reaches_the_browser_as_a_sentence(self):
        with (
            patch("app.services.cognito_admin.resolve_identity_for_email") as resolver,
            _patch_httpx() as MockClient,
        ):
            _configure_mock_client(MockClient, AsyncMock())
            resp = self._client().post(
                f"{API_PREFIX}/coord/tenant-members",
                json={"email": "   ", "role": "admin"},
            )

        assert resp.status_code == 400
        assert resp.json()["message"] == "email must not be blank"
        resolver.assert_not_called()

    def test_the_missing_operator_id_502_reaches_the_browser_as_a_sentence(self):
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
        assert "operator_id" in resp.json()["message"]


class TestTenantMemberAddIsRateLimited:
    """The pace bound on the widest-gated Cognito fan-out on this router.

    One call resolves an email through ``ListUsers``, which walks up to
    ``cognito_admin._LIST_USERS_MAX_PAGES`` (25) sequential AWS round-trips
    inside a worker thread. The two sibling routes doing the same lookup are
    ``require_admin`` (platform superuser) and still carry a 30/min bucket;
    this one is gated on TENANT ADMIN, so its caller population is every
    tenant's administrator — and its two answers differ on whether the
    address EXISTS in the pool (``added`` vs ``invited``), which
    makes an unbounded caller an email-existence oracle over the whole pool.
    """

    TENANT = uuid4()
    AUTH = {"Authorization": "Bearer operator-one"}
    ROUTE_KEY = "app.api.v1.endpoints.operations.post_coord_tenant_member"

    def _client(self) -> TestClient:
        return TestClient(_build_test_app(server_tenant=self.TENANT))

    #: What every unthrottled call answers. The ambiguous-email arm is the
    #: one that reaches Cognito and then writes nothing — no account, no
    #: coord call, no email — so a burst of 30 needs no other mock.
    OK = 409

    @staticmethod
    def _resolver():
        from app.services.cognito_admin import CognitoAmbiguousEmailError

        return MagicMock(side_effect=CognitoAmbiguousEmailError("dupe"))

    def _patch_resolver(self):
        return patch(
            "app.services.cognito_admin.resolve_identity_for_email",
            self._resolver(),
        )

    def _post(self, client: TestClient, headers=None):
        return client.post(
            f"{API_PREFIX}/coord/tenant-members",
            json={"email": "u1@x.io", "role": "admin"},
            headers=self.AUTH if headers is None else headers,
        )

    def test_the_thirty_first_call_in_a_minute_is_throttled(self):
        client = self._client()
        with self._patch_resolver():
            codes = [self._post(client).status_code for _ in range(31)]

        assert codes[:30] == [self.OK] * 30
        assert codes[30] == 429

    def test_a_throttled_call_never_reaches_cognito(self):
        """The limit is checked BEFORE the handler, or it would only be
        counting an AWS fan-out it had already paid for."""
        client = self._client()
        with self._patch_resolver() as resolver:
            for _ in range(33):
                self._post(client)

        assert resolver.call_count == 30

    def test_the_bucket_is_per_caller_not_per_ip(self):
        """Behind Vercel/ALB every operator arrives from a handful of source
        IPs, so an IP key would let one tenant admin throttle every other."""
        client = self._client()
        with self._patch_resolver():
            for _ in range(30):
                self._post(client)
            exhausted = self._post(client)
            other = self._post(client, headers={"Authorization": "Bearer operator-two"})

        assert exhausted.status_code == 429
        assert other.status_code == self.OK, other.text

    def test_the_route_carries_its_own_named_scope(self):
        """``shared_limit`` buckets per named scope. Its own scope — rather
        than the Cognito group routes' — keeps an operator's group work from
        throttling their member adds and vice versa: two different routes
        with two different limits to reason about."""
        from app.api.v1.endpoints import operations

        limits = user_limiter._route_limits[self.ROUTE_KEY]

        assert [limit.scope for limit in limits] == ["coord-tenant-member-add"]
        assert operations._TENANT_MEMBER_ADD_RATE_LIMIT == "30 per minute"
        # Same ceiling as the sibling member routes, deliberately.
        assert (
            operations._TENANT_MEMBER_ADD_RATE_LIMIT
            == operations._GROUP_MEMBER_RATE_LIMIT
        )

    def test_the_kill_switch_exempts_the_route(self):
        """``user_limiter`` is built without ``enabled=``, so the decorator
        reads ``RATE_LIMIT_ENABLED`` per request instead — the same
        operational off-ramp every other limited route in this app has."""
        from app.core.config import settings

        client = self._client()
        with (
            self._patch_resolver(),
            patch.object(settings, "RATE_LIMIT_ENABLED", False),
        ):
            codes = [self._post(client).status_code for _ in range(33)]

        assert codes == [self.OK] * 33


# ---------------------------------------------------------------------------
# The gate itself — NOT the override every other test in this file installs
# ---------------------------------------------------------------------------
#
# `_build_test_app` overrides BOTH `require_coord_tenant_admin` and
# `require_coord_tenant_admin_target` to one uuid, which is what keeps the
# proxy path testable without a live coord — and which also means that
# "the write named the effective tenant" is, in those tests, an assertion
# about the override. It would pass byte-identically against the
# `Depends(require_coord_tenant_admin)` bug this commit fixed.
#
# These tests exercise the real thing. The unit half follows the pattern in
# `tests/test_active_tenant_transport.py` (`_effective_tenant_id` against a
# synthetic `CoordIdentity`, no HTTP); the route half turns the override off
# so home and effective genuinely differ, and reads the tenant id off the
# coord write.

_HOME_TENANT = UUID("11111111-1111-1111-1111-111111111111")
_SELECTED_TENANT = UUID("22222222-2222-2222-2222-222222222222")
_STRANGER_TENANT = UUID("33333333-3333-3333-3333-333333333333")  # not a member
ACTIVE_TENANT_HEADER = "X-Qontinui-Active-Tenant"


def _coord_identity():
    """Operator: admin of the home tenant AND of one other they may switch to."""
    from app.services.coord_identity import CoordIdentity, CoordTenant

    return CoordIdentity(
        operator_id=UUID("99999999-9999-9999-9999-999999999999"),
        home_tenant_id=_HOME_TENANT,
        email="operator@example.com",
        roles=("admin",),
        tenants=(
            CoordTenant(tenant_id=_HOME_TENANT, slug="home-tenant", roles=("admin",)),
            CoordTenant(
                tenant_id=_SELECTED_TENANT, slug="other-tenant", roles=("admin",)
            ),
        ),
        is_admin=True,
    )


def _identity_request(active_tenant: str | None) -> MagicMock:
    req = MagicMock()
    req.headers = {} if active_tenant is None else {ACTIVE_TENANT_HEADER: active_tenant}
    return req


def _patch_identity():
    return patch(
        "app.api.v1.endpoints.operations.get_coord_identity",
        AsyncMock(return_value=_coord_identity()),
    )


class TestTheGrantTargetsTheEffectiveTenant:
    """``require_coord_tenant_admin_target`` — the gate, not its override.

    ``require_coord_tenant_admin`` checks admin in the EFFECTIVE tenant and
    returns the HOME one. For a pass-through proxy that mismatch is harmless;
    for this route, which NAMES the tenant in the body it writes, it meant an
    operator viewing tenant B could grant into tenant A.
    """

    @pytest.mark.asyncio
    async def test_a_member_selection_wins(self):
        from app.api.v1.endpoints.operations import require_coord_tenant_admin_target

        with _patch_identity():
            target = await require_coord_tenant_admin_target(
                request=_identity_request(str(_SELECTED_TENANT)),
                home_tenant_id=_HOME_TENANT,
            )

        assert target == _SELECTED_TENANT

    @pytest.mark.asyncio
    async def test_a_non_member_selection_degrades_to_home(self):
        """Mirrors coord's own ``apply_active_tenant_override``: a selection
        the operator does not belong to degrades to home, never widens."""
        from app.api.v1.endpoints.operations import require_coord_tenant_admin_target

        with _patch_identity():
            target = await require_coord_tenant_admin_target(
                request=_identity_request(str(_STRANGER_TENANT)),
                home_tenant_id=_HOME_TENANT,
            )

        assert target == _HOME_TENANT

    @pytest.mark.asyncio
    async def test_no_header_is_home(self):
        from app.api.v1.endpoints.operations import require_coord_tenant_admin_target

        with _patch_identity():
            target = await require_coord_tenant_admin_target(
                request=_identity_request(None),
                home_tenant_id=_HOME_TENANT,
            )

        assert target == _HOME_TENANT

    def test_the_grant_names_the_switched_tenant_not_the_home_one(self):
        """End to end over the real gate: the tenant on the wire is the one
        the operator is LOOKING AT. Reverting the route to
        ``Depends(require_coord_tenant_admin)`` fails here and nowhere else
        in this file."""
        from app.services.cognito_admin import CognitoIdentity

        client = TestClient(
            _build_test_app(server_tenant=_HOME_TENANT, override_target_gate=False)
        )
        with (
            _patch_identity(),
            patch(
                "app.services.cognito_admin.resolve_identity_for_email",
                MagicMock(return_value=CognitoIdentity(username="u1", sub="s-1")),
            ),
            _patch_httpx() as MockClient,
        ):
            instance = AsyncMock()
            instance.post.side_effect = [
                _mock_response(json_data={"operator_id": "op-7"}),
                _mock_response(json_data={"ok": True}),
            ]
            _configure_mock_client(MockClient, instance)
            resp = client.post(
                f"{API_PREFIX}/coord/tenant-members",
                json={"email": "u1@x.io", "role": "admin"},
                headers={ACTIVE_TENANT_HEADER: str(_SELECTED_TENANT)},
            )

        assert resp.status_code == 200, resp.text
        grant = instance.post.call_args_list[1]
        assert grant.kwargs["json"]["target_tenant_id"] == str(_SELECTED_TENANT)
        assert grant.kwargs["json"]["target_tenant_id"] != str(_HOME_TENANT)

    def test_a_non_member_selection_grants_into_the_home_tenant(self):
        """The degrade arm, on the wire: a selection the operator does not
        belong to must not name itself in a grant."""
        from app.services.cognito_admin import CognitoIdentity

        client = TestClient(
            _build_test_app(server_tenant=_HOME_TENANT, override_target_gate=False)
        )
        with (
            _patch_identity(),
            patch(
                "app.services.cognito_admin.resolve_identity_for_email",
                MagicMock(return_value=CognitoIdentity(username="u1", sub="s-1")),
            ),
            _patch_httpx() as MockClient,
        ):
            instance = AsyncMock()
            instance.post.side_effect = [
                _mock_response(json_data={"operator_id": "op-8"}),
                _mock_response(json_data={"ok": True}),
            ]
            _configure_mock_client(MockClient, instance)
            resp = client.post(
                f"{API_PREFIX}/coord/tenant-members",
                json={"email": "u1@x.io", "role": "admin"},
                headers={ACTIVE_TENANT_HEADER: str(_STRANGER_TENANT)},
            )

        assert resp.status_code == 200, resp.text
        grant = instance.post.call_args_list[1]
        assert grant.kwargs["json"]["target_tenant_id"] == str(_HOME_TENANT)
