"""AWS Cognito admin operations for cross-IdP account linking.

Option A — Cognito-native linking. The whole stack keys identity on the
Cognito ``sub``; this module is the admin-API half that links / unlinks
external (federated) identities to a canonical Cognito-native user via
``AdminLinkProviderForUser`` / ``AdminDisableProviderForUser`` and reads
the current link set via ``AdminGetUser``.

Lazy boto3 client (mirrors
``app/services/email/email_transport_service.py``): the
``cognito-idp`` client is built on first use, never at import time, so a
module import (and FastAPI app construction) never touches AWS. The
client uses the IAM task role in AWS and ambient creds locally.

IAM actions the web task role needs on the pool ARN
``arn:aws:cognito-idp:us-east-1:047719635665:userpool/us-east-1_rgTB9dbZ1``:

* ``cognito-idp:ListUsers``              (resolve_username_for_sub)
* ``cognito-idp:AdminGetUser``           (list_user_identities)
* ``cognito-idp:AdminLinkProviderForUser``     (link_provider)
* ``cognito-idp:AdminDisableProviderForUser``  (unlink_provider)
* ``cognito-idp:AdminDeleteUser``        (delete_federated_user — takeover-clean only)
"""

from __future__ import annotations

import json
import unicodedata
from collections.abc import Iterator
from typing import Any

import boto3
import structlog
from botocore.exceptions import BotoCoreError, ClientError

from app.core.config import settings

logger = structlog.get_logger(__name__)

# Cognito stores the linked-identity set as a single user-attribute named
# ``identities`` whose value is a JSON-encoded array.
_IDENTITIES_ATTRIBUTE = "identities"

# The synthetic provider name for the native (Cognito-pool-local) identity.
_NATIVE_PROVIDER = "Cognito"


class CognitoAdminError(RuntimeError):
    """Raised when a Cognito admin operation fails irrecoverably.

    Carries the originating boto3 ``Error.Code`` on ``aws_error_code`` when
    there was one. The endpoint layer maps AWS failures onto HTTP statuses,
    and doing that from a *code* rather than by searching the rendered
    message is the difference between a mapping that holds and one that
    breaks the next time AWS rewords a sentence. ``None`` means the failure
    carried no code at all — a ``BotoCoreError`` raised before AWS answered.
    """

    def __init__(self, *args: Any, aws_error_code: str | None = None) -> None:
        super().__init__(*args)
        self.aws_error_code = aws_error_code


class CognitoGroupExistsError(CognitoAdminError):
    """Raised by :func:`create_group` when the group already exists.

    Distinct subclass so the endpoint layer can map it to HTTP 409 without
    string-matching the boto3 error message.
    """


class CognitoInvalidParameterError(CognitoAdminError):
    """Raised when Cognito rejects an argument as malformed (not a fault).

    Distinct subclass so the endpoint layer can map it to HTTP 400 without
    string-matching the boto3 error message. The canonical case is a
    ``groupName`` that violates Cognito's own character constraint (a space,
    say): that is a CLIENT error the caller can fix by retyping, and
    collapsing it into a 502 would tell the operator AWS is broken when
    nothing is.
    """


class CognitoAmbiguousEmailError(CognitoAdminError):
    """Raised by :func:`resolve_username_for_email` when >1 user matches.

    Distinct subclass so the endpoint layer can map it to HTTP 409/422
    rather than silently picking one of several matching pool users.
    """


class CognitoResourceNotFoundError(CognitoAdminError):
    """A pool resource named by the CALLER is absent (→ 404).

    The canonical case is a group name that does not exist in the pool.
    Deliberately distinct from :class:`CognitoConfigurationError` below,
    which is the SAME ``ResourceNotFoundException`` code arriving for a
    completely different reason.
    """


class CognitoConfigurationError(CognitoAdminError):
    """The user pool itself is missing or misconfigured (→ 5xx, not 404).

    Two ways to get here: ``COGNITO_USER_POOL_ID`` is unset, or it names a
    pool that does not exist — in which case Cognito answers
    ``ResourceNotFoundException``, exactly the code a missing *group*
    produces. Collapsing the two reports a server misconfiguration as "no
    such group", which sends an operator hunting for a group that was never
    the problem while the real fault (a bad pool id in this deployment's
    settings) stays invisible.
    """


class CognitoUserNotFoundError(CognitoAdminError):
    """No pool user matches the identifier supplied (→ 404).

    boto3 renders ``UserNotFoundException`` with the message
    ``User does not exist.`` — which contains neither
    ``"ResourceNotFoundException"`` nor the substring ``"not found"``, so
    the endpoint layer's old text test fell straight through it into a 502
    that claimed AWS was broken.
    """


class CognitoThrottledError(CognitoAdminError):
    """Cognito is rate-limiting this pool's admin API (→ 429, not 502).

    A throttle means AWS is healthy and is asking us to slow down. Reporting
    it as 502 tells the operator the upstream is broken and sends them
    debugging Cognito instead of retrying in a few seconds.
    """


#: boto3 ``Error.Code`` values that mean "slow down". ``TooManyRequests-
#: Exception`` is Cognito's own spelling; ``ThrottlingException`` is the
#: generic AWS one and shows up on the same admin calls, so mapping only one
#: would leave half of all throttles reported as broken-upstream 502s.
_THROTTLE_CODES = frozenset({"TooManyRequestsException", "ThrottlingException"})


def _aws_error_code(exc: BaseException) -> str | None:
    """The boto3 ``Error.Code`` of a ``ClientError``, else ``None``.

    ``BotoCoreError`` carries no ``response`` at all — it is raised before
    AWS answers (DNS, credentials, connection) — and ``None`` is the honest
    answer for it rather than a guessed code.
    """
    response = getattr(exc, "response", None)
    if not isinstance(response, dict):
        return None
    error = response.get("Error")
    if not isinstance(error, dict):
        return None
    code = error.get("Code")
    return code if isinstance(code, str) and code else None


def _aws_error_message(exc: BaseException) -> str:
    """AWS's own ``Error.Message``, falling back to the rendered exception."""
    response = getattr(exc, "response", None)
    if isinstance(response, dict):
        error = response.get("Error")
        if isinstance(error, dict):
            message = error.get("Message")
            if isinstance(message, str) and message:
                return message
    return str(exc)


def _names_the_user_pool(aws_message: str) -> bool:
    """True when a ``ResourceNotFoundException`` is about the POOL.

    Cognito answers a wrong or absent ``UserPoolId`` with
    ``User pool us-east-1_XXXX does not exist.`` and a missing group with
    ``Group not found.``. Both are ``ResourceNotFoundException``, so the
    message is the ONLY thing that separates "this deployment is
    misconfigured" from "that group is gone". The message is used here and
    nowhere else: if AWS rewords it, the fallback is the old behaviour (a
    404 naming the group), never a wrong 200.
    """
    return "user pool" in aws_message.lower()


def _wrap_aws_error(exc: BaseException, message: str) -> CognitoAdminError:
    """Classify a boto3 failure into the subclass carrying its HTTP meaning.

    One place decides what an AWS error *means*, so the endpoint layer maps
    types instead of grepping strings — and a new mapping is added once
    rather than once per handler.
    """
    code = _aws_error_code(exc)
    if code in _THROTTLE_CODES:
        return CognitoThrottledError(message, aws_error_code=code)
    if code == "UserNotFoundException":
        return CognitoUserNotFoundError(message, aws_error_code=code)
    if code == "ResourceNotFoundException":
        if _names_the_user_pool(_aws_error_message(exc)):
            return CognitoConfigurationError(message, aws_error_code=code)
        return CognitoResourceNotFoundError(message, aws_error_code=code)
    return CognitoAdminError(message, aws_error_code=code)


# Lazy process-wide client. Built on first use (never at import time) so a
# module import does not call AWS. Reset to ``None`` is never needed in
# normal operation; tests may monkeypatch ``_get_client``.
_client: Any = None


def _get_client() -> Any:
    """Return the lazily-constructed ``cognito-idp`` boto3 client.

    Mirrors the lazy-init pattern in
    :class:`app.services.email.email_transport_service.EmailTransportService`:
    the client is created on first call, bound to ``settings.COGNITO_REGION``,
    and reused for the process lifetime.
    """
    global _client
    if _client is None:
        _client = boto3.client("cognito-idp", region_name=settings.COGNITO_REGION)
        logger.info(
            "cognito_admin_client_initialized",
            region=settings.COGNITO_REGION,
            pool_id=settings.COGNITO_USER_POOL_ID,
        )
    return _client


