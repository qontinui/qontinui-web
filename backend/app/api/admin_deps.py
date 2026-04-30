"""Admin endpoint dependencies."""

from fastapi import Depends, HTTPException, status

from app.api.deps import get_current_user_async
from app.models.user import User


async def require_admin(current_user: User = Depends(get_current_user_async)) -> User:
    """Dependency to require admin/superuser access."""
    if not current_user.is_superuser:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized. Admin access required.",
        )
    return current_user
