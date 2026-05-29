"""Tests for Cognito dual-accept: iss-branching strategy + provisioning.

Two surfaces:

* ``app.services.cognito_provision.resolve_user_for_cognito_claims`` —
  provision-or-link by Cognito ``sub`` / verified email (DB-backed,
  uses the ``async_db_session`` fixture from ``conftest.py``).
* ``app.auth.config.DebugJWTStrategy.read_token`` — routes a token to
  the Cognito verifier vs. the local FastAPI-Users path by its ``iss``
  claim (the Cognito verifier + user_manager are mocked so this isolates
  the routing decision).
"""

from __future__ import annotations

import time
from typing import Any
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import jwt as pyjwt
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
    assert user.hashed_password  # unusable hash stored, not empty


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
        await async_db_session.execute(
            select(User).where(User.cognito_sub == claims["sub"])
        )
    ).scalars().all()
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
        hashed_password="hashed_pw",
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
        hashed_password="hashed_pw",
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
# iss-branching in the strategy
# ---------------------------------------------------------------------------


def _unsigned_token(claims: dict[str, Any]) -> str:
    """A token whose signature we don't care about — the strategy reads
    ``iss`` unverified to route, and the verifier is mocked."""
    return pyjwt.encode(claims, "irrelevant-secret", algorithm="HS256")


@pytest.mark.asyncio
async def test_strategy_routes_cognito_issuer_to_cognito_path(monkeypatch) -> None:
    from app.auth import config as auth_config

    strategy = auth_config.DebugJWTStrategy(secret="x" * 32, lifetime_seconds=3600)

    sentinel_user = MagicMock(spec=User)
    sentinel_user.id = uuid4()
    called = {}

    async def _fake_cognito(self, token, user_manager):  # noqa: ANN001
        called["cognito"] = True
        return sentinel_user

    monkeypatch.setattr(
        auth_config.DebugJWTStrategy, "_read_cognito_token", _fake_cognito
    )
    # Ensure the live client reports the Cognito issuer as configured.
    monkeypatch.setattr(
        auth_config, "logger", auth_config.logger
    )  # no-op keep
    from app.services import cognito_jwks

    monkeypatch.setattr(cognito_jwks.cognito_jwks_client, "_issuer", _ISSUER)
    monkeypatch.setattr(
        cognito_jwks.cognito_jwks_client, "_allowed_audiences", {"q6ns1a8bokf2np1mj8v8arl31"}
    )

    now = int(time.time())
    token = _unsigned_token(
        {"iss": _ISSUER, "sub": "s", "exp": now + 3600}
    )
    result = await strategy.read_token(token, MagicMock())

    assert called.get("cognito") is True
    assert result is sentinel_user


@pytest.mark.asyncio
async def test_strategy_routes_local_issuer_to_super(monkeypatch) -> None:
    """A non-Cognito token takes the unchanged local fastapi-users path."""
    from app.auth import config as auth_config

    strategy = auth_config.DebugJWTStrategy(secret="x" * 32, lifetime_seconds=3600)

    cognito_called = {"v": False}

    async def _fake_cognito(self, token, user_manager):  # noqa: ANN001
        cognito_called["v"] = True
        return None

    monkeypatch.setattr(
        auth_config.DebugJWTStrategy, "_read_cognito_token", _fake_cognito
    )

    super_user = MagicMock(spec=User)

    async def _fake_super(self, token, user_manager):  # noqa: ANN001
        return super_user

    # Patch the parent JWTStrategy.read_token so we don't need a real
    # fastapi-users token; we only assert the LOCAL branch was taken.
    from fastapi_users.authentication import JWTStrategy

    monkeypatch.setattr(JWTStrategy, "read_token", _fake_super)

    # A token with a non-Cognito issuer (fastapi-users tokens carry
    # aud=fastapi-users:auth and no Cognito iss).
    token = _unsigned_token({"sub": "local-user", "aud": "fastapi-users:auth"})
    result = await strategy.read_token(token, MagicMock())

    assert cognito_called["v"] is False  # cognito path NOT taken
    assert result is super_user


@pytest.mark.asyncio
async def test_cognito_path_returns_none_on_invalid_token(monkeypatch) -> None:
    """A Cognito-issuer token that fails verification yields None (→ 401),
    never an exception that escapes the dependency."""
    from app.auth import config as auth_config
    from app.services import cognito_jwks
    from app.services.cognito_jwks import CognitoTokenInvalidError

    strategy = auth_config.DebugJWTStrategy(secret="x" * 32, lifetime_seconds=3600)
    monkeypatch.setattr(cognito_jwks.cognito_jwks_client, "_issuer", _ISSUER)

    async def _raise(token):  # noqa: ANN001
        raise CognitoTokenInvalidError("bad sig")

    monkeypatch.setattr(
        cognito_jwks.cognito_jwks_client, "verify_token", AsyncMock(side_effect=_raise)
    )

    now = int(time.time())
    token = _unsigned_token({"iss": _ISSUER, "sub": "s", "exp": now + 3600})
    result = await strategy.read_token(token, MagicMock())
    assert result is None