def _pool_id() -> str:
    """The configured pool id, or a typed configuration fault.

    ``CognitoConfigurationError`` rather than a bare ``CognitoAdminError``:
    an unset ``COGNITO_USER_POOL_ID`` is the same fault as a pool id that
    names nothing, and both must reach the caller as a server
    misconfiguration rather than as "no such group".
    """
    pool_id = settings.COGNITO_USER_POOL_ID
    if not pool_id:
        raise CognitoConfigurationError("COGNITO_USER_POOL_ID is not configured")
    return pool_id


#: ``ListUsers`` page size. Cognito's documented maximum is 60.
_LIST_USERS_PAGE_SIZE = 60

#: Hard stop on the paging loop. ``PaginationToken`` is supplied by AWS; a
#: pathological pool (or an AWS bug) that kept handing one back would
#: otherwise spin a worker thread forever. 40 pages x 60 = 2400 users
#: scanned for a single *filtered* lookup, far past any legitimate answer —
#: and hitting it raises rather than returning ``None``, because "I gave up"
#: is UNKNOWN, not "no such user".
_LIST_USERS_MAX_PAGES = 40


def _iter_list_users(
    filter_expression: str, *, log_event: str, **log_context: Any
) -> Iterator[list[dict[str, Any]]]:
    """Yield each ``ListUsers`` page for ``filter_expression``.

    ``Limit`` on ``ListUsers`` is a **per-page** cap, not a result cap:
    Cognito applies the filter *after* selecting the page, so a filtered
    query legitimately returns an EMPTY page carrying a ``PaginationToken``
    with the only match on a later page. Reading page one and stopping —
    which is what both resolvers used to do — therefore reports a user who
    exists as absent. Following the token to exhaustion is the only correct
    read.

    The caller may stop iterating as soon as its answer is fixed; the
    remaining pages are then never fetched.
    """
    client = _get_client()
    pool_id = _pool_id()
    token: str | None = None
    for _ in range(_LIST_USERS_MAX_PAGES):
        kwargs: dict[str, Any] = {
            "UserPoolId": pool_id,
            # Cognito ListUsers Filter syntax: attribute = "value".
            "Filter": filter_expression,
            "Limit": _LIST_USERS_PAGE_SIZE,
        }
        if token:
            kwargs["PaginationToken"] = token
        try:
            resp = client.list_users(**kwargs)
        except (BotoCoreError, ClientError) as exc:
            logger.error(log_event, error=str(exc), **log_context)
            raise _wrap_aws_error(exc, f"ListUsers failed: {exc}") from exc
        users = resp.get("Users") or []
        yield [user for user in users if isinstance(user, dict)]
        token = resp.get("PaginationToken")
        if not token:
            return
    logger.error(
        "cognito_list_users_pagination_capped",
        pages=_LIST_USERS_MAX_PAGES,
        **log_context,
    )
    raise CognitoAdminError(
        f"ListUsers did not terminate within {_LIST_USERS_MAX_PAGES} pages"
    )


def resolve_username_for_sub(sub: str) -> str | None:
    """Resolve the pool ``Username`` for a Cognito ``sub``.

    In this pool the ``Username`` is NOT equal to the ``sub`` — a native
    user such as ``josh@qontinui.io`` has a human-readable username and a
    distinct opaque ``sub``. We therefore filter ``ListUsers`` by the
    ``sub`` attribute and return the matched ``Username``.

    Returns ``None`` when no user matches the ``sub``.

    Paginated (see :func:`_iter_list_users`). This resolver backs
    ``/api/v1/auth/identities`` for EVERY signed-in user, not just admins,
    so a first-page miss here logged people out of their own linked-identity
    page with "No Cognito user matches this account."
    """
    if not sub:
        return None
    for users in _iter_list_users(
        f'sub = "{sub}"', log_event="cognito_list_users_failed", sub=sub
    ):
        for user in users:
            # ``sub`` is unique in a pool, so the first match is the answer.
            username = user.get("Username")
            if isinstance(username, str) and username:
                return username
    return None


def _attributes_to_dict(attributes: list[dict[str, Any]]) -> dict[str, str]:
    """Flatten a Cognito ``[{Name, Value}, ...]`` attribute list to a dict."""
    out: dict[str, str] = {}
    for attr in attributes or []:
        name = attr.get("Name")
        value = attr.get("Value")
        if isinstance(name, str):
            out[name] = value if isinstance(value, str) else ""
    return out


def list_user_identities(username: str) -> list[dict[str, Any]]:
    """Return the linked identities for ``username``.

    Calls ``AdminGetUser`` and parses the ``identities`` user-attribute
    (a JSON array of ``{providerName, providerType, userId, primary,
    dateCreated}``). Returns one entry per linked *external* identity PLUS
    a synthetic native entry (``provider == "Cognito"``) so callers can
    always see the canonical native identity. ``email`` /
    ``email_verified`` are attached where available (from the user's own
    attributes).

    Each returned dict has the shape:
        {provider, provider_type, user_id, primary, email, email_verified}
    """
    client = _get_client()
    try:
        resp = client.admin_get_user(UserPoolId=_pool_id(), Username=username)
    except (BotoCoreError, ClientError) as exc:
        logger.error("cognito_admin_get_user_failed", username=username, error=str(exc))
        raise _wrap_aws_error(exc, f"AdminGetUser failed: {exc}") from exc

    attrs = _attributes_to_dict(resp.get("UserAttributes") or [])
    email = attrs.get("email")
    email_verified_raw = attrs.get("email_verified")
    email_verified: bool | None
    if email_verified_raw is None:
        email_verified = None
    else:
        email_verified = email_verified_raw.lower() == "true"

    identities: list[dict[str, Any]] = []

    # Synthetic native (Cognito-pool-local) identity. ``user_id`` is the
    # pool Username — the value used as the link DestinationUser.
    identities.append(
        {
            "provider": _NATIVE_PROVIDER,
            "provider_type": _NATIVE_PROVIDER,
            "user_id": username,
            "primary": True,
            "email": email,
            "email_verified": email_verified,
        }
    )

    raw_identities = attrs.get(_IDENTITIES_ATTRIBUTE)
    if raw_identities:
        try:
            parsed = json.loads(raw_identities)
        except (ValueError, TypeError) as exc:
            logger.warning(
                "cognito_identities_attribute_unparseable",
                username=username,
                error=str(exc),
            )
            parsed = []
        if isinstance(parsed, list):
            for ident in parsed:
                if not isinstance(ident, dict):
                    continue
                identities.append(
                    {
                        "provider": ident.get("providerName"),
                        "provider_type": ident.get("providerType"),
                        "user_id": ident.get("userId"),
                        "primary": bool(ident.get("primary", False)),
                        # Federated identity carries no separate email in
                        # the identities attribute; surface the account email.
                        "email": email,
                        "email_verified": email_verified,
                    }
                )

    return identities


def link_provider(
    destination_username: str, source_provider: str, source_user_id: str
) -> None:
    """Link a federated (source) identity to a native (destination) user.

    ``AdminLinkProviderForUser`` merges the source federated identity into
    the destination native account so both resolve to the same Cognito
    ``sub`` going forward.

    SourceUser shape per the Cognito admin API: the source provider's
    subject is addressed by ``ProviderAttributeName="Cognito_Subject"`` +
    ``ProviderAttributeValue=<the federated userId>``. (See REPORT for the
    per-provider-type caveat.)

    Idempotent: an "already linked" / ``InvalidParameterException``
    containing "already" is treated as success.
    """
    client = _get_client()
    try:
        client.admin_link_provider_for_user(
            UserPoolId=_pool_id(),
            DestinationUser={
                "ProviderName": _NATIVE_PROVIDER,
                "ProviderAttributeValue": destination_username,
            },
            SourceUser={
                "ProviderName": source_provider,
                "ProviderAttributeName": "Cognito_Subject",
                "ProviderAttributeValue": source_user_id,
            },
        )
    except ClientError as exc:
        message = str(exc)
        # Idempotency: a re-link of an already-linked identity is a no-op.
        if "already" in message.lower():
            logger.info(
                "cognito_link_already_linked",
                destination_username=destination_username,
                source_provider=source_provider,
            )
            return
        logger.error(
            "cognito_link_provider_failed",
            destination_username=destination_username,
            source_provider=source_provider,
            error=message,
        )
        raise _wrap_aws_error(exc, f"AdminLinkProviderForUser failed: {exc}") from exc
    except BotoCoreError as exc:
        raise _wrap_aws_error(exc, f"AdminLinkProviderForUser failed: {exc}") from exc

    logger.info(
        "cognito_link_provider_ok",
        destination_username=destination_username,
        source_provider=source_provider,
    )


