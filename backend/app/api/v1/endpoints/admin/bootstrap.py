"""Admin bootstrap endpoint for creating the first admin user."""

from typing import Any

import structlog
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_async_db
from app.repositories.admin_user import admin_user_repository

router = APIRouter()
logger = structlog.get_logger(__name__)


@router.post("/bootstrap-first-admin")
async def bootstrap_first_admin(
    email: str,
    db: AsyncSession = Depends(get_async_db),
) -> Any:
    """One-time endpoint to create the first admin. Remove after use!"""
    # Check if any admin exists
    existing_admin = await admin_user_repository.check_admin_exists(db)
    if existing_admin:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Admin already exists: {existing_admin.email}",
        )

    # Find user by email
    user = await admin_user_repository.get_user_by_email(db, email)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"User with email {email} not found",
        )

    # Make them admin
    await admin_user_repository.make_user_admin(db, user)

    logger.info("bootstrap_first_admin_success", user_email=user.email)

    return {"success": True, "message": f"{user.email} is now an admin"}
