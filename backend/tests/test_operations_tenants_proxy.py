"""Tests for the tenant ("Project") surface under ``/api/v1/operations``.

Plan ``2026-08-25-self-service-tenant-project-creation``, Phase 2:

  - ``POST /api/v1/operations/tenants`` → coord ``POST /coord/tenants``, a
    thin bearer-forwarding proxy with no web-side auth logic of its own;
  - ``GET  /api/v1/operations/tenants`` now renders coord's per-tenant
    ``display_name`` as ``name``, falling back to the slug.

The two halves are tested together because they are one user-visible
claim: a user who types **"My Pizzeria"** must then SEE "My Pizzeria" —
not ``my-pizzeria``. Before this plan ``/me`` carried no display name at
all and the list route hard-coded ``name = slug``.

The proxy tests assert coord's 4xx statuses reach the browser INTACT.
That matters more than it looks: ``409 slug_taken`` is the one answer that
tells a user their name collided, and a 500 there would read as "the
system broke" for what is really "pick another name".

Plan ``2026-08-27-tenant-creation-fix-and-members-page-ux`` adds the second
half of the same claim, and for the same reason: a Cognito group name the
operator typed with a space in it must come back as a **400 naming the
reason**, not a ``502 Could not create Cognito group.`` that blames AWS for
a typo. Those tests live here rather than in
``test_cognito_admin_groups.py`` because what they pin is the ENDPOINT's
status mapping (plus the local pre-check that feeds it), not the boto3
call shape that module already covers.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID, uuid4

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

API_PREFIX = "/api/v1/operations"

# The raw caller token the proxy must forward to coord verbatim.
_CALLER_TOKEN = "caller-cognito-token"

_HOME = UUID("11111111-1111-1111-1111-111111111111")
_OTHER = UUID("22222222-2222-2222-2222-222222222222")


def _build_test_app(*, is_superuser: bool = False) -> FastAPI:
    from app.api.deps import (
        get_async_db,
        get_current_active_user_async,
        get_current_user_async,
    )
    from app.api.v1.endpoints.operations import router as operations_router

    test_app = FastAPI()
    mock_user = MagicMock()
    mock_user.id = uuid4()
    mock_user.email = "operator@example.com"
    mock_user.is_active = True
    mock_user.is_verified = True
    # `require_admin` reads `is_superuser` off the SAME overridden user, so the
    # Cognito-group routes below need a superuser app rather than a second gate
    # override — the real dependency then still runs.
    mock_user.is_superuser = is_superuser
    test_app.dependency_overrides[get_current_active_user_async] = lambda: mock_user
    test_app.dependency_overrides[get_current_user_async] = lambda: mock_user
    test_app.dependency_overrides[get_async_db] = lambda: None
    test_app.include_router(operations_router, prefix=API_PREFIX)
    return test_app


@pytest.fixture()
def client() -> TestClient:
    # `raise_server_exceptions=False` is NOT set: every assertion below is on
    # a status the route raises deliberately, so a real 500 must still blow up
    # the test rather than be silently asserted as a status code.
    return TestClient(_build_test_app())


@pytest.fixture(autouse=True)
def _fresh_rate_limit_bucket():
    """One budget per test. ``PATCH /tenants/{tenant_id}`` and the Cognito
    group create are rate-limited per caller, and every test here presents the
    same credential, so an unreset bucket would leak one test's calls into the
    next one's and turn an assertion into a 429."""
    from app.middleware.rate_limit import user_limiter

    user_limiter.reset()
    yield
    user_limiter.reset()


@pytest.fixture()
def admin_client() -> TestClient:
    """A client whose user IS a superuser — required by `require_admin`."""
    return TestClient(_build_test_app(is_superuser=True))


def _identity(*, display_names: dict[UUID, str | None]) -> Any:
    """A two-tenant operator whose per-tenant display names are given."""
    from app.services.coord_identity import CoordIdentity, CoordTenant

    return CoordIdentity(
        operator_id=uuid4(),
        home_tenant_id=_HOME,
        email="operator@example.com",
        roles=("operator",),
        tenants=(
            CoordTenant(
                tenant_id=_HOME,
                slug="personal-abc",
                roles=("operator",),
                display_name=display_names.get(_HOME),
            ),
            CoordTenant(
                tenant_id=_OTHER,
                slug="my-pizzeria",
                roles=("admin",),
                display_name=display_names.get(_OTHER),
            ),
        ),
        is_admin=False,
    )


def _mock_response(
    status_code: int = 200, json_data: Any = None, text: str = ""
) -> MagicMock:
    resp = MagicMock(spec=httpx.Response)
    resp.status_code = status_code
    resp.json.return_value = json_data
    resp.text = text or (str(json_data) if json_data else "")
    return resp


def _patch_httpx():
    return patch("app.api.v1.endpoints.operations.httpx.AsyncClient")


def _configure_mock_client(MockClient, mock_instance) -> None:
    mock_instance.__aenter__ = AsyncMock(return_value=mock_instance)
    mock_instance.__aexit__ = AsyncMock(return_value=False)
    MockClient.return_value = mock_instance


def _patch_identity(identity: Any):
    return patch(
        "app.api.v1.endpoints.operations.get_coord_identity",
        new=AsyncMock(return_value=identity),
    )


# ---------------------------------------------------------------------------
# GET /tenants — the typed name is what the UI shows
# ---------------------------------------------------------------------------


