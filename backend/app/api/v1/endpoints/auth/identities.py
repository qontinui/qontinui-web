"""Cross-IdP account-linking endpoints.

Option A — Cognito-native linking. The caller authenticates as their
canonical account (``get_current_active_user_async``); these endpoints let
them list, link, and unlink external (federated) identities that all
resolve to the same Cognito ``sub``.

Mounted under the auth router so the public paths are::

    GET    /api/v1/auth/identities
    POST   /api/v1/auth/identities/link
    DELETE /api/v1/auth/identities/{provider}

The federated identity to link is proved by a fresh Cognito ID token in
the POST body (the caller controls it). The takeover-clean delete in
/link is SAFE precisely because the caller proved control of BOTH the
canonical account (authenticated) and the federated identity (fresh
token).
"""

from __future__ import annotations

import asyncio
import json
from typing import Any

import structlog
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_async_db, get_current_active_user_async
from app.models.user import User
from app.schemas.identity import (
    IdentityListResponse,
    LinkedIdentity,
    LinkRequest,
)
from app.services import cognito_admin
from app.services.cognito_admin import CognitoAdminError
from app.services.cognito_jwks import (
    CognitoJWKSUnavailableError,
    CognitoTokenInvalidError,
    cognito_jwks_client,
)

logger = structlog.get_logger(__name__)
router = APIRouter()

_NATIVE_PROVIDER = "Cognito"


async def _resolve_username(current_user: User) -> str:
    """Resolve the caller's pool Username from their ``cognito_sub``.

    403 if the user has no ``cognito_sub`` (no Cognito identity); 404 if no
    pool user matches.
    """
    if not current_user.cognito_sub:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account has no Cognito identity; linking is unavailable.",
        )
    try:
        username = await asyncio.to_thread(
            cognito_admin.resolve_username_for_sub, current_user.cognito_sub
        )
    except CognitoAdminError as exc:
        logger.error("identities_resolve_username_failed", error=str(exc))
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Could not resolve Cognito account.",
        ) from exc
    if not username:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No Cognito user matches this account.",
        )
    return username


async def _list_identities(username: str) -> IdentityListResponse:
    try:
        raw = await asyncio.to_thread(cognito_admin.list_user_identities, username)
    except CognitoAdminError as exc:
        logger.error("identities_list_failed", error=str(exc))
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Could not read linked identities.",
        ) from exc
    return IdentityListResponse(
        identities=[LinkedIdentity.model_validate(i) for i in raw]
    )


async def _write_audit(
    db: AsyncSession,
    *,
    user_id: Any,
    action: str,
    provider: str,
    provider_user_id: str | None,
    actor_user_id: Any,
) -> None:
    """Insert an ``auth.identity_link_events`` audit row.

    Written via core SQL against the dedicated audit table (created by the
    accompanying alembic migration) rather than via an ORM model, keeping
    the audit surface decoupled from the User mapper.
    """
    await db.execute(
        text(
            """
            INSERT INTO auth.identity_link_events
                (user_id, action, provider, provider_user_id, actor_user_id)
            VALUES
                (:user_id, :action, :provider, :provider_user_id, :actor_user_id)
            """
        ),
        {
            "user_id": str(user_id),
            "action": action,
            "provider": provider,
            "provider_user_id": provider_user_id,
            "actor_user_id": str(actor_user_id),
        },
    )


def _federated_identity_from_claims(
    claims: dict[str, Any],
) -> tuple[str, str]:
    """Extract ``(providerName, userId)`` from a Cognito token's ``identities``.

    Cognito puts the federated identity in the ``identities`` claim, which
    is a JSON string (an array of identity objects) in user-pool tokens.
    Returns the first federated identity's ``(providerName, userId)``.

    400 if the token carries no federated identity (i.e. it is a
    native-Cognito token, not a federated one).
    """
    raw = claims.get("identities")
    parsed: Any = raw
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw)
        except (ValueError, TypeError) as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Token 'identities' claim is malformed.",
            ) from exc

    if not isinstance(parsed, list) or not parsed:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Token carries no federated identity to link.",
        )

    first = parsed[0]
    if not isinstance(first, dict):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Token 'identities' claim is malformed.",
        )
    provider = first.get("providerName")
    user_id = first.get("userId")
    if not isinstance(provider, str) or not isinstance(user_id, str):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Token federated identity is incomplete.",
        )
    return provider, user_id


@router.get("/identities", response_model=IdentityListResponse)
async def list_identities(
    *,
    current_user: User = Depends(get_current_active_user_async),
) -> IdentityListResponse:
    """List the identities linked to the caller's canonical account."""
    username = await _resolve_username(current_user)
    return await _list_identities(username)


