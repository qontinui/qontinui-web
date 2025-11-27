"""
FastAPI dependencies for authentication and database access.

Now using fastapi-users for authentication.
"""

from typing import TYPE_CHECKING, cast
from uuid import UUID

import structlog
from fastapi import HTTPException, status
from jose import JWTError, jwt

from app.core.config import settings
from app.models.user import User

if TYPE_CHECKING:
    from app.models.runner_token import RunnerToken

logger = structlog.get_logger(__name__)

# Export database dependencies
# Export fastapi-users dependencies
from app.auth.config import (
    current_active_user,
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


async def authenticate_runner(
    token: str,
) -> tuple[User, "RunnerToken | None"]:
    """
    Authenticate either JWT token or runner token for WebSocket connections.

    This function supports both authentication methods:
    1. Standard JWT access tokens (for backward compatibility)
    2. Runner tokens (dedicated tokens for desktop runners)

    Args:
        token: Either a JWT access token or a runner token

    Returns:
        Tuple of (User, RunnerToken or None)
        - If authenticated with JWT: (User, None)
        - If authenticated with runner token: (User, RunnerToken)

    Raises:
        HTTPException if authentication fails
    """
    from app.crud import runner as runner_crud

    # First, try JWT authentication
    try:
        user = await get_current_user_from_ws(token)
        return user, None
    except HTTPException:
        # JWT failed, try runner token
        pass

    # Try runner token authentication
    async for db in get_async_db():
        try:
            runner_token = await runner_crud.validate_runner_token(db, token)

            if not runner_token:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Invalid or expired token",
                )

            # Get user from runner token
            from sqlalchemy import select

            result = await db.execute(
                select(User).where(User.id == runner_token.user_id)  # type: ignore[arg-type]
            )
            user_from_db: User | None = result.scalar_one_or_none()

            if not user_from_db:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="User not found",
                )

            if not user_from_db.is_active:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="User is not active",
                )

            return user_from_db, runner_token

        finally:
            await db.close()

    # If we get here, authentication failed
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Authentication failed",
    )