def unlink_provider(
    destination_username: str, source_provider: str, source_user_id: str
) -> None:
    """Unlink a federated identity from the destination native user.

    ``AdminDisableProviderForUser`` removes the source federated identity's
    link to the account. The SourceUser shape mirrors :func:`link_provider`.
    """
    client = _get_client()
    try:
        client.admin_disable_provider_for_user(
            UserPoolId=_pool_id(),
            User={
                "ProviderName": source_provider,
                "ProviderAttributeName": "Cognito_Subject",
                "ProviderAttributeValue": source_user_id,
            },
        )
    except (BotoCoreError, ClientError) as exc:
        logger.error(
            "cognito_unlink_provider_failed",
            destination_username=destination_username,
            source_provider=source_provider,
            error=str(exc),
        )
        raise _wrap_aws_error(
            exc, f"AdminDisableProviderForUser failed: {exc}"
        ) from exc

    logger.info(
        "cognito_unlink_provider_ok",
        destination_username=destination_username,
        source_provider=source_provider,
    )


def delete_federated_user(username: str) -> None:
    """Delete a pool user. Used ONLY by the takeover-clean path in /link.

    When a presented federated identity already exists as its OWN pool
    user (auto-provisioned on its first federated login), it must be
    deleted before it can be linked into the canonical account — otherwise
    Cognito rejects the link as a duplicate. This is SAFE in the /link
    flow because the caller proved control of BOTH the canonical account
    (authenticated) AND the federated identity (presented a fresh token
    for it).
    """
    client = _get_client()
    try:
        client.admin_delete_user(UserPoolId=_pool_id(), Username=username)
    except ClientError as exc:
        message = str(exc)
        # If the federated user does not exist, the takeover-clean is a
        # no-op — nothing to delete before linking.
        if "UserNotFoundException" in message or "not found" in message.lower():
            logger.info("cognito_delete_user_absent", username=username)
            return
        logger.error("cognito_delete_user_failed", username=username, error=message)
        raise _wrap_aws_error(exc, f"AdminDeleteUser failed: {exc}") from exc
    except BotoCoreError as exc:
        raise _wrap_aws_error(exc, f"AdminDeleteUser failed: {exc}") from exc

    logger.info("cognito_delete_user_ok", username=username)


# ---------------------------------------------------------------------------
# Group administration
# ---------------------------------------------------------------------------
#
# Pool-wide group CRUD + group-membership management. The web + coord share
# the SAME user pool (``us-east-1_rgTB9dbZ1``), so a group created here flows
# straight into coord's ``cognito:groups`` token claim — completing in-
# dashboard provisioning. All functions mirror the module style: a lazily-
# built ``_get_client()`` + ``_pool_id()``, structured logging, and boto3
# errors wrapped in :class:`CognitoAdminError` (or a more specific subclass)
# so the endpoint layer maps them to HTTP codes without string-matching.
#
# IAM actions the web task role additionally needs on the pool ARN:
#
# * ``cognito-idp:ListGroups``               (list_groups)
# * ``cognito-idp:CreateGroup``              (create_group)
# * ``cognito-idp:DeleteGroup``              (delete_group)
# * ``cognito-idp:ListUsersInGroup``         (list_users_in_group)
# * ``cognito-idp:ListUsers``                (resolve_username_for_email)
# * ``cognito-idp:AdminAddUserToGroup``      (add_user_to_group)
# * ``cognito-idp:AdminRemoveUserFromGroup`` (remove_user_from_group)


def _iso(value: Any) -> str | None:
    """Render a boto3 datetime field as an ISO-8601 string (or ``None``)."""
    if value is None:
        return None
    isoformat = getattr(value, "isoformat", None)
    if callable(isoformat):
        return str(isoformat())
    return str(value)


def _group_to_dict(group: dict[str, Any]) -> dict[str, Any]:
    """Flatten a Cognito ``GroupType`` to the wire shape callers expect."""
    return {
        "group_name": group.get("GroupName"),
        "description": group.get("Description"),
        "creation_date": _iso(group.get("CreationDate")),
        "last_modified_date": _iso(group.get("LastModifiedDate")),
        "precedence": group.get("Precedence"),
    }


