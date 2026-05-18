"""
FastAPI dependencies for authentication and database access.

Now using fastapi-users for authentication.
"""

__all__ = [
    "current_active_user",
    "current_active_user_optional",
    "current_superuser",
    "current_verified_user",
    "get_async_db",
    "get_db",
    "get_current_user_async",
    "get_current_active_user_async",
    "get_current_superuser_async",
    "get_verified_user_async",
    "get_current_user_from_ws",
    "get_authenticated_device",
    "get_authenticated_device_user",
]

from typing import cast
from uuid import UUID

import structlog
from fastapi import HTTPException, status
from jose import JWTError, jwt

from app.core.config import settings
from app.models.user import User

logger = structlog.get_logger(__name__)

# Export database dependencies
# Export fastapi-users dependencies
from app.auth.config import (
    current_active_user,
    current_active_user_optional,
    current_superuser,
    current_verified_user,
)
from app.db.session import get_async_db

# Export database session getter (for backward compatibility with sync-style imports)
get_db = get_async_db

# Backward compatibility aliases
get_current_user_async = current_active_user
get_current_active_user_async = current_active_user
get_current_superuser_async = current_superuser
get_verified_user_async = current_verified_user


async def get_current_user_from_ws(token: str) -> User:
    """
    Authenticate user from WebSocket token.

    Args:
        token: JWT access token

    Returns:
        User object if authenticated

    Raises:
        HTTPException if authentication fails
    """
    try:
        # Log what we're trying to decode
        logger.info(
            "ws_jwt_decode_attempt",
            token_length=len(token) if token else 0,
            secret_key_set=bool(settings.ACCESS_SECRET_KEY),
            algorithm=settings.ALGORITHM,
        )

        # Decode JWT token
        # fastapi-users uses "fastapi-users:auth" as the audience claim
        # ACCESS_SECRET_KEY is validated to be non-None by pydantic validator
        secret_key = cast(str, settings.ACCESS_SECRET_KEY)
        payload = jwt.decode(
            token,
            secret_key,
            algorithms=[settings.ALGORITHM],
            audience="fastapi-users:auth",
        )

        logger.info(
            "ws_jwt_decode_success",
            sub=payload.get("sub"),
            claims=list(payload.keys()),
        )

        # Extract user ID from token
        user_id_str: str | None = payload.get("sub")
        if user_id_str is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid authentication token",
            )

        user_id = UUID(user_id_str)

    except JWTError as e:
        logger.error(
            "ws_jwt_decode_error",
            error=str(e),
            error_type=type(e).__name__,
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        )
    except ValueError as e:
        logger.error("ws_invalid_user_id", error=str(e))
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid user ID in token",
        )

    # Get user from database
    # Use the db session from the generator - do NOT call close() explicitly
    # as the async context manager in get_async_db() handles cleanup
    from sqlalchemy import select

    from app.db.session import AsyncSessionLocal

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(User).where(User.id == user_id)  # type: ignore[arg-type]
        )
        user = result.scalar_one_or_none()

        if user is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="User not found",
            )

        if not user.is_active:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="User is not active",
            )

        return user


# Type annotations for forward references
from typing import TYPE_CHECKING  # noqa: E402

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession  # noqa: F401


# ---------------------------------------------------------------------------
# Device-token FastAPI dependencies (Phase 5 — Unified Devices Registry)
# ---------------------------------------------------------------------------
#
# Phase 5 of plan ``D:/qontinui-root/plans/2026-05-18-unified-devices-registry.md``
# retired the legacy runner-bearer-token auth (``qontinui_runner_<random>`` +
# Argon2) in favour of coord-issued device-token JWTs verified locally via
# coord's JWKS.

from fastapi import Depends  # noqa: E402
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer  # noqa: E402

_device_bearer_scheme = HTTPBearer(auto_error=True)


class DeviceTokenContext:
    """Authenticated device context — the decoded JWT claims plus the
    owning ``User`` row.

    Phase 5 replacement for the old ``RunnerToken`` model that previous
    runner-authenticated HTTP handlers used to receive via Depends().
    Endpoints that only need the user can use :func:`get_authenticated_device_user`.
    """

    def __init__(self, claims: dict, user: User) -> None:
        self.claims = claims
        self.user = user

    @property
    def device_id(self) -> UUID:
        raw = self.claims.get("device_id")
        if not raw:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Device token missing device_id claim",
            )
        try:
            return UUID(str(raw))
        except (TypeError, ValueError) as exc:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Device token device_id malformed",
            ) from exc

    @property
    def user_id(self) -> UUID:
        return self.user.id


async def _verify_device_jwt(token: str) -> tuple[dict, User]:
    """Verify a coord-issued device JWT and resolve the owning user."""
    from sqlalchemy import select

    from app.db.session import AsyncSessionLocal
    from app.services.coord_jwks import (
        CoordJWKSUnavailableError,
        CoordTokenInvalidError,
        coord_jwks_client,
    )

    try:
        claims = await coord_jwks_client.verify_token(token)
    except CoordJWKSUnavailableError as exc:
        logger.error("device_token_jwks_unavailable", error=str(exc))
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Device authentication temporarily unavailable.",
        ) from exc
    except CoordTokenInvalidError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired device token.",
        ) from exc

    raw_user_id = claims.get("user_id")
    if not raw_user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Device token missing user_id claim.",
        )

    try:
        user_id = UUID(str(raw_user_id))
    except (TypeError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Device token user_id malformed.",
        ) from exc

    async with AsyncSessionLocal() as session:
        result = await session.execute(select(User).where(User.id == user_id))
        user = result.scalar_one_or_none()

    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found.",
        )
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User is not active.",
        )

    return claims, user


async def get_authenticated_device(
    credentials: HTTPAuthorizationCredentials = Depends(_device_bearer_scheme),
) -> DeviceTokenContext:
    """FastAPI dependency — authenticate the caller as a paired device.

    Verifies the presented coord-issued device-token JWT and returns the
    decoded claims alongside the owning ``User``.
    """
    claims, user = await _verify_device_jwt(credentials.credentials)
    return DeviceTokenContext(claims=claims, user=user)


async def get_authenticated_device_user(
    credentials: HTTPAuthorizationCredentials = Depends(_device_bearer_scheme),
) -> User:
    """FastAPI dependency — authenticate the caller as a paired device and
    return the owning :class:`~app.models.user.User`."""
    _claims, user = await _verify_device_jwt(credentials.credentials)
    return user
