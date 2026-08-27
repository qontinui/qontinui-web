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