def list_groups() -> list[dict[str, Any]]:
    """Return every group in the pool (paginated fully).

    Each entry: ``{group_name, description, creation_date,
    last_modified_date, precedence}``. Datetime fields are ISO strings.
    """
    client = _get_client()
    groups: list[dict[str, Any]] = []
    try:
        paginator = client.get_paginator("list_groups")
        for page in paginator.paginate(UserPoolId=_pool_id()):
            for group in page.get("Groups") or []:
                groups.append(_group_to_dict(group))
    except (BotoCoreError, ClientError) as exc:
        logger.error("cognito_list_groups_failed", error=str(exc))
        raise _wrap_aws_error(exc, f"ListGroups failed: {exc}") from exc

    logger.info("cognito_list_groups_ok", count=len(groups))
    return groups


def invalid_group_name_reason(name: str) -> str | None:
    r"""Why ``name`` cannot be a Cognito group name, or None if it can.

    Mirrors Cognito's ``groupName`` constraint ``[\p{L}\p{M}\p{S}\p{N}\p{P}]+``
    without a ``regex`` dependency: the complement of that class is exactly
    separators and control characters.
    """
    if not name:
        return "must not be empty"
    if len(name) > 128:
        return "must be at most 128 characters"
    if any(ch.isspace() or unicodedata.category(ch)[0] == "C" for ch in name):
        return "must not contain spaces or control characters"
    return None


def create_group(group_name: str, description: str | None = None) -> dict[str, Any]:
    """Create a group; return the created group's wire dict.

    Raises :class:`CognitoGroupExistsError` (→ 409) when a group with that
    name already exists, so the endpoint can report a clean conflict instead
    of a generic 502.

    Raises :class:`CognitoInvalidParameterError` (→ 400) when the name cannot
    satisfy Cognito's ``groupName`` constraint. The local pre-check runs
    FIRST so the common case (a space in the name) never spends an AWS
    round-trip; the ``InvalidParameterException`` branch below still catches
    any constraint we did not anticipate, so an unforeseen one surfaces as
    the client error it is rather than as a 502.
    """
    reason = invalid_group_name_reason(group_name)
    if reason is not None:
        logger.info(
            "cognito_create_group_invalid_name", group_name=group_name, reason=reason
        )
        raise CognitoInvalidParameterError(f"group_name {reason}")
    client = _get_client()
    kwargs: dict[str, Any] = {"UserPoolId": _pool_id(), "GroupName": group_name}
    if description:
        kwargs["Description"] = description
    try:
        resp = client.create_group(**kwargs)
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "")
        if code == "GroupExistsException":
            logger.info("cognito_create_group_exists", group_name=group_name)
            raise CognitoGroupExistsError(
                f"Group already exists: {group_name}"
            ) from exc
        if code == "InvalidParameterException":
            # A constraint the local pre-check does not model. Carry AWS's own
            # message so the operator reads the real reason, not "502".
            message = exc.response.get("Error", {}).get("Message") or str(exc)
            logger.info(
                "cognito_create_group_invalid_parameter",
                group_name=group_name,
                error=message,
            )
            raise CognitoInvalidParameterError(message) from exc
        logger.error(
            "cognito_create_group_failed", group_name=group_name, error=str(exc)
        )
        raise _wrap_aws_error(exc, f"CreateGroup failed: {exc}") from exc
    except BotoCoreError as exc:
        logger.error(
            "cognito_create_group_failed", group_name=group_name, error=str(exc)
        )
        raise _wrap_aws_error(exc, f"CreateGroup failed: {exc}") from exc

    logger.info("cognito_create_group_ok", group_name=group_name)
    return _group_to_dict(resp.get("Group") or {})


def delete_group(group_name: str) -> None:
    """Delete a group. No-op-safe is NOT assumed — a missing group surfaces
    as a :class:`CognitoAdminError` the endpoint maps to 404."""
    client = _get_client()
    try:
        client.delete_group(UserPoolId=_pool_id(), GroupName=group_name)
    except (BotoCoreError, ClientError) as exc:
        logger.error(
            "cognito_delete_group_failed", group_name=group_name, error=str(exc)
        )
        raise _wrap_aws_error(exc, f"DeleteGroup failed: {exc}") from exc

    logger.info("cognito_delete_group_ok", group_name=group_name)


