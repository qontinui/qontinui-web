"""
FastAPI dependencies for authentication and database access.

Now using fastapi-users for authentication.
"""

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

    async for db in get_async_db():
        try:
            from sqlalchemy import select

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

        finally:
            await db.close()

    # If we get here, something went wrong
    raise HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail="Database connection error",
    )


async def get_runner_user_from_token(
    token: str,
    db: "AsyncSession",
) -> User:
    """
    Validate JWT and return associated user for runner endpoints.

    This is used by the desktop runner when making API calls.

    Args:
        token: JWT access token
        db: Database session

    Returns:
        User object if authenticated

    Raises:
        HTTPException if authentication fails
    """
    from sqlalchemy import select

    try:
        # Verify it looks like a JWT (3 parts separated by dots)
        if token.count(".") != 2:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token format",
            )

        # Decode JWT token
        secret_key = cast(str, settings.ACCESS_SECRET_KEY)
        payload = jwt.decode(
            token,
            secret_key,
            algorithms=[settings.ALGORITHM],
            audience="fastapi-users:auth",
        )

        # Extract user ID
        user_id_str: str | None = payload.get("sub")
        if not user_id_str:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token payload",
            )

        user_id = UUID(user_id_str)

        # Get user from database
        result = await db.execute(select(User).where(User.id == user_id))  # type: ignore[arg-type]
        user = result.scalar_one_or_none()

        if not user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="User not found",
            )

        if not user.is_active:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="User account is inactive",
            )

        return user

    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        )


# Type annotation for forward reference
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession
