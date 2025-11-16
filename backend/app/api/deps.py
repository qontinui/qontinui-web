"""
FastAPI dependencies for authentication and database access.

Now using fastapi-users for authentication.
"""

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
        # Decode JWT token
        payload = jwt.decode(
            token,
            settings.ACCESS_SECRET_KEY,
            algorithms=[settings.ALGORITHM],
        )

        # Extract user ID from token
        user_id_str: str = payload.get("sub")
        if user_id_str is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid authentication token",
            )

        user_id = UUID(user_id_str)

    except JWTError as e:
        logger.error("ws_jwt_decode_error", error=str(e))
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

            result = await db.execute(select(User).where(User.id == user_id))
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

        # Only process one db session
        break

    # If we get here, something went wrong
    raise HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail="Database connection error",
    )
