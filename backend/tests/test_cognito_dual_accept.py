"""Tests for Cognito-only auth: provisioning + the single verify path.

Cognito is the sole user-authentication mechanism. Two surfaces:

* ``app.services.cognito_provision.resolve_user_for_cognito_claims`` —
  provision-or-link by Cognito ``sub`` / verified email (DB-backed,
  uses the ``async_db_session`` fixture from ``conftest.py``).
* ``app.auth.config.CognitoJWTStrategy.read_token`` — the only user-token
  verifier; it delegates to the shared
  ``app.auth.cognito_user.verify_cognito_token_and_resolve_user`` helper.
  An invalid / unverifiable token yields ``None`` (→ 401). There is no
  local HS256 / password fallback.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.services.cognito_provision import (
    CognitoClaimError,
    resolve_user_for_cognito_claims,
)

_ISSUER = "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_rgTB9dbZ1"


def _claims(**over: Any) -> dict[str, Any]:
    base = {
        "iss": _ISSUER,
        "sub": str(uuid4()),
        "email": f"cog_{uuid4().hex[:8]}@example.com",
        "email_verified": True,
        "name": "Cognito User",
    }
    base.update(over)
    return base


# ---------------------------------------------------------------------------
# Provisioning
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_provision_creates_new_user(async_db_session: AsyncSession) -> None:
    claims = _claims()
    user = await resolve_user_for_cognito_claims(async_db_session, claims)

    assert user.cognito_sub == claims["sub"]
    assert user.email == claims["email"]
    assert user.full_name == "Cognito User"
    assert user.is_active is True
    assert user.is_verified is True  # mirrors email_verified
    # No local password column exists anymore (Cognito-only).
    assert not hasattr(user, "hashed_password")


@pytest.mark.asyncio
async def test_resolve_by_existing_sub_is_idempotent(
    async_db_session: AsyncSession,
) -> None:
    claims = _claims()
    u1 = await resolve_user_for_cognito_claims(async_db_session, claims)
    # Second call with the same sub returns the same row, no duplicate.
    u2 = await resolve_user_for_cognito_claims(async_db_session, claims)
    assert u1.id == u2.id

    rows = (
        (
            await async_db_session.execute(
                select(User).where(User.cognito_sub == claims["sub"])
            )
        )
        .scalars()
        .all()
    )
    assert len(rows) == 1


@pytest.mark.asyncio
async def test_links_existing_local_user_by_verified_email(
    async_db_session: AsyncSession,
) -> None:
    email = f"local_{uuid4().hex[:8]}@example.com"
    local = User(
        id=uuid4(),
        email=email,
        username=f"local_{uuid4().hex[:8]}",
        is_active=True,
        is_verified=True,
    )
    async_db_session.add(local)
    await async_db_session.flush()

    claims = _claims(email=email)
    resolved = await resolve_user_for_cognito_claims(async_db_session, claims)

    # Same row, now linked to the Cognito sub.
    assert resolved.id == local.id
    assert resolved.cognito_sub == claims["sub"]


@pytest.mark.asyncio
async def test_unverified_email_collision_is_rejected(
    async_db_session: AsyncSession,
) -> None:
    """An UNVERIFIED Cognito email colliding with an existing account is
    rejected — neither linked (account-takeover guard) nor created (would
    violate the unique-email constraint). The strategy turns the raised
    CognitoClaimError into a 401, never a 500.
    """
    email = f"victim_{uuid4().hex[:8]}@example.com"
    local = User(
        id=uuid4(),
        email=email,
        username=f"victim_{uuid4().hex[:8]}",
        is_active=True,
        is_verified=True,
    )
    async_db_session.add(local)
    await async_db_session.flush()

    claims = _claims(email=email, email_verified=False)
    with pytest.raises(CognitoClaimError):
        await resolve_user_for_cognito_claims(async_db_session, claims)

    # The existing account is untouched (not linked).
    await async_db_session.refresh(local)
    assert local.cognito_sub is None


@pytest.mark.asyncio
async def test_unverified_email_no_collision_creates_user(
    async_db_session: AsyncSession,
) -> None:
    """An unverified email that does NOT collide still provisions a new
    user (with is_verified=False mirroring the claim)."""
    claims = _claims(email_verified=False)
    resolved = await resolve_user_for_cognito_claims(async_db_session, claims)
    assert resolved.cognito_sub == claims["sub"]
    assert resolved.is_verified is False


@pytest.mark.asyncio
async def test_missing_sub_raises(async_db_session: AsyncSession) -> None:
    with pytest.raises(CognitoClaimError):
        await resolve_user_for_cognito_claims(async_db_session, {"email": "x@y.z"})


# ---------------------------------------------------------------------------
# The single Cognito verify path (CognitoJWTStrategy)
# ---------------------------------------------------------------------------


def _strategy():
    from app.auth import config as auth_config

    # secret is unused — the strategy never decodes locally.
    return auth_config.CognitoJWTStrategy(secret="x" * 32, lifetime_seconds=3600)


def _user_manager_with_session(session: AsyncSession) -> MagicMock:
    """A fastapi-users user_manager mock exposing a real SQLAlchemy
    user_db.session so the shared helper can provision against it."""
    from fastapi_users_db_sqlalchemy import SQLAlchemyUserDatabase

    user_db = MagicMock(spec=SQLAlchemyUserDatabase)
    user_db.session = session
    manager = MagicMock()
    manager.user_db = user_db
    return manager


@pytest.mark.asyncio
async def test_strategy_resolves_valid_cognito_token(
    monkeypatch, async_db_session: AsyncSession
) -> None:
    """A verifiable Cognito token resolves to a provisioned User via the
    one shared verify+provision helper."""
    from app.services import cognito_jwks

    claims = _claims()
    monkeypatch.setattr(cognito_jwks.cognito_jwks_client, "_issuer", _ISSUER)
    monkeypatch.setattr(
        cognito_jwks.cognito_jwks_client,
        "verify_token",
        AsyncMock(return_value=claims),
    )

    strategy = _strategy()
    manager = _user_manager_with_session(async_db_session)
    result = await strategy.read_token("any-token", manager)

    assert result is not None
    assert result.cognito_sub == claims["sub"]
    assert result.email == claims["email"]


@pytest.mark.asyncio
async def test_strategy_returns_none_on_invalid_token(monkeypatch) -> None:
    """A token that fails Cognito verification yields None (→ 401), never
    an exception that escapes the dependency. There is NO local fallback."""
    from app.services import cognito_jwks
    from app.services.cognito_jwks import CognitoTokenInvalidError

    monkeypatch.setattr(cognito_jwks.cognito_jwks_client, "_issuer", _ISSUER)

    async def _raise(token):  # noqa: ANN001
        raise CognitoTokenInvalidError("bad sig")

    monkeypatch.setattr(
        cognito_jwks.cognito_jwks_client, "verify_token", AsyncMock(side_effect=_raise)
    )

    strategy = _strategy()
    result = await strategy.read_token("bad-token", MagicMock())
    assert result is None


@pytest.mark.asyncio
async def test_strategy_returns_none_when_cognito_not_configured(monkeypatch) -> None:
    """If Cognito is not configured the strategy authenticates no one
    (fails closed → None), rather than falling back to any local path."""
    from app.services import cognito_jwks

    # Empty issuer → ``configured`` is False.
    monkeypatch.setattr(cognito_jwks.cognito_jwks_client, "_issuer", "")

    strategy = _strategy()
    result = await strategy.read_token("some-token", MagicMock())
    assert result is None


@pytest.mark.asyncio
async def test_strategy_returns_none_on_missing_token() -> None:
    strategy = _strategy()
    assert await strategy.read_token(None, MagicMock()) is None
