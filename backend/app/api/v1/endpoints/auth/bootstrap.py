"""Admin bootstrap endpoint for creating the first admin user."""

from typing import Any

import structlog
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_async_db
from app.models.user import User

router = APIRouter()
logger = structlog.get_logger(__name__)


@router.post("/bootstrap-first-admin")
async def bootstrap_first_admin(
    email: str,
    db: AsyncSession = Depends(get_async_db),
) -> Any:
    """One-time endpoint to create the first admin. Remove after use!"""
    # Check if any admin exists
    existing_admin_result = await db.execute(
        select(User).where(User.is_superuser == True)  # type: ignore[arg-type] # noqa: E712
    )
    existing_admin = existing_admin_result.scalar_one_or_none()
    if existing_admin:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Admin already exists: {existing_admin.email}",
        )

    # Find user by email
    user_result = await db.execute(select(User).where(User.email == email))  # type: ignore[arg-type]
    user = user_result.scalar_one_or_none()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"User with email {email} not found",
        )

    # Make them admin
    user.is_superuser = True
    await db.commit()
    await db.refresh(user)

    logger.info("bootstrap_first_admin_success", user_email=user.email)

    return {"success": True, "message": f"{user.email} is now an admin"}
