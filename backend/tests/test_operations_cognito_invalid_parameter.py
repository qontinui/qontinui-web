"""A malformed argument is **400** on every Cognito route, not just create.

Follow-up to web #1099 (plan
``2026-08-27-tenant-creation-fix-and-members-page-ux``, Defect 2). That PR
introduced ``CognitoInvalidParameterError`` and the local
``invalid_group_name_reason`` pre-check, and wired both into exactly ONE of
the five Cognito routes — ``POST /coord/cognito/groups``. The other four take
the group name from a **URL path segment**, so they can be handed
``test admins`` just as easily, and every one of them still collapsed
Cognito's ``InvalidParameterException`` into

    502 {"detail": "Could not delete Cognito group."}

telling the operator AWS was broken when the input was simply invalid. The
principle #1099 stated — *502 stays reserved for a genuinely broken upstream,
which is the only thing that makes it a useful signal* — is only true if it
holds on every route.

## What each test would catch

* **The pre-check tests** (``fake.calls == []``) go red if a route stops
  validating locally and starts spending an AWS round-trip on a name Cognito
  could never have accepted. They assert the call list, not just the status,
  because a 400 arrived at via a wasted round-trip is a different behaviour
  wearing the same status code.
* **The AWS-branch tests** use a name that PASSES the local pre-check, so the
  request really does reach boto3 — otherwise they would pin the pre-check
  twice and the ``InvalidParameterException`` branch not at all.
* **The 502 tests** are the other half of the claim. Narrowing the 400 case is
  only worth doing if 502 keeps meaning "the upstream is broken"; delete the
  typed arm's ordering (put ``except CognitoAdminError`` first) and the 400
  tests go red while these stay green, which is exactly the regression that
  shipped on four routes.

``CognitoInvalidParameterError`` is a SUBCLASS of ``CognitoAdminError``, so
the ordering of the ``except`` arms is what makes this work at all — see
``operations._invalid_parameter_http``.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
from botocore.exceptions import ClientError
from fastapi import FastAPI
from fastapi.testclient import TestClient

API_PREFIX = "/api/v1/operations"

# A name with a space: the exact input from the production report, and the one
# the local pre-check must reject without asking AWS.
_BAD_NAME = "test admins"
_BAD_NAME_ENCODED = "test%20admins"
# Passes the local pre-check, so a request carrying it REACHES boto3.
_GOOD_NAME = "test-admins"

# AWS's own sentence for the constraint, quoted verbatim from the incident.
_AWS_MESSAGE = (
    "1 validation error detected: Value 'test admins' at 'groupName' "
    "failed to satisfy constraint: Member must satisfy regular "
    "expression pattern: [\\p{L}\\p{M}\\p{S}\\p{N}\\p{P}]+"
)


def _client_error(code: str, message: str) -> ClientError:
    return ClientError({"Error": {"Code": code, "Message": message}}, "Op")


class _FakeCognitoClient:
    """Records every boto3 call and raises a configured error per method.

    ``list_users`` answers with one match by default so the add/remove member
    routes get past the email resolution and actually reach the group call —
    the step under test.
    """

    def __init__(self, raises: dict[str, Exception] | None = None) -> None:
        self.calls: list[str] = []
        self._raises = raises or {}

    def _record(self, method: str, **_: Any) -> Any:
        self.calls.append(method)
        if method in self._raises:
            raise self._raises[method]
        return {}

    def create_group(self, **kw: Any) -> Any:
        return self._record("create_group", **kw)

    def delete_group(self, **kw: Any) -> Any:
        return self._record("delete_group", **kw)

    def admin_add_user_to_group(self, **kw: Any) -> Any:
        return self._record("admin_add_user_to_group", **kw)

    def admin_remove_user_from_group(self, **kw: Any) -> Any:
        return self._record("admin_remove_user_from_group", **kw)

    def list_users(self, **kw: Any) -> Any:
        self._record("list_users", **kw)
        return {"Users": [{"Username": "u1"}]}

    def get_paginator(self, op: str) -> Any:
        return _FakePaginator(self, op)


class _FakePaginator:
    def __init__(self, client: _FakeCognitoClient, op: str) -> None:
        self._client = client
        self._op = op

    def paginate(self, **kw: Any) -> list[dict[str, Any]]:
        self._client._record(self._op, **kw)
        return [{"Users": []}]


def _build_admin_app() -> FastAPI:
    from app.api.deps import (
        get_async_db,
        get_current_active_user_async,
        get_current_user_async,
    )
    from app.api.v1.endpoints.operations import router as operations_router

    app = FastAPI()
    user = MagicMock()
    user.id = uuid4()
    user.email = "operator@example.com"
    user.is_active = True
    user.is_verified = True
    # `require_admin` reads `is_superuser` off this same user, so the real
    # dependency still runs rather than being replaced by a second override.
    user.is_superuser = True
    app.dependency_overrides[get_current_active_user_async] = lambda: user
    app.dependency_overrides[get_current_user_async] = lambda: user
    app.dependency_overrides[get_async_db] = lambda: None
    app.include_router(operations_router, prefix=API_PREFIX)
    return app


@pytest.fixture()
def admin_client() -> TestClient:
    return TestClient(_build_admin_app())


@pytest.fixture()
def no_mappings() -> Any:
    """Stub the delete route's coord blast-radius read to "no mappings".

    Those guards have their own suite
    (``test_operations_cognito_group_delete_guards.py``); what is under test
    here is the AWS-error classification that runs after them, and a real
    coord read would fail for reasons that have nothing to do with it.
    """
    with patch(
        "app.api.v1.endpoints.operations._coord_group_tenant_role_rows",
        new=AsyncMock(return_value=[]),
    ) as stub:
        yield stub


def _detail(resp: Any) -> str:
    detail = resp.json()["detail"]
    assert isinstance(detail, str), f"expected a plain-string detail, got {detail!r}"
    return detail


# ---------------------------------------------------------------------------
# The local pre-check: a name Cognito could never accept costs no round-trip
# ---------------------------------------------------------------------------


class TestLocalPreCheckOnEveryGroupRoute:
    """Refusing locally cannot deny a legitimate operation: a name this
    rejects is one Cognito would refuse to CREATE, so no group in the pool can
    bear it, and there is nothing to delete, list or add a member to."""

    def test_delete_group(self, admin_client: TestClient, no_mappings: Any) -> None:
        from app.services import cognito_admin

        fake = _FakeCognitoClient()
        with patch.object(cognito_admin, "_get_client", return_value=fake):
            resp = admin_client.delete(
                f"{API_PREFIX}/coord/cognito/groups/{_BAD_NAME_ENCODED}"
            )

        assert resp.status_code == 400
        assert fake.calls == []
        assert "spaces" in _detail(resp)
        assert "Could not delete Cognito group" not in _detail(resp)
        # The check runs BEFORE the blast-radius guards, so coord is not asked
        # to compute the blast radius of a group that cannot exist.
        assert no_mappings.await_count == 0

    def test_delete_group_answers_the_name_before_the_home_guard(
        self, admin_client: TestClient, no_mappings: Any
    ) -> None:
        """Guard ordering, pinned.

        `my tenant-home` ends in ``HOME_GROUP_SUFFIX``, so with the name check
        after the guards it answered **409 home_group_requires_override** —
        asking the operator to pass a flag to override a guard protecting a
        group Cognito could never have created. The reason they can act on is
        the name, so the name has to be answered first.
        """
        from app.services import cognito_admin

        fake = _FakeCognitoClient()
        with patch.object(cognito_admin, "_get_client", return_value=fake):
            resp = admin_client.delete(
                f"{API_PREFIX}/coord/cognito/groups/my%20tenant-home"
            )

        assert resp.status_code == 400
        assert "spaces" in _detail(resp)
        assert fake.calls == []

    def test_list_group_users(self, admin_client: TestClient) -> None:
        from app.services import cognito_admin

        fake = _FakeCognitoClient()
        with patch.object(cognito_admin, "_get_client", return_value=fake):
            resp = admin_client.get(
                f"{API_PREFIX}/coord/cognito/groups/{_BAD_NAME_ENCODED}/users"
            )

        assert resp.status_code == 400
        assert fake.calls == []
        assert "spaces" in _detail(resp)

    def test_add_group_user(self, admin_client: TestClient) -> None:
        from app.services import cognito_admin

        fake = _FakeCognitoClient()
        with patch.object(cognito_admin, "_get_client", return_value=fake):
            resp = admin_client.post(
                f"{API_PREFIX}/coord/cognito/groups/{_BAD_NAME_ENCODED}/users",
                json={"email": "u1@example.com"},
            )

        assert resp.status_code == 400
        # The email IS resolved first — that ordering is the route's, not this
        # test's — but `admin_add_user_to_group` is never reached.
        assert "admin_add_user_to_group" not in fake.calls
        assert "spaces" in _detail(resp)

    def test_remove_group_user(self, admin_client: TestClient) -> None:
        from app.services import cognito_admin

        fake = _FakeCognitoClient()
        with patch.object(cognito_admin, "_get_client", return_value=fake):
            resp = admin_client.request(
                "DELETE",
                f"{API_PREFIX}/coord/cognito/groups/{_BAD_NAME_ENCODED}/users",
                json={"email": "u1@example.com"},
            )

        assert resp.status_code == 400
        assert "admin_remove_user_from_group" not in fake.calls
        assert "spaces" in _detail(resp)


# ---------------------------------------------------------------------------
# AWS's own InvalidParameterException: 400 carrying its reason, never 502
# ---------------------------------------------------------------------------


class TestAwsInvalidParameterOnEveryGroupRoute:
    """A constraint the local pre-check does not model must still arrive as
    the client error it is, carrying AWS's sentence — that is what tells the
    operator what to retype."""

    def test_delete_group(self, admin_client: TestClient, no_mappings: Any) -> None:
        from app.services import cognito_admin

        fake = _FakeCognitoClient(
            {"delete_group": _client_error("InvalidParameterException", _AWS_MESSAGE)}
        )
        with patch.object(cognito_admin, "_get_client", return_value=fake):
            resp = admin_client.delete(
                f"{API_PREFIX}/coord/cognito/groups/{_GOOD_NAME}"
            )

        assert "delete_group" in fake.calls, "the AWS branch was never reached"
        assert resp.status_code == 400
        assert "groupName" in _detail(resp)

    def test_list_group_users(self, admin_client: TestClient) -> None:
        from app.services import cognito_admin

        fake = _FakeCognitoClient(
            {
                "list_users_in_group": _client_error(
                    "InvalidParameterException", _AWS_MESSAGE
                )
            }
        )
        with patch.object(cognito_admin, "_get_client", return_value=fake):
            resp = admin_client.get(
                f"{API_PREFIX}/coord/cognito/groups/{_GOOD_NAME}/users"
            )

        assert "list_users_in_group" in fake.calls
        assert resp.status_code == 400
        assert "groupName" in _detail(resp)

    def test_add_group_user(self, admin_client: TestClient) -> None:
        from app.services import cognito_admin

        fake = _FakeCognitoClient(
            {
                "admin_add_user_to_group": _client_error(
                    "InvalidParameterException", _AWS_MESSAGE
                )
            }
        )
        with patch.object(cognito_admin, "_get_client", return_value=fake):
            resp = admin_client.post(
                f"{API_PREFIX}/coord/cognito/groups/{_GOOD_NAME}/users",
                json={"email": "u1@example.com"},
            )

        assert "admin_add_user_to_group" in fake.calls
        assert resp.status_code == 400
        assert "groupName" in _detail(resp)

    def test_remove_group_user(self, admin_client: TestClient) -> None:
        from app.services import cognito_admin

        fake = _FakeCognitoClient(
            {
                "admin_remove_user_from_group": _client_error(
                    "InvalidParameterException", _AWS_MESSAGE
                )
            }
        )
        with patch.object(cognito_admin, "_get_client", return_value=fake):
            resp = admin_client.request(
                "DELETE",
                f"{API_PREFIX}/coord/cognito/groups/{_GOOD_NAME}/users",
                json={"email": "u1@example.com"},
            )

        assert "admin_remove_user_from_group" in fake.calls
        assert resp.status_code == 400
        assert "groupName" in _detail(resp)

    def test_email_resolution(self, admin_client: TestClient) -> None:
        """A ``ListUsers`` filter Cognito will not parse is the caller's typo.

        The route's own error sentence — "Could not resolve user by email." —
        names no cause at all, so answering 502 with it is the least useful
        thing this path can say.
        """
        from app.services import cognito_admin

        fake = _FakeCognitoClient(
            {
                "list_users": _client_error(
                    "InvalidParameterException", "Invalid filter expression"
                )
            }
        )
        with patch.object(cognito_admin, "_get_client", return_value=fake):
            resp = admin_client.post(
                f"{API_PREFIX}/coord/cognito/groups/{_GOOD_NAME}/users",
                json={"email": 'bad"filter@example.com'},
            )

        assert resp.status_code == 400
        assert "Could not resolve user by email" not in _detail(resp)
        assert "filter" in _detail(resp).lower()


# ---------------------------------------------------------------------------
# 502 still means "the upstream is broken"
# ---------------------------------------------------------------------------


class TestBrokenUpstreamIsStill502:
    """The other half of the claim. Without these, narrowing the 400 case
    could be "achieved" by mapping every AWS failure to 400."""

    def test_delete_group(self, admin_client: TestClient, no_mappings: Any) -> None:
        from app.services import cognito_admin

        fake = _FakeCognitoClient(
            {
                "delete_group": _client_error(
                    "InternalErrorException", "Cognito is having a day"
                )
            }
        )
        with patch.object(cognito_admin, "_get_client", return_value=fake):
            resp = admin_client.delete(
                f"{API_PREFIX}/coord/cognito/groups/{_GOOD_NAME}"
            )

        assert resp.status_code == 502
        assert _detail(resp) == "Could not delete Cognito group."

    def test_list_group_users(self, admin_client: TestClient) -> None:
        from app.services import cognito_admin

        fake = _FakeCognitoClient(
            {
                "list_users_in_group": _client_error(
                    "InternalErrorException", "Cognito is having a day"
                )
            }
        )
        with patch.object(cognito_admin, "_get_client", return_value=fake):
            resp = admin_client.get(
                f"{API_PREFIX}/coord/cognito/groups/{_GOOD_NAME}/users"
            )

        assert resp.status_code == 502
        assert _detail(resp) == "Could not list group members."

    def test_add_group_user(self, admin_client: TestClient) -> None:
        from app.services import cognito_admin

        fake = _FakeCognitoClient(
            {
                "admin_add_user_to_group": _client_error(
                    "InternalErrorException", "Cognito is having a day"
                )
            }
        )
        with patch.object(cognito_admin, "_get_client", return_value=fake):
            resp = admin_client.post(
                f"{API_PREFIX}/coord/cognito/groups/{_GOOD_NAME}/users",
                json={"email": "u1@example.com"},
            )

        assert resp.status_code == 502
        assert _detail(resp) == "Could not add user to group."


# ---------------------------------------------------------------------------
# A missing group is still 404 — the arm that runs INSIDE the generic handler
# ---------------------------------------------------------------------------


class TestMissingGroupIsStill404:
    """``_is_resource_not_found`` is checked inside the generic
    ``CognitoAdminError`` arm. Inserting the typed 400 arm above it must not
    shadow it — a group that genuinely does not exist is neither malformed
    input nor a broken upstream."""

    def test_delete_group(self, admin_client: TestClient, no_mappings: Any) -> None:
        from app.services import cognito_admin

        fake = _FakeCognitoClient(
            {
                "delete_group": _client_error(
                    "ResourceNotFoundException", "Group not found"
                )
            }
        )
        with patch.object(cognito_admin, "_get_client", return_value=fake):
            resp = admin_client.delete(
                f"{API_PREFIX}/coord/cognito/groups/{_GOOD_NAME}"
            )

        assert resp.status_code == 404
        assert _GOOD_NAME in _detail(resp)