class TestListUserTenants:
    def test_display_name_is_rendered_not_the_slug(self, client: TestClient):
        """Create "My Pizzeria" → the list route must say "My Pizzeria".

        The plan's whole "user-facing label is Project" decision reduces to
        this assertion: without it a user who typed "My Pizzeria" sees
        `my-pizzeria` in the switcher and the header chip.
        """
        identity = _identity(display_names={_HOME: "Personal", _OTHER: "My Pizzeria"})
        with _patch_identity(identity):
            resp = client.get(f"{API_PREFIX}/tenants")

        assert resp.status_code == 200
        body = resp.json()
        by_id = {t["id"]: t for t in body["tenants"]}
        assert by_id[str(_OTHER)]["name"] == "My Pizzeria"
        # The slug is still carried — the name is presentation, the slug is
        # the identifier — and it is NOT what `name` renders.
        assert by_id[str(_OTHER)]["slug"] == "my-pizzeria"
        assert by_id[str(_HOME)]["name"] == "Personal"
        assert body["active_tenant_id"] == str(_HOME)

    def test_falls_back_to_slug_when_coord_sends_no_display_name(
        self, client: TestClient
    ):
        """A coord that predates `display_name` on `/me` must still work.

        Absence-tolerance is the whole contract here: this half of the plan
        ships independently of coord's half, and an SSO-auto-provisioned
        tenant never gets a display name at all.
        """
        identity = _identity(display_names={_HOME: None, _OTHER: None})
        with _patch_identity(identity):
            resp = client.get(f"{API_PREFIX}/tenants")

        assert resp.status_code == 200
        by_id = {t["id"]: t for t in resp.json()["tenants"]}
        assert by_id[str(_HOME)]["name"] == "personal-abc"
        assert by_id[str(_OTHER)]["name"] == "my-pizzeria"

    def test_empty_membership_is_403_tenant_not_resolved(self, client: TestClient):
        from app.services.coord_identity import CoordIdentity

        identity = CoordIdentity(
            operator_id=uuid4(),
            home_tenant_id=None,
            email="nobody@example.com",
            roles=(),
            tenants=(),
            is_admin=False,
        )
        with _patch_identity(identity):
            resp = client.get(f"{API_PREFIX}/tenants")
        assert resp.status_code == 403
        assert resp.json()["detail"] == "tenant_not_resolved"


# ---------------------------------------------------------------------------
# POST /tenants — the create proxy
# ---------------------------------------------------------------------------


class TestCreateUserTenant:
    def test_creates_and_forwards_body_to_coord(self, client: TestClient):
        coord_payload = {
            "tenant_id": str(_OTHER),
            "slug": "my-pizzeria",
            "display_name": "My Pizzeria",
        }
        mock_resp = _mock_response(json_data=coord_payload)
        with _patch_httpx() as MockClient:
            instance = MagicMock()
            instance.post = AsyncMock(return_value=mock_resp)
            _configure_mock_client(MockClient, instance)
            resp = client.post(
                f"{API_PREFIX}/tenants",
                json={"display_name": "My Pizzeria"},
                headers={"Authorization": f"Bearer {_CALLER_TOKEN}"},
            )

        assert resp.status_code == 200
        assert resp.json() == coord_payload

        call = instance.post.call_args
        assert call.args[0].endswith("/coord/tenants")
        # The name crosses the wire EXACTLY as typed — web must never
        # pre-slugify or "clean up" the user's input; coord rejects rather
        # than mangles, and pre-mangling here would hide that.
        assert call.kwargs["json"] == {"display_name": "My Pizzeria"}
        # The caller's bearer MUST be on the wire. This route resolves no
        # tenant (it creates one), so `forward_bearer=True` + an inline
        # `capture_caller_bearer(request)` is the ONLY thing that puts it
        # there. Asserting merely that a headers dict exists is vacuous:
        # `_tenant_headers` returns `{}` when the ContextVar is unset, and
        # `{} is not None` — which is how this route shipped a 401 to
        # production with a green test.
        headers = call.kwargs["headers"]
        assert "Authorization" in headers, (
            "no Authorization forwarded — coord answers "
            "401 missing operator Bearer token"
        )
        assert headers["Authorization"].startswith("Bearer ")
        assert headers["Authorization"] == f"Bearer {_CALLER_TOKEN}"

    def test_bearer_capture_survives_a_cookie_only_session(self, client: TestClient):
        """The browser sends the token as an `access_token` COOKIE, not a
        header — which is the shape the production 401 actually had."""
        mock_resp = _mock_response(json_data={"tenant_id": str(_OTHER)})
        with _patch_httpx() as MockClient:
            instance = MagicMock()
            instance.post = AsyncMock(return_value=mock_resp)
            _configure_mock_client(MockClient, instance)
            client.cookies.set("access_token", _CALLER_TOKEN)
            resp = client.post(
                f"{API_PREFIX}/tenants", json={"display_name": "My Pizzeria"}
            )

        assert resp.status_code == 200
        headers = instance.post.call_args.kwargs["headers"]
        assert headers["Authorization"] == f"Bearer {_CALLER_TOKEN}"

    def test_coord_409_slug_taken_propagates_as_409(self, client: TestClient):
        """A name collision must reach the browser as 409, not 500.

        `_proxy_coord_post` re-raises coord's status verbatim; this pins that
        behaviour for the one status the create dialog has distinct copy for.
        """
        mock_resp = _mock_response(
            status_code=409, text='{"error":"slug_taken","slug":"my-pizzeria"}'
        )
        with _patch_httpx() as MockClient:
            instance = MagicMock()
            instance.post = AsyncMock(return_value=mock_resp)
            _configure_mock_client(MockClient, instance)
            resp = client.post(
                f"{API_PREFIX}/tenants", json={"display_name": "My Pizzeria"}
            )

        assert resp.status_code == 409
        # coord's own body survives the hop, so the frontend can read the
        # machine-readable code rather than guess from the status.
        assert "slug_taken" in resp.json()["detail"]

    def test_coord_400_invalid_name_propagates_as_400(self, client: TestClient):
        mock_resp = _mock_response(
            status_code=400, text='{"error":"invalid_name","reason":"empty_slug"}'
        )
        with _patch_httpx() as MockClient:
            instance = MagicMock()
            instance.post = AsyncMock(return_value=mock_resp)
            _configure_mock_client(MockClient, instance)
            resp = client.post(f"{API_PREFIX}/tenants", json={"display_name": "..."})

        assert resp.status_code == 400
        assert "invalid_name" in resp.json()["detail"]

    def test_coord_unreachable_returns_502(self, client: TestClient):
        with _patch_httpx() as MockClient:
            instance = MagicMock()
            instance.post = AsyncMock(side_effect=httpx.ConnectError("refused"))
            _configure_mock_client(MockClient, instance)
            resp = client.post(f"{API_PREFIX}/tenants", json={"display_name": "X"})
        assert resp.status_code == 502

    def test_empty_name_is_rejected_before_coord(self, client: TestClient):
        """An empty name never reaches coord — `min_length=1` on the model.

        This is a courtesy, not the security control: coord still validates,
        denylists and caps. It exists so the obvious no-op does not spend a
        round-trip.
        """
        with _patch_httpx() as MockClient:
            instance = MagicMock()
            instance.post = AsyncMock()
            _configure_mock_client(MockClient, instance)
            resp = client.post(f"{API_PREFIX}/tenants", json={"display_name": ""})
        assert resp.status_code == 422
        instance.post.assert_not_awaited()


