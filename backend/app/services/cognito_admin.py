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
    """Raised when a Cognito admin operation fails irrecoverably."""


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
    pool_id = settings.COGNITO_USER_POOL_ID
    if not pool_id:
        raise CognitoAdminError("COGNITO_USER_POOL_ID is not configured")
    return pool_id


def resolve_username_for_sub(sub: str) -> str | None:
    """Resolve the pool ``Username`` for a Cognito ``sub``.

    In this pool the ``Username`` is NOT equal to the ``sub`` — a native
    user such as ``josh@qontinui.io`` has a human-readable username and a
    distinct opaque ``sub``. We therefore filter ``ListUsers`` by the
    ``sub`` attribute and return the matched ``Username``.

    Returns ``None`` when no user matches the ``sub``.
    """
    if not sub:
        return None
    client = _get_client()
    try:
        resp = client.list_users(
            UserPoolId=_pool_id(),
            # Cognito ListUsers Filter syntax: attribute = "value".
            Filter=f'sub = "{sub}"',
            Limit=1,
        )
    except (BotoCoreError, ClientError) as exc:
        logger.error("cognito_list_users_failed", sub=sub, error=str(exc))
        raise CognitoAdminError(f"ListUsers failed for sub: {exc}") from exc

    users = resp.get("Users") or []
    if not users:
        return None
    username = users[0].get("Username")
    if not isinstance(username, str) or not username:
        return None
    return username


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
        logger.error(
            "cognito_admin_get_user_failed", username=username, error=str(exc)
        )
        raise CognitoAdminError(f"AdminGetUser failed: {exc}") from exc

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
        raise CognitoAdminError(f"AdminLinkProviderForUser failed: {exc}") from exc
    except BotoCoreError as exc:
        raise CognitoAdminError(f"AdminLinkProviderForUser failed: {exc}") from exc

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
        raise CognitoAdminError(
            f"AdminDisableProviderForUser failed: {exc}"
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
        logger.error(
            "cognito_delete_user_failed", username=username, error=message
        )
        raise CognitoAdminError(f"AdminDeleteUser failed: {exc}") from exc
    except BotoCoreError as exc:
        raise CognitoAdminError(f"AdminDeleteUser failed: {exc}") from exc

    logger.info("cognito_delete_user_ok", username=username)
