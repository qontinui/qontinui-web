from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import decode_token
from app.db.session import get_async_db
from app.models.user import User

oauth2_scheme = OAuth2PasswordBearer(tokenUrl=f"{settings.API_V1_STR}/auth/login")


async def get_current_user_async(
    db: AsyncSession = Depends(get_async_db), token: str = Depends(oauth2_scheme)
) -> User:
    """Get current authenticated user (async)."""
    from app.crud.user import get_user

    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )

    payload = decode_token(token)
    if not payload:
        raise credentials_exception

    user_id = payload.get("sub")
    if user_id is None:
        raise credentials_exception

    user = await get_user(db, user_id=int(user_id))
    if user is None:
        raise credentials_exception

    return user


async def get_current_active_user_async(
    user: User = Depends(get_current_user_async),
) -> User:
    """Verify user is active."""
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Inactive user"
        )
    return user


async def get_current_superuser_async(
    user: User = Depends(get_current_user_async),
) -> User:
    """Verify user is superuser."""
    if not user.is_superuser:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Not enough permissions"
        )
    return user


async def get_verified_user_async(
    user: User = Depends(get_current_active_user_async),
) -> User:
    """Verify user has verified their email."""
    if not user.email_verified:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Email verification required. Please check your email for verification link.",
        )
    return user