# ---------------------------------------------------------------------------
# POST /coord/cognito/groups — a bad NAME is 400, only a broken AWS is 502
# ---------------------------------------------------------------------------


def _client_error(code: str, message: str) -> Exception:
    """A boto3 ``ClientError`` with the given AWS error code + message."""
    from botocore.exceptions import ClientError

    return ClientError({"Error": {"Code": code, "Message": message}}, "CreateGroup")


class _RaisingCognitoClient:
    """A boto3 stand-in whose ``create_group`` always raises, and which records
    whether it was reached at all."""

    def __init__(self, exc: Exception) -> None:
        self._exc = exc
        self.called = False

    def create_group(self, **kwargs: Any) -> Any:
        self.called = True
        raise self._exc


class TestCreateCognitoGroupNameErrors:
    _AWS_MESSAGE = (
        "1 validation error detected: Value 'test admins' at 'groupName' "
        "failed to satisfy constraint: Member must satisfy regular "
        "expression pattern: [\\p{L}\\p{M}\\p{S}\\p{N}\\p{P}]+"
    )

    def test_aws_invalid_parameter_is_400_with_the_real_reason(
        self, admin_client: TestClient
    ):
        """AWS rejecting the name is the CALLER's error, not an outage.

        A constraint the local pre-check does not model still has to arrive as
        a 400 carrying AWS's own sentence — a 502 would tell the operator
        Cognito is down when the fix is to retype the name.
        """
        from app.services import cognito_admin

        fake = _RaisingCognitoClient(
            _client_error("InvalidParameterException", self._AWS_MESSAGE)
        )
        with patch.object(cognito_admin, "_get_client", return_value=fake):
            resp = admin_client.post(
                f"{API_PREFIX}/coord/cognito/groups",
                # Passes the LOCAL pre-check (no space), so the request really
                # does reach boto3 and exercise the AWS-code branch.
                json={"group_name": "test-admins", "description": None},
            )

        assert fake.called, "the AWS branch was never reached"
        assert resp.status_code == 400
        detail = resp.json()["detail"]
        assert "Could not create Cognito group" not in detail
        assert "groupName" in detail

    def test_a_space_in_the_name_is_400_without_touching_aws(
        self, admin_client: TestClient
    ):
        """The common case never spends an AWS round-trip."""
        from app.services import cognito_admin

        fake = _RaisingCognitoClient(
            _client_error("InternalErrorException", "should never be reached")
        )
        with patch.object(cognito_admin, "_get_client", return_value=fake):
            resp = admin_client.post(
                f"{API_PREFIX}/coord/cognito/groups",
                json={"group_name": "test admins", "description": None},
            )

        assert resp.status_code == 400
        assert fake.called is False
        detail = resp.json()["detail"]
        assert "spaces" in detail
        assert "Could not create Cognito group" not in detail

    def test_a_broken_upstream_is_still_502(self, admin_client: TestClient):
        """502 keeps meaning "the upstream is broken" — that is the whole
        reason narrowing the 400 case is worth doing."""
        from app.services import cognito_admin

        fake = _RaisingCognitoClient(
            _client_error("InternalErrorException", "Cognito is having a day")
        )
        with patch.object(cognito_admin, "_get_client", return_value=fake):
            resp = admin_client.post(
                f"{API_PREFIX}/coord/cognito/groups",
                json={"group_name": "test-admins", "description": None},
            )

        assert resp.status_code == 502
        assert resp.json()["detail"] == "Could not create Cognito group."

    def test_an_existing_group_is_still_409(self, admin_client: TestClient):
        from app.services import cognito_admin

        fake = _RaisingCognitoClient(
            _client_error("GroupExistsException", "already exists")
        )
        with patch.object(cognito_admin, "_get_client", return_value=fake):
            resp = admin_client.post(
                f"{API_PREFIX}/coord/cognito/groups",
                json={"group_name": "test-admins", "description": None},
            )

        assert resp.status_code == 409


