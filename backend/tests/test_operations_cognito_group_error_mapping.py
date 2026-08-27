"""HTTP status mapping on the six pool-wide Cognito group routes.

Plan ``2026-08-27-members-page-delete-paths-authorization-and-blast-radius``
Phase 4, items 11-15 (verification V9).

Before this phase every failure that was not a ``GroupExistsException`` or a
group-shaped ``ResourceNotFoundException`` collapsed into **502**. 502 means
*the upstream is broken*; using it for a typo, for a throttle, for a missing
user and for this server's own misconfiguration destroys the only thing that
makes it a useful signal, and each of those four told the operator something
false about what had gone wrong.

One class per item:

* item 11 — a malformed group name in the PATH is **400**, and the request
  never reaches AWS. (``create`` takes its name in the BODY and is already
  covered by the validator inside ``cognito_admin.create_group``, so it is
  deliberately not re-validated here.)
* item 12 — ``UserNotFoundException`` is **404**. boto3 renders it
  ``User does not exist.``, which contains neither ``"ResourceNotFound-
  Exception"`` nor ``"not found"``, so the old text test fell through it.
* item 13 — ``TooManyRequestsException`` is **429**, on all six routes.
* item 14 — a ``ResourceNotFoundException`` caused by a wrong or absent
  ``COGNITO_USER_POOL_ID`` is **500 cognito_pool_misconfigured**, NOT
  ``404 No such group``. Same AWS error code, opposite meaning.
* item 15 — an over-long ``description`` is **422** from the schema rather
  than a 502 from AWS.

The boto3 errors are built as real ``ClientError``s and pushed through
``cognito_admin._wrap_aws_error``, so these tests exercise the actual
classifier rather than a hand-made stand-in of it.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
from botocore.exceptions import ClientError
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.services import cognito_admin

API_PREFIX = "/api/v1/operations"
_GROUPS_URL = f"{API_PREFIX}/coord/cognito/groups"
_CALLER_TOKEN = "caller-cognito-token"
_AUTH = {"Authorization": f"Bearer {_CALLER_TOKEN}"}


def _build_admin_app() -> FastAPI:
    from app.api.deps import (
        get_async_db,
        get_current_active_user_async,
        get_current_user_async,
    )
    from app.api.v1.endpoints.operations import router as operations_router

    test_app = FastAPI()
    mock_user = MagicMock()
    mock_user.id = uuid4()
    mock_user.email = "staff@example.com"
    mock_user.is_active = True
    mock_user.is_verified = True
    mock_user.is_superuser = True
    test_app.dependency_overrides[get_current_active_user_async] = lambda: mock_user
    test_app.dependency_overrides[get_current_user_async] = lambda: mock_user
    test_app.dependency_overrides[get_async_db] = lambda: None
    test_app.include_router(operations_router, prefix=API_PREFIX)
    return test_app


@pytest.fixture(autouse=True)
def _fresh_rate_limit_bucket():
    """Item 10 put a 5/min cap on the delete route; without a per-test reset
    the sixth DELETE in this module would 429 and the assertions after it
    would be testing the limiter instead of the mapping."""
    from app.middleware.rate_limit import user_limiter

    user_limiter.reset()
    yield
    user_limiter.reset()


@pytest.fixture(autouse=True)
def _no_coord_mappings():
    """The delete route reads coord's ``group_tenant_roles`` before it may
    touch AWS. Every test here is about what happens AT AWS, so the mapping
    read is stubbed empty — the guards themselves are pinned in
    ``test_operations_cognito_group_delete_guards.py``."""
    with patch(
        "app.api.v1.endpoints.operations._coord_group_tenant_role_rows",
        AsyncMock(return_value=[]),
    ):
        yield


@pytest.fixture()
def client() -> TestClient:
    return TestClient(_build_admin_app())


def _aws(code: str, message: str = "") -> ClientError:
    return ClientError({"Error": {"Code": code, "Message": message or code}}, "Op")


def _wrapped(code: str, message: str = "") -> Exception:
    """The exception ``cognito_admin`` would raise for this boto3 error."""
    exc = _aws(code, message)
    return cognito_admin._wrap_aws_error(exc, f"Op failed: {exc}")


class _Boom:
    """A ``cognito_admin`` function replacement that always raises."""

    def __init__(self, exc: Exception) -> None:
        self.exc = exc
        self.calls: list[tuple[Any, ...]] = []

    def __call__(self, *args: Any) -> Any:
        self.calls.append(args)
        raise self.exc


def _ok_resolver(username: str = "u1"):
    def _resolve(_email: str) -> str:
        return username

    return _resolve


# ---------------------------------------------------------------------------
# Item 11 — the group-name validator reaches the PATH parameter
# ---------------------------------------------------------------------------

#: URL-safe but invalid as a Cognito ``groupName``: the constraint
#: ``[\p{L}\p{M}\p{S}\p{N}\p{P}]+`` excludes separators, so a percent-encoded
#: space is a name Cognito can never hold.
_BAD_NAME = "bad%20name"


class TestMalformedPathGroupNameIs400:
    def test_delete_rejects_it_before_aws(self, client: TestClient):
        deleter = _Boom(RuntimeError("must not be reached"))
        with patch.object(cognito_admin, "delete_group", deleter):
            resp = client.delete(f"{_GROUPS_URL}/{_BAD_NAME}", headers=_AUTH)

        assert resp.status_code == 400, resp.text
        assert "group_name" in resp.json()["detail"]
        assert deleter.calls == []

    def test_list_members_rejects_it_before_aws(self, client: TestClient):
        lister = _Boom(RuntimeError("must not be reached"))
        with patch.object(cognito_admin, "list_users_in_group", lister):
            resp = client.get(f"{_GROUPS_URL}/{_BAD_NAME}/users", headers=_AUTH)

        assert resp.status_code == 400, resp.text
        assert lister.calls == []

    def test_add_member_rejects_it_before_resolving_the_email(self, client: TestClient):
        """The validator is a dependency, so it runs before the handler does
        any work at all — including the email lookup, which is its own AWS
        round-trip."""
        resolver = _Boom(RuntimeError("must not be reached"))
        with patch.object(cognito_admin, "resolve_username_for_email", resolver):
            resp = client.post(
                f"{_GROUPS_URL}/{_BAD_NAME}/users",
                json={"email": "a@example.com"},
                headers=_AUTH,
            )

        assert resp.status_code == 400, resp.text
        assert resolver.calls == []

    def test_remove_member_rejects_it_before_resolving_the_email(
        self, client: TestClient
    ):
        resolver = _Boom(RuntimeError("must not be reached"))
        with patch.object(cognito_admin, "resolve_username_for_email", resolver):
            resp = client.request(
                "DELETE",
                f"{_GROUPS_URL}/{_BAD_NAME}/users",
                json={"email": "a@example.com"},
                headers=_AUTH,
            )

        assert resp.status_code == 400, resp.text
        assert resolver.calls == []

    def test_the_delete_validator_runs_before_the_coord_mapping_read(
        self, client: TestClient
    ):
        """A name Cognito could never hold is not worth a coord round-trip,
        and a 502 ``mapping_check_unavailable`` would be a confusing answer
        to a typo."""
        with patch(
            "app.api.v1.endpoints.operations._coord_group_tenant_role_rows",
            AsyncMock(side_effect=AssertionError("coord must not be read")),
        ):
            resp = client.delete(f"{_GROUPS_URL}/{_BAD_NAME}", headers=_AUTH)

        assert resp.status_code == 400, resp.text

    def test_a_valid_name_still_gets_through(self, client: TestClient):
        """The validator must not become a blanket refusal."""
        with patch.object(cognito_admin, "delete_group", lambda name: None):
            resp = client.delete(f"{_GROUPS_URL}/acme-devs", headers=_AUTH)

        assert resp.status_code == 200, resp.text

    def test_the_create_route_is_not_double_validated(self, client: TestClient):
        """``create`` takes its name in ``_CreateGroupBody`` and
        ``cognito_admin.create_group`` already applies the same rule to it.
        The 400 must therefore still come from THERE — a second copy of the
        rule in the route is a copy that can drift."""
        boom = _Boom(cognito_admin.CognitoInvalidParameterError("group_name bad"))
        with patch.object(cognito_admin, "create_group", boom):
            resp = client.post(
                _GROUPS_URL, json={"group_name": "bad name"}, headers=_AUTH
            )

        assert resp.status_code == 400, resp.text
        # The service was reached — i.e. the route did not short-circuit it.
        assert boom.calls == [("bad name", None)]


# ---------------------------------------------------------------------------
# Item 12 — UserNotFoundException is 404, not 502
# ---------------------------------------------------------------------------


class TestUserNotFoundIs404:
    def test_boto3_message_defeats_the_old_text_test(self):
        """The premise of item 12, pinned so it cannot silently stop being
        true: boto3's rendering of this error contains neither token the old
        ``_is_resource_not_found`` looked for."""
        from app.api.v1.endpoints.operations import _is_resource_not_found

        exc = _wrapped("UserNotFoundException", "User does not exist.")
        rendered = str(exc)
        assert "ResourceNotFoundException" not in rendered
        assert "not found" not in rendered.lower()
        # ...and it is now classified by TYPE instead.
        assert isinstance(exc, cognito_admin.CognitoUserNotFoundError)
        assert not _is_resource_not_found(exc)

    def test_add_member_maps_it_to_404(self, client: TestClient):
        exc = _wrapped("UserNotFoundException", "User does not exist.")
        with (
            patch.object(cognito_admin, "resolve_username_for_email", _ok_resolver()),
            patch.object(cognito_admin, "add_user_to_group", _Boom(exc)),
        ):
            resp = client.post(
                f"{_GROUPS_URL}/acme-devs/users",
                json={"email": "ghost@example.com"},
                headers=_AUTH,
            )

        assert resp.status_code == 404, resp.text
        # The 404 must name the USER, not the group — the group is fine.
        assert "ghost@example.com" in resp.json()["detail"]

    def test_remove_member_maps_it_to_404(self, client: TestClient):
        exc = _wrapped("UserNotFoundException", "User does not exist.")
        with (
            patch.object(cognito_admin, "resolve_username_for_email", _ok_resolver()),
            patch.object(cognito_admin, "remove_user_from_group", _Boom(exc)),
        ):
            resp = client.request(
                "DELETE",
                f"{_GROUPS_URL}/acme-devs/users",
                json={"email": "ghost@example.com"},
                headers=_AUTH,
            )

        assert resp.status_code == 404, resp.text

    def test_it_is_reported_before_the_group_404(self, client: TestClient):
        """A missing user and a missing group are different repairs. The
        user arm is tried first so the message names the thing that is
        actually absent."""
        exc = _wrapped("UserNotFoundException", "User does not exist.")
        with (
            patch.object(cognito_admin, "resolve_username_for_email", _ok_resolver()),
            patch.object(cognito_admin, "add_user_to_group", _Boom(exc)),
        ):
            resp = client.post(
                f"{_GROUPS_URL}/acme-devs/users",
                json={"email": "ghost@example.com"},
                headers=_AUTH,
            )

        assert "No such group" not in resp.json()["detail"]


# ---------------------------------------------------------------------------
# Item 13 — TooManyRequestsException is 429, on every route
# ---------------------------------------------------------------------------


class TestThrottleIs429:
    def _throttle(self) -> Exception:
        return _wrapped("TooManyRequestsException", "Rate exceeded")

    def test_list_groups(self, client: TestClient):
        with patch.object(cognito_admin, "list_groups", _Boom(self._throttle())):
            resp = client.get(_GROUPS_URL, headers=_AUTH)
        assert resp.status_code == 429, resp.text
        assert resp.json()["detail"]["error"] == "cognito_throttled"
        assert resp.headers["Retry-After"] == "5"

    def test_create_group(self, client: TestClient):
        with patch.object(cognito_admin, "create_group", _Boom(self._throttle())):
            resp = client.post(
                _GROUPS_URL, json={"group_name": "acme-devs"}, headers=_AUTH
            )
        assert resp.status_code == 429, resp.text

    def test_delete_group(self, client: TestClient):
        with patch.object(cognito_admin, "delete_group", _Boom(self._throttle())):
            resp = client.delete(f"{_GROUPS_URL}/acme-devs", headers=_AUTH)
        assert resp.status_code == 429, resp.text

    def test_list_group_members(self, client: TestClient):
        with patch.object(
            cognito_admin, "list_users_in_group", _Boom(self._throttle())
        ):
            resp = client.get(f"{_GROUPS_URL}/acme-devs/users", headers=_AUTH)
        assert resp.status_code == 429, resp.text

    def test_add_member_throttled_on_the_email_lookup(self, client: TestClient):
        """The membership routes make TWO AWS calls; either can be
        throttled, so both arms have to map."""
        with patch.object(
            cognito_admin, "resolve_username_for_email", _Boom(self._throttle())
        ):
            resp = client.post(
                f"{_GROUPS_URL}/acme-devs/users",
                json={"email": "a@example.com"},
                headers=_AUTH,
            )
        assert resp.status_code == 429, resp.text

    def test_add_member_throttled_on_the_group_write(self, client: TestClient):
        with (
            patch.object(cognito_admin, "resolve_username_for_email", _ok_resolver()),
            patch.object(cognito_admin, "add_user_to_group", _Boom(self._throttle())),
        ):
            resp = client.post(
                f"{_GROUPS_URL}/acme-devs/users",
                json={"email": "a@example.com"},
                headers=_AUTH,
            )
        assert resp.status_code == 429, resp.text

    def test_remove_member_throttled_on_the_group_write(self, client: TestClient):
        with (
            patch.object(cognito_admin, "resolve_username_for_email", _ok_resolver()),
            patch.object(
                cognito_admin, "remove_user_from_group", _Boom(self._throttle())
            ),
        ):
            resp = client.request(
                "DELETE",
                f"{_GROUPS_URL}/acme-devs/users",
                json={"email": "a@example.com"},
                headers=_AUTH,
            )
        assert resp.status_code == 429, resp.text

    def test_the_generic_aws_throttling_spelling_maps_too(self, client: TestClient):
        """``ThrottlingException`` is the generic AWS SDK spelling and turns
        up on the same admin calls. Mapping only Cognito's own spelling
        would leave half of all throttles reported as 502."""
        exc = _wrapped("ThrottlingException", "Rate exceeded")
        with patch.object(cognito_admin, "delete_group", _Boom(exc)):
            resp = client.delete(f"{_GROUPS_URL}/acme-devs", headers=_AUTH)
        assert resp.status_code == 429, resp.text

    def test_the_message_does_not_blame_the_upstream(self, client: TestClient):
        """A throttle means AWS is HEALTHY and asking us to slow down.
        Copy that says the upstream is broken sends the operator debugging
        Cognito instead of waiting five seconds."""
        with patch.object(cognito_admin, "delete_group", _Boom(self._throttle())):
            resp = client.delete(f"{_GROUPS_URL}/acme-devs", headers=_AUTH)
        message = resp.json()["detail"]["message"].lower()
        assert "retry" in message
        assert "nothing was changed" in message


# ---------------------------------------------------------------------------
# Item 14 — a pool misconfiguration is not a missing group
# ---------------------------------------------------------------------------


class TestPoolMisconfigurationIsNotAMissingGroup:
    def test_a_pool_shaped_resource_not_found_is_500_not_404(self, client: TestClient):
        """Cognito answers a wrong ``UserPoolId`` with
        ``ResourceNotFoundException: User pool <id> does not exist.`` —
        exactly the code a missing GROUP produces. Reporting it as
        ``404 No such group`` sends the operator hunting for a group that
        was never the problem while the real fault stays invisible."""
        exc = _wrapped(
            "ResourceNotFoundException",
            "User pool us-east-1_WRONG does not exist.",
        )
        with patch.object(cognito_admin, "delete_group", _Boom(exc)):
            resp = client.delete(f"{_GROUPS_URL}/acme-devs", headers=_AUTH)

        assert resp.status_code == 500, resp.text
        detail = resp.json()["detail"]
        assert detail["error"] == "cognito_pool_misconfigured"
        assert "COGNITO_USER_POOL_ID" in detail["message"]
        assert "No such group" not in detail["message"]

    def test_a_group_shaped_resource_not_found_is_still_404(self, client: TestClient):
        """The other half of the distinction: an ordinary missing group must
        keep its 404, or item 14 would have traded one wrong answer for
        another."""
        exc = _wrapped("ResourceNotFoundException", "Group not found.")
        with patch.object(cognito_admin, "delete_group", _Boom(exc)):
            resp = client.delete(f"{_GROUPS_URL}/acme-devs", headers=_AUTH)

        assert resp.status_code == 404, resp.text
        assert resp.json()["detail"] == "No such group: acme-devs"

    def test_an_unset_pool_id_is_the_same_fault(self, client: TestClient):
        """An absent ``COGNITO_USER_POOL_ID`` never reaches AWS at all, but
        it is the identical deployment fault and must read identically."""
        exc = cognito_admin.CognitoConfigurationError(
            "COGNITO_USER_POOL_ID is not configured"
        )
        with patch.object(cognito_admin, "list_groups", _Boom(exc)):
            resp = client.get(_GROUPS_URL, headers=_AUTH)

        assert resp.status_code == 500, resp.text
        assert resp.json()["detail"]["error"] == "cognito_pool_misconfigured"

    def test_the_classifier_reads_the_message_not_the_code(self):
        """Both arms carry the SAME ``Error.Code``; only the message
        separates them. Pinned here so the classifier's one text dependency
        is visible rather than buried."""
        pool = _wrapped(
            "ResourceNotFoundException", "User pool us-east-1_X does not exist."
        )
        group = _wrapped("ResourceNotFoundException", "Group not found.")
        assert pool.aws_error_code == group.aws_error_code
        assert isinstance(pool, cognito_admin.CognitoConfigurationError)
        assert isinstance(group, cognito_admin.CognitoResourceNotFoundError)

    def test_a_genuinely_broken_upstream_is_still_502(self, client: TestClient):
        """502 keeps its meaning. If everything mapped to something else it
        would stop being a signal at all."""
        exc = _wrapped("InternalErrorException", "boom")
        with patch.object(cognito_admin, "delete_group", _Boom(exc)):
            resp = client.delete(f"{_GROUPS_URL}/acme-devs", headers=_AUTH)

        assert resp.status_code == 502, resp.text


# ---------------------------------------------------------------------------
# Item 15 — the description cap is enforced at the schema
# ---------------------------------------------------------------------------


class TestDescriptionIsCapped:
    def test_an_over_long_description_is_422_before_aws(self, client: TestClient):
        """Cognito caps ``Description`` at 2048; without the constraint a
        longer one spent an AWS round-trip to come back
        ``InvalidParameterException`` and was reported as 502."""
        creator = _Boom(RuntimeError("must not be reached"))
        with patch.object(cognito_admin, "create_group", creator):
            resp = client.post(
                _GROUPS_URL,
                json={"group_name": "acme-devs", "description": "x" * 2049},
                headers=_AUTH,
            )

        assert resp.status_code == 422, resp.text
        assert creator.calls == []

    def test_the_cap_itself_is_allowed(self, client: TestClient):
        """Exactly 2048 is what Cognito accepts, so the schema must too —
        an off-by-one here would refuse valid input."""
        seen: list[Any] = []

        def _create(name: str, description: str | None = None) -> dict[str, Any]:
            seen.append((name, description))
            return {"group_name": name}

        with patch.object(cognito_admin, "create_group", _create):
            resp = client.post(
                _GROUPS_URL,
                json={"group_name": "acme-devs", "description": "x" * 2048},
                headers=_AUTH,
            )

        assert resp.status_code == 200, resp.text
        assert seen[0][1] == "x" * 2048

    def test_the_cap_matches_cognitos(self):
        from app.api.v1.endpoints.operations import (
            _COGNITO_GROUP_DESCRIPTION_MAX,
        )

        assert _COGNITO_GROUP_DESCRIPTION_MAX == 2048
