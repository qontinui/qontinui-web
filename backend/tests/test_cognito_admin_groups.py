"""Unit tests for the Cognito GROUP-admin functions in
``app.services.cognito_admin``.

These assert that each module-level group function calls the right boto3
method with the right arguments — the boto3 client is a fake (monkeypatched
via ``_get_client``), so NO real AWS call is ever made. The pool id comes
from ``settings.COGNITO_USER_POOL_ID`` via the module's ``_pool_id`` helper;
the tests assert it is threaded through verbatim.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import pytest
from botocore.exceptions import ClientError

from app.core.config import settings
from app.services import cognito_admin
from app.services.cognito_admin import (
    CognitoAdminError,
    CognitoAmbiguousEmailError,
    CognitoGroupExistsError,
)

# A datetime boto3 would return; the functions must ISO-render it.
_DT = datetime(2026, 6, 13, 12, 0, 0, tzinfo=UTC)


class _Paginator:
    """Minimal boto3 paginator stand-in: yields the pages it was built with."""

    def __init__(self, pages: list[dict[str, Any]]) -> None:
        self._pages = pages

    def paginate(self, **kwargs: Any) -> list[dict[str, Any]]:
        # Record the last paginate kwargs so tests can assert on them.
        self.last_kwargs = kwargs
        return self._pages


class _FakeClient:
    """Records every boto3 call; returns canned responses configured per-test."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, dict[str, Any]]] = []
        self._paginators: dict[str, _Paginator] = {}
        self._responses: dict[str, Any] = {}
        self._raises: dict[str, Exception] = {}

    # --- configuration helpers (test-only) ---
    def set_paginator(self, op: str, pages: list[dict[str, Any]]) -> None:
        self._paginators[op] = _Paginator(pages)

    def set_response(self, method: str, resp: Any) -> None:
        self._responses[method] = resp

    def set_raise(self, method: str, exc: Exception) -> None:
        self._raises[method] = exc

    # --- boto3 surface ---
    def get_paginator(self, op: str) -> _Paginator:
        return self._paginators[op]

    def _record(self, method: str, **kwargs: Any) -> Any:
        self.calls.append((method, kwargs))
        if method in self._raises:
            raise self._raises[method]
        return self._responses.get(method, {})

    def create_group(self, **kwargs: Any) -> Any:
        return self._record("create_group", **kwargs)

    def delete_group(self, **kwargs: Any) -> Any:
        return self._record("delete_group", **kwargs)

    def list_users(self, **kwargs: Any) -> Any:
        return self._record("list_users", **kwargs)

    def admin_add_user_to_group(self, **kwargs: Any) -> Any:
        return self._record("admin_add_user_to_group", **kwargs)

    def admin_remove_user_from_group(self, **kwargs: Any) -> Any:
        return self._record("admin_remove_user_from_group", **kwargs)


@pytest.fixture
def fake_client(monkeypatch: pytest.MonkeyPatch) -> _FakeClient:
    client = _FakeClient()
    monkeypatch.setattr(cognito_admin, "_get_client", lambda: client)
    # Pin a known pool id so assertions are deterministic.
    monkeypatch.setattr(settings, "COGNITO_USER_POOL_ID", "pool-xyz")
    return client


def _client_error(code: str) -> ClientError:
    return ClientError({"Error": {"Code": code, "Message": code}}, "Op")


# ---------------------------------------------------------------------------
# list_groups
# ---------------------------------------------------------------------------


def test_list_groups_paginates_and_flattens(fake_client: _FakeClient) -> None:
    fake_client.set_paginator(
        "list_groups",
        [
            {
                "Groups": [
                    {
                        "GroupName": "admins",
                        "Description": "the admins",
                        "CreationDate": _DT,
                        "LastModifiedDate": _DT,
                        "Precedence": 1,
                    }
                ]
            },
            {"Groups": [{"GroupName": "viewers"}]},
        ],
    )

    groups = cognito_admin.list_groups()

    assert [g["group_name"] for g in groups] == ["admins", "viewers"]
    first = groups[0]
    assert first["description"] == "the admins"
    assert first["creation_date"] == _DT.isoformat()
    assert first["last_modified_date"] == _DT.isoformat()
    assert first["precedence"] == 1
    # pool id threaded into paginate
    assert fake_client.get_paginator("list_groups").last_kwargs == {
        "UserPoolId": "pool-xyz"
    }


# ---------------------------------------------------------------------------
# create_group
# ---------------------------------------------------------------------------


def test_create_group_passes_name_and_description(fake_client: _FakeClient) -> None:
    fake_client.set_response(
        "create_group", {"Group": {"GroupName": "g1", "Description": "d"}}
    )

    result = cognito_admin.create_group("g1", "d")

    method, kwargs = fake_client.calls[0]
    assert method == "create_group"
    assert kwargs == {
        "UserPoolId": "pool-xyz",
        "GroupName": "g1",
        "Description": "d",
    }
    assert result["group_name"] == "g1"
    assert result["description"] == "d"


def test_create_group_omits_description_when_none(fake_client: _FakeClient) -> None:
    fake_client.set_response("create_group", {"Group": {"GroupName": "g1"}})
    cognito_admin.create_group("g1", None)
    _, kwargs = fake_client.calls[0]
    assert "Description" not in kwargs