class TestInvalidGroupNameReason:
    """Literal cases only — never asserted against the function's own
    constants, which would pin nothing."""

    def test_a_space_is_rejected_naming_spaces(self):
        from app.services.cognito_admin import invalid_group_name_reason

        assert (
            invalid_group_name_reason("test admins")
            == "must not contain spaces or control characters"
        )

    def test_a_hyphen_is_accepted(self):
        from app.services.cognito_admin import invalid_group_name_reason

        assert invalid_group_name_reason("test-admins") is None

    def test_empty_is_rejected(self):
        from app.services.cognito_admin import invalid_group_name_reason

        assert invalid_group_name_reason("") == "must not be empty"

    def test_129_characters_is_rejected(self):
        from app.services.cognito_admin import invalid_group_name_reason

        assert invalid_group_name_reason("a" * 128) is None
        assert invalid_group_name_reason("a" * 129) == "must be at most 128 characters"

    def test_a_control_character_is_rejected(self):
        from app.services.cognito_admin import invalid_group_name_reason

        assert (
            invalid_group_name_reason("test\x07admins")
            == "must not contain spaces or control characters"
        )

    def test_punctuation_and_symbols_are_accepted(self):
        """The Cognito class ALLOWS ``\\p{S}`` and ``\\p{P}`` — rejecting them
        would be a stricter-than-AWS gate that blocks legitimate names."""
        from app.services.cognito_admin import invalid_group_name_reason

        assert invalid_group_name_reason("team+ops_2026!") is None


# ---------------------------------------------------------------------------
# GET /tenants — per-tenant roles (plan 2026-09-17-tenant-rename, Phase C.3)
# ---------------------------------------------------------------------------


class TestListUserTenantsRoles:
    def test_each_tenant_carries_its_own_roles_not_a_union(self, client: TestClient):
        """The Rename control is gated per tenant, so the list must say which
        roles the caller holds IN EACH tenant. A union would put `admin` on the
        home row too and offer a Rename coord then refuses."""
        identity = _identity(display_names={_HOME: None, _OTHER: None})
        with _patch_identity(identity):
            resp = client.get(f"{API_PREFIX}/tenants")

        assert resp.status_code == 200
        by_id = {t["id"]: t for t in resp.json()["tenants"]}
        assert by_id[str(_HOME)]["roles"] == ["operator"]
        assert by_id[str(_OTHER)]["roles"] == ["admin"]


# ---------------------------------------------------------------------------
# PATCH /tenants/{tenant_id} — the rename proxy (Phase C.2) + D5 follow-through
# ---------------------------------------------------------------------------


def _rename_payload(
    *,
    slug: str = "new-name",
    display_name: str = "New Name",
    home_group_to_migrate: str | None = None,
) -> dict[str, Any]:
    return {
        "tenant_id": str(_OTHER),
        "slug": slug,
        "display_name": display_name,
        "previous": {"slug": "my-pizzeria", "display_name": "My Pizzeria"},
        "changed": True,
        "group_mappings_moved": 0,
        "home_group_to_migrate": home_group_to_migrate,
    }


def _patch_rename(client: TestClient, json: Any, **kwargs: Any):
    return client.patch(f"{API_PREFIX}/tenants/{_OTHER}", json=json, **kwargs)


