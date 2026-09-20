"""``create_invited_user`` / ``send_invitation`` — the two halves of an invite.

Plan ``2026-09-15-simplify-tenant-member-add-by-email`` Phase 3.

The split is the design, so it is what these tests pin:

* **Creating sends nothing.** ``MessageAction="SUPPRESS"`` on create means
  the endpoint can grant tenant access BEFORE anybody is emailed. An email for
  a grant that then failed would be a promise broken on first sign-in.
* **Sending is always a RESEND over EMAIL.** One call serves the first send
  and a re-invite after an expired temporary password.
* **The account is born email-verified.** The pool's PreSignUp autolink only
  merges a later Google / Microsoft sign-in into a native account whose email
  is verified; without it that sign-in creates a second, grant-less user.
"""

from __future__ import annotations

from typing import Any

import pytest
from botocore.exceptions import ClientError

from app.core.config import settings
from app.services import cognito_admin
from app.services.cognito_admin import (
    CognitoAdminError,
    CognitoInvalidParameterError,
    CognitoUserExistsError,
)


def _client_error(code: str, message: str = "boom") -> ClientError:
    return ClientError({"Error": {"Code": code, "Message": message}}, "AdminCreateUser")


class _CreateClient:
    def __init__(self, response: Any = None, error: Exception | None = None) -> None:
        self._response = response
        self._error = error
        self.calls: list[dict[str, Any]] = []

    def admin_create_user(self, **kwargs: Any) -> Any:
        self.calls.append(kwargs)
        if self._error is not None:
            raise self._error
        return self._response


@pytest.fixture
def install(monkeypatch: pytest.MonkeyPatch):
    def _install(client: _CreateClient) -> _CreateClient:
        monkeypatch.setattr(cognito_admin, "_get_client", lambda: client)
        monkeypatch.setattr(settings, "COGNITO_USER_POOL_ID", "pool-xyz")
        return client

    return _install


def _created(
    username: str = "new@x.io",
    sub: str = "s-new",
    status: Any = "FORCE_CHANGE_PASSWORD",
):
    user: dict[str, Any] = {
        "Username": username,
        "Attributes": [
            {"Name": "sub", "Value": sub},
            {"Name": "email", "Value": username},
        ],
    }
    if status is not None:
        user["UserStatus"] = status
    return {"User": user}


class TestCreateInvitedUser:
    def test_it_suppresses_the_email_and_verifies_the_address(self, install):
        client = install(_CreateClient(response=_created()))

        identity = cognito_admin.create_invited_user("new@x.io")

        (call,) = client.calls
        assert call["MessageAction"] == "SUPPRESS"
        assert "DesiredDeliveryMediums" not in call
        assert call["Username"] == "new@x.io"
        assert {"Name": "email_verified", "Value": "true"} in call["UserAttributes"]
        assert {"Name": "email", "Value": "new@x.io"} in call["UserAttributes"]
        assert identity == cognito_admin.CognitoIdentity(
            username="new@x.io", sub="s-new", status="FORCE_CHANGE_PASSWORD"
        )

    def test_the_sub_comes_from_cognito_not_the_caller(self, install):
        install(_CreateClient(response=_created(sub="cognito-assigned")))

        assert cognito_admin.create_invited_user("new@x.io").sub == "cognito-assigned"

    def test_a_missing_status_is_pending_by_construction(self, install):
        install(_CreateClient(response=_created(status=None)))

        identity = cognito_admin.create_invited_user("new@x.io")

        assert identity.status == cognito_admin.INVITATION_PENDING_STATUS

    def test_an_existing_username_is_its_own_error(self, install):
        install(_CreateClient(error=_client_error("UsernameExistsException")))

        with pytest.raises(CognitoUserExistsError):
            cognito_admin.create_invited_user("new@x.io")

    def test_an_invalid_parameter_carries_aws_reason(self, install):
        install(
            _CreateClient(
                error=_client_error(
                    "InvalidParameterException", "Invalid email address format."
                )
            )
        )

        with pytest.raises(
            CognitoInvalidParameterError, match="Invalid email address format"
        ):
            cognito_admin.create_invited_user("not an email")

    def test_a_denied_grant_is_not_swallowed(self, install):
        install(_CreateClient(error=_client_error("AccessDeniedException")))

        with pytest.raises(CognitoAdminError) as info:
            cognito_admin.create_invited_user("new@x.io")
        assert not isinstance(info.value, CognitoUserExistsError)

    def test_a_response_without_a_sub_is_an_error(self, install):
        install(
            _CreateClient(response={"User": {"Username": "new@x.io", "Attributes": []}})
        )

        with pytest.raises(CognitoAdminError, match="no 'sub' attribute"):
            cognito_admin.create_invited_user("new@x.io")

    def test_a_response_without_a_user_is_an_error(self, install):
        install(_CreateClient(response={}))

        with pytest.raises(CognitoAdminError, match="no usable user"):
            cognito_admin.create_invited_user("new@x.io")


class TestSendInvitation:
    def test_it_is_a_resend_over_email_to_the_pool_username(self, install):
        client = install(_CreateClient(response=_created()))

        cognito_admin.send_invitation("the-username")

        (call,) = client.calls
        assert call["MessageAction"] == "RESEND"
        assert call["DesiredDeliveryMediums"] == ["EMAIL"]
        assert call["Username"] == "the-username"
        assert call["UserPoolId"] == "pool-xyz"

    def test_it_sends_no_attributes(self, install):
        """The email was set at create. An attribute on a RESEND could only
        disagree with it — and if applied, rewrite it and risk clearing
        ``email_verified``, which the autolink depends on."""
        client = install(_CreateClient(response=_created()))

        cognito_admin.send_invitation("the-username")

        assert "UserAttributes" not in client.calls[0]

    def test_an_accepted_invitation_keeps_its_aws_code(self, install):
        install(_CreateClient(error=_client_error("UnsupportedUserStateException")))

        with pytest.raises(CognitoAdminError) as info:
            cognito_admin.send_invitation("u")
        assert info.value.aws_error_code == "UnsupportedUserStateException"


class TestResolverCarriesStatus:
    def test_the_listusers_status_rides_along(self, monkeypatch):
        class _C:
            def list_users(self, **kwargs: Any) -> dict[str, Any]:
                return {
                    "Users": [
                        {
                            "Username": "u1",
                            "UserStatus": "FORCE_CHANGE_PASSWORD",
                            "Attributes": [{"Name": "sub", "Value": "s-1"}],
                        }
                    ]
                }

        monkeypatch.setattr(cognito_admin, "_get_client", lambda: _C())
        monkeypatch.setattr(settings, "COGNITO_USER_POOL_ID", "pool-xyz")

        identity = cognito_admin.resolve_identity_for_email("u1@x.io")

        assert identity is not None
        assert identity.status == cognito_admin.INVITATION_PENDING_STATUS
