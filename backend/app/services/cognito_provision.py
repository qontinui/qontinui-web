"""Resolve a verified Cognito token to a local ``auth.users`` row.

Phase 1 of the unified-Cognito-identity plan: provision-on-first-login.
Given the *already-verified* claims of a Cognito user-pool JWT, return
the matching :class:`~app.models.user.User`, creating or linking one as
needed. The resolution order is:

1. **By Cognito sub** — a row whose ``cognito_sub`` already equals the
   token's ``sub``. This is the steady-state path after the first login.
2. **Link by verified email** — an existing user with the same email gets
   its ``cognito_sub`` stamped, unifying the identity. Requires the
   token's ``email_verified`` to be true (an unverified email must never
   be trusted to claim an existing account — that would be an
   account-takeover vector).
3. **Create** — no existing row matches; mint a fresh ``auth.users`` row
   from the token claims (email, name, ``cognito_sub``). Cognito is the
   sole authentication mechanism; the row carries no local password.

This mirrors ``qontinui-coord/src/auth_sso.rs::lookup_or_provision_operator``
(the coord operator equivalent) but targets the web ``User`` model.
"""

from __future__ import annotations

import secrets
import uuid
from typing import Any

import structlog
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User

logger = structlog.get_logger(__name__)


class CognitoClaimError(RuntimeError):
    """Raised when verified Cognito claims are missing required fields."""


def _extract_sub(claims: dict[str, Any]) -> str:
    sub = claims.get("sub")
    if not sub or not isinstance(sub, str):
        raise CognitoClaimError("Cognito token missing 'sub' claim")
    # `claims` values are `Any`; the isinstance guard narrows to `str`, but
    # mypy's no-any-return still fires under `mypy app/ --ignore-missing-imports`,
    # so return an explicit `str` (no-op given the guard).
    return str(sub)


def _extract_email(claims: dict[str, Any]) -> str | None:
    email = claims.get("email")
    if isinstance(email, str) and email.strip():
        return email.strip().lower()
    return None


def _email_is_verified(claims: dict[str, Any]) -> bool:
    """Cognito serializes ``email_verified`` as a bool or the string
    ``"true"`` depending on token type — accept both."""
    val = claims.get("email_verified")
    if isinstance(val, bool):
        return val
    if isinstance(val, str):
        return val.strip().lower() == "true"
    return False


def _extract_name(claims: dict[str, Any]) -> str | None:
    for key in ("name", "given_name", "cognito:username"):
        v = claims.get(key)
        if isinstance(v, str) and v.strip():
            return v.strip()
    return None


async def _derive_unique_username(
    session: AsyncSession, *, email: str | None, sub: str
) -> str:
    """Build a username that satisfies the NOT NULL + UNIQUE constraint.

    Prefer the email local-part; fall back to a ``cognito-<sub-prefix>``
    slug. De-collide by appending a short random suffix.
    """
    base = ""
    if email and "@" in email:
        base = email.split("@", 1)[0].strip()
    if not base:
        base = f"cognito-{sub[:8]}"
    # Keep it bounded and predictable.
    base = base[:40]

    candidate = base
    for _ in range(10):
        existing = await session.execute(
            select(User.id).where(User.username == candidate)  # type: ignore[call-overload]
        )
        if existing.scalar_one_or_none() is None:
            return candidate
        candidate = f"{base}-{secrets.token_hex(3)}"
    # Extremely unlikely; guarantee uniqueness with the sub.
    return f"{base}-{sub[:12]}"


async def resolve_user_for_cognito_claims(
    session: AsyncSession,
    claims: dict[str, Any],
) -> User:
    """Return the ``User`` for verified Cognito ``claims`` (provision/link).

    The caller must have *already verified* the token (signature, issuer,
    audience, expiry). This function only trusts the claim *values*.

    Raises:
        CognitoClaimError: required claims are missing (no ``sub``).
    """
    sub = _extract_sub(claims)
    email = _extract_email(claims)
    email_verified = _email_is_verified(claims)

    # 1. Steady state: a row already linked to this Cognito sub.
    by_sub = await session.execute(select(User).where(User.cognito_sub == sub))
    user = by_sub.scalar_one_or_none()
    if user is not None:
        return user

    # 2. An existing local user shares this email.
    existing_by_email: User | None = None
    if email:
        by_email = await session.execute(
            select(User).where(func.lower(User.email) == email)
        )
        existing_by_email = by_email.scalar_one_or_none()

    if existing_by_email is not None:
        if email_verified:
            # Verified email → link the Cognito identity to the existing
            # account (unify the two identities).
            existing_by_email.cognito_sub = sub
            session.add(existing_by_email)
            await session.flush()
            logger.info(
                "cognito_user_linked",
                user_id=str(existing_by_email.id),
                email=email,
                cognito_sub=sub,
            )
            return existing_by_email
        # UNVERIFIED email colliding with an existing account: we must
        # neither link (account-takeover vector) nor create a new row
        # (would violate the unique-email constraint). Reject the login —
        # the strategy turns this into a 401, never a 500. The user must
        # verify their email in Cognito (or resolve the conflict) first.
        logger.warning(
            "cognito_unverified_email_collision",
            email=email,
            cognito_sub=sub,
            existing_user_id=str(existing_by_email.id),
        )
        raise CognitoClaimError(
            "Cognito email is unverified and collides with an existing "
            "account; cannot provision or link."
        )

    # 3. Create a fresh user from the token claims.
    if not email:
        # Cognito user-pool tokens always carry an email for a standard
        # email-based pool, but a federated identity may hide it. Without
        # an email we cannot create a usable account row (email is unique
        # + NOT NULL), so synthesize a stable, non-deliverable address.
        email = f"{sub}@cognito.local"
        email_verified = False

    username = await _derive_unique_username(session, email=email, sub=sub)
    # Cognito is the sole authentication mechanism: the ``hashed_password``
    # column no longer exists on the model (dropped from auth.users), so
    # nothing password-related is set here.

    user = User(
        id=uuid.uuid4(),
        email=email,
        username=username,
        full_name=_extract_name(claims),
        cognito_sub=sub,
        is_active=True,
        # Trust Cognito's email verification signal for the verified flag.
        is_verified=email_verified,
        is_superuser=False,
    )
    session.add(user)
    await session.flush()
    logger.info(
        "cognito_user_provisioned",
        user_id=str(user.id),
        email=email,
        username=username,
        cognito_sub=sub,
        is_verified=email_verified,
    )
    return user