class TestRenameUserTenant:
    def test_forwards_only_sent_fields_bearer_and_path_active_tenant(
        self, client: TestClient
    ):
        coord_payload = _rename_payload()
        mock_resp = _mock_response(json_data=coord_payload)
        with _patch_httpx() as MockClient:
            instance = MagicMock()
            instance.patch = AsyncMock(return_value=mock_resp)
            _configure_mock_client(MockClient, instance)
            resp = _patch_rename(
                client,
                {"display_name": "New Name"},
                headers={
                    "Authorization": f"Bearer {_CALLER_TOKEN}",
                    # The switcher points at a DIFFERENT tenant — the path
                    # tenant must win, or coord's role check evaluates the
                    # wrong tenant and answers `403 tenant_mismatch`.
                    "X-Qontinui-Active-Tenant": str(_HOME),
                },
            )

        assert resp.status_code == 200
        # Verbatim, and no `home_group_migration` when coord names no group.
        assert resp.json() == coord_payload

        call = instance.patch.call_args
        assert call.args[0].endswith(f"/coord/tenants/{_OTHER}")
        # Only the field that was sent: a `"slug": null` would read coord-side
        # as a slug change to nothing.
        assert call.kwargs["json"] == {"display_name": "New Name"}
        headers = call.kwargs["headers"]
        assert headers["Authorization"] == f"Bearer {_CALLER_TOKEN}"
        assert headers["X-Qontinui-Active-Tenant"] == str(_OTHER)

    def test_both_fields_are_forwarded(self, client: TestClient):
        mock_resp = _mock_response(json_data=_rename_payload())
        with _patch_httpx() as MockClient:
            instance = MagicMock()
            instance.patch = AsyncMock(return_value=mock_resp)
            _configure_mock_client(MockClient, instance)
            resp = _patch_rename(
                client, {"display_name": "New Name", "slug": "new-name"}
            )
        assert resp.status_code == 200
        assert instance.patch.call_args.kwargs["json"] == {
            "display_name": "New Name",
            "slug": "new-name",
        }

    def test_bearer_capture_survives_a_cookie_only_session(self, client: TestClient):
        mock_resp = _mock_response(json_data=_rename_payload())
        with _patch_httpx() as MockClient:
            instance = MagicMock()
            instance.patch = AsyncMock(return_value=mock_resp)
            _configure_mock_client(MockClient, instance)
            client.cookies.set("access_token", _CALLER_TOKEN)
            resp = _patch_rename(client, {"display_name": "New Name"})

        assert resp.status_code == 200
        headers = instance.patch.call_args.kwargs["headers"]
        assert headers["Authorization"] == f"Bearer {_CALLER_TOKEN}"
        assert headers["X-Qontinui-Active-Tenant"] == str(_OTHER)

    @pytest.mark.parametrize(
        ("status", "body", "code"),
        [
            (400, '{"error":"invalid_slug","reason":"too_short"}', "invalid_slug"),
            (
                400,
                '{"error":"reserved_name","reason":"historical_slug"}',
                "historical_slug",
            ),
            # What coord's landed route ACTUALLY answers when its
            # in-transaction admin re-check fails. `not_admin_in_target_tenant`
            # is this module's own code for a different door and appears
            # nowhere in the rename route.
            (403, '{"error":"admin_required"}', "admin_required"),
            (403, '{"error":"tenant_mismatch"}', "tenant_mismatch"),
            (404, '{"error":"tenant_not_found"}', "tenant_not_found"),
            # Coord answers a bare `{"error":"slug_taken"}` — no `slug` key
            # (routes_phase3.rs). This is the shape production actually gets;
            # the `slug`-carrying row below is a forward-compat pin, kept
            # deliberately and labelled so it is not mistaken for the live one.
            (409, '{"error":"slug_taken"}', "slug_taken"),
            (409, '{"error":"slug_taken","slug":"new-name"}', "slug_taken"),
            (
                409,
                '{"error":"slug_pinned","reason":"configured_default_tenant"}',
                "configured_default_tenant",
            ),
            (409, '{"error":"concurrent_group_mapping"}', "concurrent_group_mapping"),
        ],
    )
    def test_coord_4xx_passes_through_with_coord_body(
        self, client: TestClient, status: int, body: str, code: str
    ):
        mock_resp = _mock_response(status_code=status, text=body)
        with _patch_httpx() as MockClient:
            instance = MagicMock()
            instance.patch = AsyncMock(return_value=mock_resp)
            _configure_mock_client(MockClient, instance)
            resp = _patch_rename(client, {"slug": "new-name"})

        assert resp.status_code == status
        assert code in resp.json()["detail"]

    def test_coord_unreachable_returns_502(self, client: TestClient):
        with _patch_httpx() as MockClient:
            instance = MagicMock()
            instance.patch = AsyncMock(side_effect=httpx.ConnectError("refused"))
            _configure_mock_client(MockClient, instance)
            resp = _patch_rename(client, {"display_name": "X"})
        assert resp.status_code == 502

    @pytest.mark.parametrize(
        "body",
        [
            {},
            {"display_name": None, "slug": None},
            {"display_name": ""},
            {"slug": "ab"},
            {"slug": "Has-Caps"},
            {"slug": "double--hyphen"},
            {"slug": "-leading"},
            {"slug": "trailing-"},
            {"display_name": "x" * 201},
        ],
    )
    def test_malformed_body_is_422_before_coord(self, client: TestClient, body: Any):
        with _patch_httpx() as MockClient:
            instance = MagicMock()
            instance.patch = AsyncMock()
            _configure_mock_client(MockClient, instance)
            resp = _patch_rename(client, body)
        assert resp.status_code == 422
        instance.patch.assert_not_awaited()

    def test_the_route_is_rate_limited_under_its_own_scope(self):
        """A rename may create a Cognito group and add every member of the old
        home group, so it carries the group-create ceiling — in its OWN bucket,
        so renames and group admin do not throttle each other."""
        from app.api.v1.endpoints import operations
        from app.middleware.rate_limit import user_limiter

        limits = user_limiter._route_limits[
            "app.api.v1.endpoints.operations.rename_user_tenant"
        ]
        assert [limit.scope for limit in limits] == ["tenant-rename"]
        # NOT `assert _TENANT_RENAME_RATE_LIMIT == "10 per minute"`: that
        # restates a constant defined one line as
        # `_TENANT_RENAME_RATE_LIMIT = _CREATE_GROUP_RATE_LIMIT`, so it can only
        # fail when someone edits the literal — which is the change it would be
        # guarding. What is worth pinning is the COUPLING the comment claims:
        # the rename carries the group-create ceiling, whatever that is.
        assert (
            operations._TENANT_RENAME_RATE_LIMIT == operations._CREATE_GROUP_RATE_LIMIT
        )


