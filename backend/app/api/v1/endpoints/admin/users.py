"""Admin user management endpoints."""

import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_async_db
from app.api.v1.endpoints.admin.dependencies import require_admin
from app.models.user import User
from app.repositories.admin_user import admin_user_repository
from app.schemas.admin import AdminUserData

router = APIRouter()


@router.get("/users", response_model=list[AdminUserData])
async def get_users_list(
    skip: int = 0,
    limit: int = 50,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_admin),
) -> list[AdminUserData]:
    """Get list of users with basic info."""
    users_data = await admin_user_repository.list_users_with_project_counts(
        db, skip=skip, limit=limit
    )

    return [
        AdminUserData(
            id=user["id"],
            email=user["email"],
            username=user["username"],
            full_name=user["full_name"],
            is_active=user["is_active"],
            is_verified=user["is_verified"],
            email_verified=user["email_verified"],
            created_at=user["created_at"],
            project_count=user["project_count"],
            subscription_tier=user["subscription_tier"],
            last_login=user["last_login"],
        )
        for user in users_data
    ]


@router.get("/users/{user_id}")
async def get_user_details(
    user_id: uuid.UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_admin),
) -> Any:
    """Get detailed info about a specific user."""
    user_data = await admin_user_repository.get_user_with_projects(db, user_id)

    if not user_data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    return user_data


@router.get("/stats")
async def get_admin_stats(
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_admin),
) -> Any:
    """Get overall platform statistics."""
    return await admin_user_repository.get_platform_stats(db)
