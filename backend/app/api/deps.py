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
    "get_runner_user_from_token",
    "get_authenticated_runner",
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


async def get_runner_user_from_token(
    token: str,
    db: "AsyncSession | None" = None,
) -> tuple[User, "RunnerToken"]:
    """
    Authenticate a runner bearer token.

    This is the primary authentication entrypoint for headless qontinui runner
    processes. The raw bearer token (shape ``qontinui_runner_<64 hex>``) is
    looked up in the ``runner_tokens`` table, verified with Argon2, and the
    associated user is returned along with the token record.

    Args:
        token: Plain runner bearer token.
        db: Optional pre-existing async session. When ``None`` (the default),
            a short-lived :class:`AsyncSessionLocal` session is opened for
            the duration of this call. Pass an explicit session when calling
            from tests that rely on a rollback-bounded transactional session.

    Returns:
        Tuple ``(user, runner_token)``.

    Raises:
        HTTPException 401: Token is missing, malformed, expired, revoked, or
        the associated user is inactive.
    """
    from sqlalchemy import select

    from app.crud.runner_crud import validate_runner_token
    from app.db.session import AsyncSessionLocal
    from app.models.runner_token import RunnerToken  # noqa: F401 — runtime import

    async def _authenticate(session: "AsyncSession") -> tuple[User, "RunnerToken"]:
        runner_token = await validate_runner_token(session, token)
        if runner_token is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid or expired token",
            )

        result = await session.execute(
            select(User).where(User.id == runner_token.user_id)  # type: ignore[arg-type]
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

        return user, runner_token

    if db is not None:
        return await _authenticate(db)

    async with AsyncSessionLocal() as owned_session:
        return await _authenticate(owned_session)


# Type annotations for forward references
from typing import TYPE_CHECKING  # noqa: E402

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession  # noqa: F401

    from app.models.runner_token import RunnerToken


# ---------------------------------------------------------------------------
# Runner-token FastAPI dependencies
# ---------------------------------------------------------------------------

from fastapi import Depends  # noqa: E402
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer  # noqa: E402

_runner_bearer_scheme = HTTPBearer(auto_error=True)


async def get_authenticated_runner(
    credentials: HTTPAuthorizationCredentials = Depends(_runner_bearer_scheme),
) -> "RunnerToken":
    """FastAPI dependency — authenticate the caller as a runner and return
    the :class:`~app.models.runner_token.RunnerToken` row they presented.

    Endpoints that only need the owning user can use the narrower
    :func:`get_authenticated_runner_user` dependency instead.
    """
    _user, runner_token = await get_runner_user_from_token(credentials.credentials)
    return runner_token


async def get_authenticated_runner_user(
    credentials: HTTPAuthorizationCredentials = Depends(_runner_bearer_scheme),
) -> User:
    """FastAPI dependency — authenticate the caller as a runner and return
    the owning :class:`~app.models.user.User`."""
    user, _runner_token = await get_runner_user_from_token(credentials.credentials)
    return user