class TestRenameOutcomeHonesty:
    """502 must mean "coord never saw it"; everything after the request may
    have been sent is 504 — the rename may have been applied."""

    def test_connect_error_is_502_not_reachable(self, client: TestClient):
        with _patch_httpx() as MockClient:
            instance = MagicMock()
            instance.patch = AsyncMock(side_effect=httpx.ConnectError("refused"))
            _configure_mock_client(MockClient, instance)
            resp = _patch_rename(client, {"display_name": "X"})
        assert resp.status_code == 502
        assert resp.json()["detail"] == "coord is not reachable"

    @pytest.mark.parametrize(
        "exc",
        [
            httpx.ReadError("connection reset"),
            httpx.RemoteProtocolError("server disconnected"),
            httpx.ReadTimeout("slow"),
        ],
    )
    def test_a_lost_answer_is_504(self, client: TestClient, exc: Exception):
        with _patch_httpx() as MockClient:
            instance = MagicMock()
            instance.patch = AsyncMock(side_effect=exc)
            _configure_mock_client(MockClient, instance)
            resp = _patch_rename(client, {"display_name": "X"})
        assert resp.status_code == 504

    def test_a_non_json_2xx_is_504(self, client: TestClient):
        import json

        mock_resp = _mock_response(status_code=200, text="<html>ok</html>")
        mock_resp.json.side_effect = json.JSONDecodeError("Expecting value", "", 0)
        with _patch_httpx() as MockClient:
            instance = MagicMock()
            instance.patch = AsyncMock(return_value=mock_resp)
            _configure_mock_client(MockClient, instance)
            resp = _patch_rename(client, {"display_name": "X"})
        assert resp.status_code == 504
        assert "may have been applied" in resp.json()["detail"]


class _FakeCognito:
    """Stands in for the four ``cognito_admin`` helpers the follow-through
    uses, recording every call — including any delete, which must never
    happen."""

    def __init__(
        self,
        *,
        groups: list[str],
        members: list[dict[str, Any]] | None = None,
        fail_on_add: bool = False,
        add_error: Exception | None = None,
        fail_on_list_users: bool = False,
        create_raises_exists: bool = False,
    ) -> None:
        self.groups = list(groups)
        self.members = members or []
        self.fail_on_add = fail_on_add
        self.add_error = add_error
        self.fail_on_list_users = fail_on_list_users
        self.create_raises_exists = create_raises_exists
        self.created: list[str] = []
        self.added: list[tuple[str, str]] = []
        self.deleted: list[str] = []
        self.list_calls = 0

    def list_groups(self) -> list[dict[str, Any]]:
        self.list_calls += 1
        return [{"group_name": g} for g in self.groups]

    def create_group(self, name: str, description: str | None = None) -> dict:
        if self.create_raises_exists:
            from app.services.cognito_admin import CognitoGroupExistsError

            raise CognitoGroupExistsError(f"Group already exists: {name}")
        self.created.append(name)
        self.groups.append(name)
        return {"group_name": name}

    def list_users_in_group(self, name: str) -> list[dict[str, Any]]:
        if self.fail_on_list_users:
            from app.services.cognito_admin import CognitoAdminError

            raise CognitoAdminError("ListUsersInGroup failed: throttled out")
        return list(self.members)

    def add_user_to_group(self, username: str, group: str) -> None:
        if self.add_error is not None and self.added:
            raise self.add_error
        if self.fail_on_add:
            from app.services.cognito_admin import CognitoAdminError

            raise CognitoAdminError("AdminAddUserToGroup failed: boom")
        self.added.append((username, group))

    def delete_group(self, name: str) -> None:
        self.deleted.append(name)

    def remove_user_from_group(self, username: str, group: str) -> None:
        self.deleted.append(f"{username}@{group}")


def _blast_radius(mapped_total: int = 0) -> Any:
    from app.api.v1.endpoints.operations import _BlastRadius

    return _BlastRadius(
        mapped_total=mapped_total,
        mapped_own_tenant_slugs=(),
        mapped_other_tenant_rows=mapped_total,
        mapped_unmaterialized_rows=0,
        strands_own_tenant=(),
        strands_other_tenant_count=0,
    )


def _run_rename_with_cognito(
    test_client: TestClient,
    fake: _FakeCognito,
    *,
    home_group_to_migrate: str = "my-pizzeria-home",
    blast_radius: Any = None,
    drop_keys: tuple[str, ...] = (),
) -> tuple[Any, MagicMock]:
    from app.services import cognito_admin

    payload = _rename_payload(home_group_to_migrate=home_group_to_migrate)
    for key in drop_keys:
        payload.pop(key)
    mock_resp = _mock_response(json_data=payload)
    audit = AsyncMock()
    radius = (
        blast_radius
        if blast_radius is not None
        else AsyncMock(return_value=_blast_radius(0))
    )
    with (
        _patch_httpx() as MockClient,
        patch.object(cognito_admin, "list_groups", fake.list_groups),
        patch.object(cognito_admin, "create_group", fake.create_group),
        patch.object(cognito_admin, "list_users_in_group", fake.list_users_in_group),
        patch.object(cognito_admin, "add_user_to_group", fake.add_user_to_group),
        patch.object(cognito_admin, "delete_group", fake.delete_group),
        patch.object(
            cognito_admin, "remove_user_from_group", fake.remove_user_from_group
        ),
        patch("app.api.v1.endpoints.operations._write_cognito_group_audit", new=audit),
        patch("app.api.v1.endpoints.operations._coord_group_blast_radius", new=radius),
    ):
        instance = MagicMock()
        instance.patch = AsyncMock(return_value=mock_resp)
        _configure_mock_client(MockClient, instance)
        resp = _patch_rename(test_client, {"slug": "new-name"})
    return resp, audit