def test_create_group_exists_raises_group_exists(fake_client: _FakeClient) -> None:
    fake_client.set_raise("create_group", _client_error("GroupExistsException"))
    with pytest.raises(CognitoGroupExistsError):
        cognito_admin.create_group("dupe", None)


def test_create_group_other_clienterror_wraps_admin_error(
    fake_client: _FakeClient,
) -> None:
    fake_client.set_raise("create_group", _client_error("InternalErrorException"))
    with pytest.raises(CognitoAdminError) as exc_info:
        cognito_admin.create_group("g1", None)
    # not the more-specific exists subclass
    assert not isinstance(exc_info.value, CognitoGroupExistsError)


# ---------------------------------------------------------------------------
# delete_group
# ---------------------------------------------------------------------------


def test_delete_group_calls_delete(fake_client: _FakeClient) -> None:
    cognito_admin.delete_group("g1")
    method, kwargs = fake_client.calls[0]
    assert method == "delete_group"
    assert kwargs == {"UserPoolId": "pool-xyz", "GroupName": "g1"}


def test_delete_group_error_wraps(fake_client: _FakeClient) -> None:
    fake_client.set_raise("delete_group", _client_error("ResourceNotFoundException"))
    with pytest.raises(CognitoAdminError):
        cognito_admin.delete_group("missing")


# ---------------------------------------------------------------------------
# list_users_in_group
# ---------------------------------------------------------------------------


def test_list_users_in_group_extracts_email_from_attributes(
    fake_client: _FakeClient,
) -> None:
    fake_client.set_paginator(
        "list_users_in_group",
        [
            {
                "Users": [
                    {
                        "Username": "u1",
                        "UserStatus": "CONFIRMED",
                        "Enabled": True,
                        "Attributes": [
                            {"Name": "email", "Value": "u1@example.com"},
                            {"Name": "sub", "Value": "abc"},
                        ],
                    }
                ]
            }
        ],
    )

    users = cognito_admin.list_users_in_group("admins")

    assert users == [
        {
            "username": "u1",
            "email": "u1@example.com",
            "status": "CONFIRMED",
            "enabled": True,
        }
    ]
    assert fake_client.get_paginator("list_users_in_group").last_kwargs == {
        "UserPoolId": "pool-xyz",
        "GroupName": "admins",
    }


# ---------------------------------------------------------------------------
# resolve_username_for_email
# ---------------------------------------------------------------------------


def test_resolve_email_single_match_returns_username(
    fake_client: _FakeClient,
) -> None:
    fake_client.set_response("list_users", {"Users": [{"Username": "u1"}]})

    username = cognito_admin.resolve_username_for_email("u1@example.com")

    assert username == "u1"
    _, kwargs = fake_client.calls[0]
    assert kwargs == {
        "UserPoolId": "pool-xyz",
        "Filter": 'email = "u1@example.com"',
        "Limit": 2,
    }


def test_resolve_email_no_match_returns_none(fake_client: _FakeClient) -> None:
    fake_client.set_response("list_users", {"Users": []})
    assert cognito_admin.resolve_username_for_email("nobody@example.com") is None


def test_resolve_email_ambiguous_raises(fake_client: _FakeClient) -> None:
    fake_client.set_response(
        "list_users", {"Users": [{"Username": "u1"}, {"Username": "u2"}]}
    )
    with pytest.raises(CognitoAmbiguousEmailError):
        cognito_admin.resolve_username_for_email("dupe@example.com")


def test_resolve_email_strips_embedded_quotes(fake_client: _FakeClient) -> None:
    fake_client.set_response("list_users", {"Users": []})
    cognito_admin.resolve_username_for_email('a"b@example.com')
    _, kwargs = fake_client.calls[0]
    # the embedded double-quote is stripped so the Filter stays well-formed
    assert kwargs["Filter"] == 'email = "ab@example.com"'


def test_resolve_email_empty_returns_none_without_call(
    fake_client: _FakeClient,
) -> None:
    assert cognito_admin.resolve_username_for_email("") is None
    assert fake_client.calls == []


# ---------------------------------------------------------------------------
# add_user_to_group / remove_user_from_group
# ---------------------------------------------------------------------------


def test_add_user_to_group_calls_admin_add(fake_client: _FakeClient) -> None:
    cognito_admin.add_user_to_group("u1", "admins")
    method, kwargs = fake_client.calls[0]
    assert method == "admin_add_user_to_group"
    assert kwargs == {
        "UserPoolId": "pool-xyz",
        "Username": "u1",
        "GroupName": "admins",
    }


def test_remove_user_from_group_calls_admin_remove(fake_client: _FakeClient) -> None:
    cognito_admin.remove_user_from_group("u1", "admins")
    method, kwargs = fake_client.calls[0]
    assert method == "admin_remove_user_from_group"
    assert kwargs == {
        "UserPoolId": "pool-xyz",
        "Username": "u1",
        "GroupName": "admins",
    }


def test_add_user_to_group_error_wraps(fake_client: _FakeClient) -> None:
    fake_client.set_raise(
        "admin_add_user_to_group", _client_error("UserNotFoundException")
    )
    with pytest.raises(CognitoAdminError):
        cognito_admin.add_user_to_group("ghost", "admins")