@router.post("/identities/link", response_model=IdentityListResponse)
async def link_identity(
    *,
    body: LinkRequest,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> IdentityListResponse:
    """Link a federated identity (proved by a fresh ID token) to the caller.

    Flow:
      1. Verify the presented ID token via the shared Cognito JWKS verifier.
      2. Pull the federated ``(providerName, userId)`` from its
         ``identities`` claim.
      3. Resolve the caller's canonical pool Username from
         ``current_user.cognito_sub`` (the caller IS the canonical account).
      4. Takeover-clean: if the federated identity already exists as its
         own pool user, delete it first (SAFE — see module docstring).
      5. Link the federated identity into the canonical account.
      6. Audit + return the refreshed identity list.
    """
    # 1. Verify the presented token.
    try:
        claims = await cognito_jwks_client.verify_token(body.id_token)
    except CognitoJWKSUnavailableError as exc:
        logger.error("identities_link_jwks_unavailable", error=str(exc))
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Identity verification temporarily unavailable.",
        ) from exc
    except CognitoTokenInvalidError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Presented token is invalid or expired.",
        ) from exc

    # 2. Pull the federated identity from the token.
    provider, source_user_id = _federated_identity_from_claims(claims)

    # 3. Resolve canonical pool Username.
    canonical_username = await _resolve_username(current_user)

    # 4. Takeover-clean: if the federated identity auto-provisioned its own
    #    pool user (cognito:username on a federated token is e.g.
    #    "google_<userId>"), delete it before linking. SAFE here because the
    #    caller authenticated as canonical AND presented a fresh token for
    #    the federated identity.
    federated_pool_username = claims.get("cognito:username")
    if (
        isinstance(federated_pool_username, str)
        and federated_pool_username
        and federated_pool_username != canonical_username
    ):
        try:
            await asyncio.to_thread(
                cognito_admin.delete_federated_user, federated_pool_username
            )
        except CognitoAdminError as exc:
            logger.error("identities_link_takeover_clean_failed", error=str(exc))
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Could not prepare the federated identity for linking.",
            ) from exc

    # 5. Link.
    try:
        await asyncio.to_thread(
            cognito_admin.link_provider,
            canonical_username,
            provider,
            source_user_id,
        )
    except CognitoAdminError as exc:
        logger.error("identities_link_failed", provider=provider, error=str(exc))
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Could not link the identity.",
        ) from exc

    # 6. Audit + structlog + return refreshed list.
    await _write_audit(
        db,
        user_id=current_user.id,
        action="link",
        provider=provider,
        provider_user_id=source_user_id,
        actor_user_id=current_user.id,
    )
    await db.commit()
    logger.info(
        "identity_linked",
        user_id=str(current_user.id),
        provider=provider,
        provider_user_id=source_user_id,
    )
    return await _list_identities(canonical_username)


@router.delete("/identities/{provider}", response_model=IdentityListResponse)
async def unlink_identity(
    *,
    provider: str,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> IdentityListResponse:
    """Unlink ``provider`` from the caller.

    Lockout guard: refuses (409) to remove the caller's last/only identity.
    """
    canonical_username = await _resolve_username(current_user)
    identities = await _list_identities(canonical_username)

    # Locate the target identity (case-insensitive provider match).
    target = next(
        (
            i
            for i in identities.identities
            if i.provider and i.provider.lower() == provider.lower()
        ),
        None,
    )
    if target is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No linked identity for provider '{provider}'.",
        )

    # Lockout guard: never remove the last/only identity, and never unlink
    # the synthetic native identity (it is the account itself, not an
    # AdminDisableProviderForUser-removable link).
    if target.provider == _NATIVE_PROVIDER:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="The native Cognito identity cannot be unlinked.",
        )
    if len(identities.identities) <= 1:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Cannot remove the account's last identity (lockout guard).",
        )

    if not target.user_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Linked identity is missing its provider user id.",
        )

    try:
        await asyncio.to_thread(
            cognito_admin.unlink_provider,
            canonical_username,
            target.provider,
            target.user_id,
        )
    except CognitoAdminError as exc:
        logger.error("identities_unlink_failed", provider=provider, error=str(exc))
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Could not unlink the identity.",
        ) from exc

    await _write_audit(
        db,
        user_id=current_user.id,
        action="unlink",
        provider=target.provider,
        provider_user_id=target.user_id,
        actor_user_id=current_user.id,
    )
    await db.commit()
    logger.info(
        "identity_unlinked",
        user_id=str(current_user.id),
        provider=target.provider,
        provider_user_id=target.user_id,
    )
    return await _list_identities(canonical_username)
