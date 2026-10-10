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

:func:`resolve_user_for_oidc_claims` is the same three-step resolution for a
token from a generic OIDC issuer (``OIDC_PROVIDERS``), with step 1 keyed by
``(issuer, sub)`` in ``auth.user_oidc_identities`` instead of
``auth.users.cognito_sub``: a ``sub`` is unique only within the issuer that
minted it.
"""

from __future__ import annotations

import hashlib
import secrets
import uuid
from typing import Any

import structlog
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.models.user_oidc_identity import UserOIDCIdentity

logger = structlog.get_logger(__name__)


class CognitoClaimError(RuntimeError):
    """Raised when verified token claims cannot be resolved to a user."""


class IdentityLinkRefusedError(CognitoClaimError):
    """A first sign-in's email belongs to an account it may not attach to.

    Raised instead of linking when the issuer has not opted in to
    email-based linking, the token's email is unverified, the account is a
    superuser, or (Cognito) the account already signs in through a generic
    OIDC issuer. Callers answer 409: the token is valid, the account
    resolution is refused.
    """


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
    for key in ("name", "given_name", "cognito:username", "preferred_username"):
        v = claims.get(key)
        if isinstance(v, str) and v.strip():
            return v.strip()
    return None


async def _derive_unique_username(
    session: AsyncSession, *, email: str | None, sub: str, prefix: str = "cognito"
) -> str:
    """Build a username that satisfies the NOT NULL + UNIQUE constraint.

    Prefer the email local-part; fall back to a ``cognito-<sub-prefix>``
    slug. De-collide by appending a short random suffix.
    """
    base = ""
    if email and "@" in email:
        base = email.split("@", 1)[0].strip()
    if not base:
        base = f"{prefix}-{sub[:8]}"
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


async def _user_by_cognito_sub(session: AsyncSession, sub: str) -> User | None:
    found = await session.execute(select(User).where(User.cognito_sub == sub))
    return found.scalar_one_or_none()


async def _user_by_oidc_identity(
    session: AsyncSession, issuer: str, sub: str
) -> User | None:
    found = await session.execute(
        select(User)
        .join(UserOIDCIdentity, UserOIDCIdentity.user_id == User.id)
        .where(UserOIDCIdentity.issuer == issuer, UserOIDCIdentity.subject == sub)
    )
    return found.scalar_one_or_none()


async def _user_by_email(session: AsyncSession, email: str | None) -> User | None:
    """The account holding ``email``, ROW-LOCKED for the rest of the transaction.

    Only the linking path calls this, and it decides on what the row says
    (``cognito_sub``) and on the account's identity rows. ``FOR UPDATE`` makes
    a concurrent first link for the same account wait until this transaction
    ends; it then re-reads the row (``populate_existing``) and the identity
    rows the winner committed, and is refused — so two identities can never
    both attach to one identity-less account.
    """
    if not email:
        return None
    found = await session.execute(
        select(User)
        .where(func.lower(User.email) == email)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    return found.scalar_one_or_none()


async def _holds_oidc_identity(session: AsyncSession, user: User) -> bool:
    found = await session.execute(
        select(UserOIDCIdentity.id).where(UserOIDCIdentity.user_id == user.id).limit(1)
    )
    return found.scalar_one_or_none() is not None


def _refuse_link(reason: str, existing: User, log_fields: dict[str, Any]) -> None:
    logger.warning(
        "identity_link_refused",
        reason=reason,
        existing_user_id=str(existing.id),
        **log_fields,
    )
    raise IdentityLinkRefusedError(
        "An account with this email already exists and this sign-in may not "
        f"be attached to it automatically ({reason})."
    )


async def _check_link_allowed(
    session: AsyncSession,
    existing: User,
    *,
    link_existing_by_email: bool,
    email_verified: bool,
    log_fields: dict[str, Any],
) -> None:
    """Raise :class:`IdentityLinkRefusedError` unless ``existing`` may be linked.

    Linking by email hands an existing account to whoever holds a verified
    email at the presenting issuer, so it needs the issuer's explicit opt-in,
    a verified email, a non-superuser target — and a target that holds NO
    federated identity yet. The last rule is symmetric across issuers: an
    account that already signs in through Cognito (any ``cognito_sub``,
    including a different sub in the same pool) or through any generic issuer
    (another issuer, or the same issuer under a different ``sub``) belongs to
    that identity, and a matching email at some other identity does not
    transfer it. Only a local account with no identity can be claimed.
    """
    if not link_existing_by_email:
        _refuse_link("issuer_not_opted_in", existing, log_fields)
    if not email_verified:
        _refuse_link("email_unverified", existing, log_fields)
    if existing.is_superuser:
        _refuse_link("superuser_account", existing, log_fields)
    if existing.cognito_sub is not None:
        _refuse_link("account_has_cognito_identity", existing, log_fields)
    if await _holds_oidc_identity(session, existing):
        _refuse_link("account_has_oidc_identity", existing, log_fields)


def _insert_conflict(log_fields: dict[str, Any]) -> IdentityLinkRefusedError:
    """A provisioning insert hit a unique constraint and no winner owns this
    identity: the email or username was taken concurrently by a DIFFERENT
    account. Refused cleanly (409) rather than surfacing a 500."""
    logger.warning("identity_provision_conflict", **log_fields)
    return IdentityLinkRefusedError(
        "This sign-in could not be provisioned because its email or username "
        "was claimed concurrently by another account (account_conflict)."
    )


async def _bootstrap_personal_org(
    session: AsyncSession, user: User, event: str
) -> None:
    """Give a freshly provisioned user its personal organization.

    The legacy signup path did this in UserManager.on_after_register, which
    never fires for users provisioned here (their first project create 500'd
    on ``personal_org_not_found``). Same tolerate-None posture: a failed
    bootstrap logs loudly but never fails the login
    (create_personal_organization is idempotent).
    """
    from app.services.organization_service import organization_service

    personal_org = await organization_service.create_personal_organization(
        db=session,
        user=user,
    )
    if personal_org is None:
        logger.warning(event, user_id=str(user.id))


async def resolve_user_for_cognito_claims(
    session: AsyncSession,
    claims: dict[str, Any],
    *,
    link_existing_by_email: bool = True,
) -> User:
    """Return the ``User`` for verified Cognito ``claims`` (provision/link).

    The caller must have *already verified* the token (signature, issuer,
    audience, expiry). This function only trusts the claim *values*.

    Linking an existing account by email (step 2) requires
    ``link_existing_by_email`` (``COGNITO_LINK_EXISTING_BY_EMAIL``), a verified
    email, a non-superuser account, and an account holding no identity yet —
    never one with a different ``cognito_sub`` (it is not overwritten) nor one
    that signs in through a generic OIDC issuer.

    A concurrent first login for the same ``sub`` is absorbed: the losing
    insert rolls back to a savepoint and the winner's row is returned.

    Raises:
        CognitoClaimError: required claims are missing (no ``sub``).
        IdentityLinkRefusedError: the email belongs to an account this sign-in
            may not attach to.
    """
    sub = _extract_sub(claims)
    email = _extract_email(claims)
    email_verified = _email_is_verified(claims)
    log_fields = {"cognito_sub": sub, "email": email}

    # 1. Steady state: a row already linked to this Cognito sub.
    user = await _user_by_cognito_sub(session, sub)
    if user is not None:
        return user

    # 2. An existing account shares this email.
    existing = await _user_by_email(session, email)
    if existing is not None:
        await _check_link_allowed(
            session,
            existing,
            link_existing_by_email=link_existing_by_email,
            email_verified=email_verified,
            log_fields=log_fields,
        )
        try:
            async with session.begin_nested():
                existing.cognito_sub = sub
                session.add(existing)
                await session.flush()
        except IntegrityError:
            # A concurrent first login for this sub won.
            await session.refresh(existing)
            winner = await _user_by_cognito_sub(session, sub)
            if winner is None:
                raise _insert_conflict(log_fields) from None
            return winner
        logger.info("cognito_user_linked", user_id=str(existing.id), **log_fields)
        return existing

    # 3. Create a fresh user from the token claims.
    if not email:
        # A federated identity may hide the email. Email is unique + NOT
        # NULL, so synthesize a stable, non-deliverable address on a real
        # (controlled, MX-less) domain — `.local` is rejected by EmailStr.
        email = f"{sub}@no-reply.qontinui.io"
        email_verified = False

    username = await _derive_unique_username(session, email=email, sub=sub)
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
    try:
        async with session.begin_nested():
            session.add(user)
            await session.flush()
    except IntegrityError:
        # A concurrent first login for this sub won the insert.
        winner = await _user_by_cognito_sub(session, sub)
        if winner is None:
            raise _insert_conflict(log_fields) from None
        logger.info("cognito_user_provision_race_absorbed", user_id=str(winner.id))
        return winner
    logger.info(
        "cognito_user_provisioned",
        user_id=str(user.id),
        username=username,
        is_verified=email_verified,
        **log_fields,
    )
    await _bootstrap_personal_org(
        session, user, "cognito_user_provisioned_without_personal_org"
    )
    return user


async def resolve_user_for_oidc_claims(
    session: AsyncSession,
    issuer: str,
    claims: dict[str, Any],
    *,
    link_existing_by_email: bool = False,
) -> User:
    """Return the ``User`` for verified claims from a generic OIDC ``issuer``.

    Same contract as :func:`resolve_user_for_cognito_claims` — the caller has
    already verified the token, and ``issuer`` is the normalised issuer the
    verifier matched — but the identity is keyed by ``(issuer, sub)``:

    1. An ``auth.user_oidc_identities`` row for ``(issuer, sub)`` -> its user.
    2. A user with the same email -> link, ONLY when the issuer opted in
       (``link_existing_by_email``), the email is verified (a token without a
       true ``email_verified`` claim never links), the account is not a superuser, and it holds no identity yet
       (no ``cognito_sub``, no identity at any generic issuer); otherwise
       refused.
    3. Otherwise create the user and its identity row.

    A concurrent first login for the same ``(issuer, sub)`` is absorbed: the
    losing insert rolls back to a savepoint and the winner's user is returned.

    Raises:
        CognitoClaimError: no ``sub``.
        IdentityLinkRefusedError: the email belongs to an account this sign-in
            may not attach to.
    """
    sub = _extract_sub(claims)
    email = _extract_email(claims)
    email_verified = _email_is_verified(claims)
    log_fields = {"oidc_issuer": issuer, "oidc_sub": sub, "email": email}

    user = await _user_by_oidc_identity(session, issuer, sub)
    if user is not None:
        return user

    existing = await _user_by_email(session, email)
    if existing is not None:
        await _check_link_allowed(
            session,
            existing,
            link_existing_by_email=link_existing_by_email,
            email_verified=email_verified,
            log_fields=log_fields,
        )
        try:
            async with session.begin_nested():
                session.add(
                    UserOIDCIdentity(user_id=existing.id, issuer=issuer, subject=sub)
                )
                await session.flush()
        except IntegrityError:
            winner = await _user_by_oidc_identity(session, issuer, sub)
            if winner is None:
                raise _insert_conflict(log_fields) from None
            return winner
        logger.info("oidc_user_linked", user_id=str(existing.id), **log_fields)
        return existing

    if not email:
        # Hashed rather than spelled from ``sub``, which for some issuers
        # carries characters (``auth0|...``) an email validator rejects, and
        # is unique only together with the issuer.
        digest = hashlib.sha256(f"{issuer}\n{sub}".encode()).hexdigest()[:32]
        email = f"oidc-{digest}@no-reply.qontinui.io"
        email_verified = False

    username = await _derive_unique_username(
        session, email=email, sub=sub, prefix="oidc"
    )
    user = User(
        id=uuid.uuid4(),
        email=email,
        username=username,
        full_name=_extract_name(claims),
        cognito_sub=None,
        is_active=True,
        is_verified=email_verified,
        is_superuser=False,
    )
    try:
        async with session.begin_nested():
            session.add(user)
            await session.flush()
            session.add(UserOIDCIdentity(user_id=user.id, issuer=issuer, subject=sub))
            await session.flush()
    except IntegrityError:
        # A concurrent first login for this (issuer, sub) won the insert.
        winner = await _user_by_oidc_identity(session, issuer, sub)
        if winner is None:
            raise _insert_conflict(log_fields) from None
        logger.info("oidc_user_provision_race_absorbed", user_id=str(winner.id))
        return winner
    logger.info(
        "oidc_user_provisioned",
        user_id=str(user.id),
        username=username,
        is_verified=email_verified,
        **log_fields,
    )
    await _bootstrap_personal_org(
        session, user, "oidc_user_provisioned_without_personal_org"
    )
    return user