class TestRenameHomeGroupMigration:
    _MEMBERS = [
        {"username": "u-1", "email": "one@example.com"},
        {"username": "u-2", "email": "two@example.com"},
    ]

    def test_superuser_migrates_copies_members_audits_and_keeps_old(
        self, admin_client: TestClient
    ):
        fake = _FakeCognito(groups=["my-pizzeria-home"], members=self._MEMBERS)
        resp, audit = _run_rename_with_cognito(admin_client, fake)

        assert resp.status_code == 200
        outcome = resp.json()["home_group_migration"]
        assert outcome["status"] == "migrated"
        assert outcome["new_group"] == "new-name-home"
        assert outcome["members_copied"] == 2
        assert fake.created == ["new-name-home"]
        assert fake.added == [("u-1", "new-name-home"), ("u-2", "new-name-home")]
        assert fake.deleted == []
        # One audit row per landed Cognito write: the create + each add.
        actions = [c.kwargs["action"] for c in audit.await_args_list]
        assert actions == ["create_group", "add_user_to_group", "add_user_to_group"]

    def test_the_budget_stops_the_copy_and_REPORTS_the_partial(
        self, admin_client: TestClient, monkeypatch
    ):
        """A home group too large for one request stops at the budget and says
        so, instead of running until the caller gives up.

        This is the finding the outcome lives in the response body: each member
        costs a Cognito write plus an audit INSERT, sequentially, so a big
        group outruns the client's own ceiling. When that happened the operator
        was told the outcome was unknown and the record that a half-populated
        group exists in the SHARED pool died with the response nobody received.
        Stopping at the budget converts that into a reported `partial`, with
        the count, while the answer can still be delivered.

        The budget is driven to zero rather than waited out: a test that sleeps
        for the real budget is a test nobody runs twice.
        """
        from app.api.v1.endpoints import operations

        monkeypatch.setattr(
            operations, "_HOME_GROUP_MIGRATION_BUDGET_SECONDS", 0, raising=True
        )
        fake = _FakeCognito(groups=["my-pizzeria-home"], members=self._MEMBERS)
        resp, _audit = _run_rename_with_cognito(admin_client, fake)

        assert resp.status_code == 200
        migration = resp.json()["home_group_migration"]
        assert migration["status"] == "partial"
        # The group WAS created, and nothing was copied before the budget
        # expired — so the sentence has to say both, and name the group the
        # operator now has to finish or delete.
        assert fake.created == ["new-name-home"]
        assert fake.added == []
        assert migration["new_group_created"] is True
        assert migration["members_copied"] == 0
        assert "new-name-home" in migration["detail"]
        assert "ran out of time" in migration["detail"]
        # The invariant every arm of this suite asserts: the old group is never
        # deleted, and the rename itself is never reported as a failure.
        assert fake.deleted == []
        assert resp.json()["slug"] == "new-name"

    def test_non_superuser_gets_requires_superuser_and_no_aws_call(
        self, client: TestClient
    ):
        fake = _FakeCognito(groups=["my-pizzeria-home"], members=self._MEMBERS)
        resp, audit = _run_rename_with_cognito(client, fake)

        assert resp.status_code == 200
        assert resp.json()["home_group_migration"]["status"] == "requires_superuser"
        assert fake.list_calls == 0
        assert fake.created == [] and fake.added == [] and fake.deleted == []
        audit.assert_not_awaited()
        # The rename itself still reached the caller.
        assert resp.json()["slug"] == "new-name"

    def test_existing_target_is_left_untouched(self, admin_client: TestClient):
        fake = _FakeCognito(
            groups=["my-pizzeria-home", "new-name-home"], members=self._MEMBERS
        )
        resp, audit = _run_rename_with_cognito(admin_client, fake)

        assert resp.json()["home_group_migration"]["status"] == "target_exists"
        assert fake.created == [] and fake.added == [] and fake.deleted == []
        audit.assert_not_awaited()

    def test_absent_old_group_is_absent(self, admin_client: TestClient):
        fake = _FakeCognito(groups=["engineering"])
        resp, _audit = _run_rename_with_cognito(admin_client, fake)

        assert resp.json()["home_group_migration"]["status"] == "absent"
        assert fake.created == [] and fake.deleted == []

    def test_cognito_failure_is_failed_and_rename_still_200(
        self, admin_client: TestClient
    ):
        fake = _FakeCognito(
            groups=["my-pizzeria-home"], members=self._MEMBERS, fail_on_add=True
        )
        resp, _audit = _run_rename_with_cognito(admin_client, fake)

        assert resp.status_code == 200
        outcome = resp.json()["home_group_migration"]
        assert outcome["status"] == "failed"
        assert "boom" in outcome["detail"]
        assert fake.deleted == []

    def test_failure_after_create_says_the_new_group_exists(
        self, admin_client: TestClient
    ):
        """A half-done move leaves a real group in the SHARED pool. The outcome
        must say so, not just "failed"."""
        fake = _FakeCognito(
            groups=["my-pizzeria-home"],
            members=self._MEMBERS,
            fail_on_list_users=True,
        )
        resp, _audit = _run_rename_with_cognito(admin_client, fake)

        assert resp.status_code == 200
        outcome = resp.json()["home_group_migration"]
        assert outcome["status"] == "failed"
        assert outcome["new_group_created"] is True
        assert (
            "“new-name-home” WAS created and holds 0 member(s)" in (outcome["detail"])
        )
        assert fake.created == ["new-name-home"]
        assert fake.deleted == []

    def test_partial_copy_names_n_of_m(self, admin_client: TestClient):
        from app.services.cognito_admin import CognitoAdminError

        fake = _FakeCognito(
            groups=["my-pizzeria-home"],
            members=self._MEMBERS,
            add_error=CognitoAdminError("AdminAddUserToGroup failed: second"),
        )
        resp, _audit = _run_rename_with_cognito(admin_client, fake)

        outcome = resp.json()["home_group_migration"]
        assert outcome["status"] == "failed"
        assert outcome["members_copied"] == 1
        assert "holds 1 of 2 member(s)" in outcome["detail"]

    def test_an_unexpected_exception_is_failed_never_a_500(
        self, admin_client: TestClient
    ):
        """Coord has already committed the rename; a 500 here would read as
        "not renamed" and invite a retry against the NEW slug."""
        fake = _FakeCognito(
            groups=["my-pizzeria-home"],
            members=self._MEMBERS,
            add_error=RuntimeError("not a Cognito error"),
        )
        resp, _audit = _run_rename_with_cognito(admin_client, fake)

        assert resp.status_code == 200
        outcome = resp.json()["home_group_migration"]
        assert outcome["status"] == "failed"
        assert "RuntimeError" in outcome["detail"]
        assert "The rename itself is complete" in outcome["detail"]
        assert outcome["new_group_created"] is True
        assert resp.json()["slug"] == "new-name"

    def test_create_race_is_target_exists(self, admin_client: TestClient):
        fake = _FakeCognito(
            groups=["my-pizzeria-home"],
            members=self._MEMBERS,
            create_raises_exists=True,
        )
        resp, audit = _run_rename_with_cognito(admin_client, fake)

        outcome = resp.json()["home_group_migration"]
        assert outcome["status"] == "target_exists"
        assert outcome["new_group_created"] is False
        assert fake.added == [] and fake.deleted == []
        audit.assert_not_awaited()

    def test_home_group_not_matching_previous_slug_makes_no_aws_call(
        self, admin_client: TestClient
    ):
        """`home_group_to_migrate` must be `<previous slug>-home`. Anything
        else is a response this code does not understand, so no writes."""
        fake = _FakeCognito(groups=["someone-elses-home"], members=self._MEMBERS)
        resp, audit = _run_rename_with_cognito(
            admin_client, fake, home_group_to_migrate="someone-elses-home"
        )

        assert resp.status_code == 200
        outcome = resp.json()["home_group_migration"]
        assert outcome["status"] == "failed"
        assert "my-pizzeria-home" in outcome["detail"]
        assert fake.list_calls == 0
        assert fake.created == [] and fake.added == [] and fake.deleted == []
        audit.assert_not_awaited()

    def test_a_target_coord_already_maps_is_not_created(self, admin_client: TestClient):
        """A mapping naming a not-yet-existing group goes live when the group
        appears, so creating it would grant the copied members those roles."""
        fake = _FakeCognito(groups=["my-pizzeria-home"], members=self._MEMBERS)
        radius = AsyncMock(return_value=_blast_radius(2))
        resp, audit = _run_rename_with_cognito(admin_client, fake, blast_radius=radius)

        outcome = resp.json()["home_group_migration"]
        assert outcome["status"] == "target_mapped"
        radius.assert_awaited_once_with("new-name-home")
        assert fake.created == [] and fake.added == [] and fake.deleted == []
        audit.assert_not_awaited()

    def test_an_unreadable_mapping_check_refuses_to_create(
        self, admin_client: TestClient
    ):
        from fastapi import HTTPException

        fake = _FakeCognito(groups=["my-pizzeria-home"], members=self._MEMBERS)
        radius = AsyncMock(
            side_effect=HTTPException(
                status_code=502, detail={"error": "mapping_check_unavailable"}
            )
        )
        resp, _audit = _run_rename_with_cognito(admin_client, fake, blast_radius=radius)

        assert resp.status_code == 200
        outcome = resp.json()["home_group_migration"]
        assert outcome["status"] == "failed"
        assert "was not created" in outcome["detail"]
        assert fake.created == []

    def test_an_answer_without_previous_fails_closed(self, admin_client: TestClient):
        """Without `previous`, `home_group_to_migrate` cannot be checked against
        the old slug — so nothing is written on its say-so."""
        fake = _FakeCognito(groups=["my-pizzeria-home"], members=self._MEMBERS)
        resp, audit = _run_rename_with_cognito(
            admin_client, fake, drop_keys=("previous",)
        )

        assert resp.status_code == 200
        outcome = resp.json()["home_group_migration"]
        assert outcome["status"] == "failed"
        assert fake.list_calls == 0
        assert fake.created == [] and fake.added == [] and fake.deleted == []
        audit.assert_not_awaited()