def list_users_in_group(group_name: str) -> list[dict[str, Any]]:
    """Return the users in ``group_name`` (paginated fully).

    Each entry: ``{username, email, status, enabled}``. ``email`` is pulled
    from the user's ``Attributes`` list.
    """
    client = _get_client()
    users: list[dict[str, Any]] = []
    try:
        paginator = client.get_paginator("list_users_in_group")
        for page in paginator.paginate(UserPoolId=_pool_id(), GroupName=group_name):
            for user in page.get("Users") or []:
                attrs = _attributes_to_dict(user.get("Attributes") or [])
                users.append(
                    {
                        "username": user.get("Username"),
                        "email": attrs.get("email"),
                        "status": user.get("UserStatus"),
                        "enabled": user.get("Enabled"),
                    }
                )
    except (BotoCoreError, ClientError) as exc:
        logger.error(
            "cognito_list_users_in_group_failed",
            group_name=group_name,
            error=str(exc),
        )
        raise _wrap_aws_error(exc, f"ListUsersInGroup failed: {exc}") from exc

    logger.info(
        "cognito_list_users_in_group_ok", group_name=group_name, count=len(users)
    )
    return users


def resolve_username_for_email(email: str) -> str | None:
    """Resolve the pool ``Username`` for a verified-or-not account ``email``.

    Filters ``ListUsers`` by the ``email`` attribute across ALL pages.
    Returns the single match's ``Username``; returns ``None`` when zero users
    match; raises :class:`CognitoAmbiguousEmailError` (→ 409/422) when more
    than one user matches (the email is not a unique key in every pool
    config, so the caller must disambiguate rather than guess).

    It used to pass ``Limit=2`` and read only the first page. ``Limit`` is a
    per-page cap, so an empty first page — routine for a filtered query —
    made this return ``None``, which the endpoint reported as
    ``404 No user with email`` and the dashboard rendered as "they must sign
    up first": actively misleading about a user who exists.

    Ambiguity is decided over the WHOLE result set, not per page: two
    matches split across two pages are still two matches. The moment a
    second one appears the answer is fixed, so paging stops there rather
    than reading the pool to the end.

    The Cognito ``ListUsers`` Filter syntax is ``attribute = "value"`` with
    the value double-quoted; any embedded double-quote in the email is
    stripped to keep the filter well-formed (a ``"`` is never valid in an
    addr-spec local part unquoted, so this cannot match a legitimate user).
    """
    if not email:
        return None
    safe_email = email.replace('"', "")
    matched: list[dict[str, Any]] = []
    for users in _iter_list_users(
        f'email = "{safe_email}"',
        log_event="cognito_list_users_by_email_failed",
    ):
        matched.extend(users)
        if len(matched) > 1:
            logger.warning("cognito_email_ambiguous", count=len(matched))
            raise CognitoAmbiguousEmailError(f"Multiple users match email: {email}")
    if not matched:
        return None
    username = matched[0].get("Username")
    if not isinstance(username, str) or not username:
        return None
    return username


def add_user_to_group(username: str, group_name: str) -> None:
    """Add ``username`` to ``group_name`` (``AdminAddUserToGroup``)."""
    client = _get_client()
    try:
        client.admin_add_user_to_group(
            UserPoolId=_pool_id(), Username=username, GroupName=group_name
        )
    except (BotoCoreError, ClientError) as exc:
        logger.error(
            "cognito_add_user_to_group_failed",
            username=username,
            group_name=group_name,
            error=str(exc),
        )
        raise _wrap_aws_error(exc, f"AdminAddUserToGroup failed: {exc}") from exc

    logger.info(
        "cognito_add_user_to_group_ok", username=username, group_name=group_name
    )


def remove_user_from_group(username: str, group_name: str) -> None:
    """Remove ``username`` from ``group_name`` (``AdminRemoveUserFromGroup``)."""
    client = _get_client()
    try:
        client.admin_remove_user_from_group(
            UserPoolId=_pool_id(), Username=username, GroupName=group_name
        )
    except (BotoCoreError, ClientError) as exc:
        logger.error(
            "cognito_remove_user_from_group_failed",
            username=username,
            group_name=group_name,
            error=str(exc),
        )
        raise _wrap_aws_error(exc, f"AdminRemoveUserFromGroup failed: {exc}") from exc

    logger.info(
        "cognito_remove_user_from_group_ok",
        username=username,
        group_name=group_name,
    )
