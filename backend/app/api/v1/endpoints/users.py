from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import (
    get_async_db,
    get_current_active_user_async,
    get_current_superuser_async,
)
from app.crud.user import (
    delete_user,
    get_user,
    get_user_activity,
    get_users,
    update_user,
    update_user_avatar,
    update_user_profile,
)
from app.models.user import User as UserModel
from app.schemas.storage import StorageQuotaResponse
from app.schemas.user import (
    ActivityLogResponse,
    AutomationStreamingSettings,
    AutomationStreamingToggle,
    User,
    UserProfileResponse,
    UserProfileUpdate,
    UserUpdate,
)
from app.services.avatar_service import avatar_service
from app.services.storage_service import StorageService

router = APIRouter()


@router.get("/me", response_model=User)
async def read_user_me(
    current_user: UserModel = Depends(get_current_active_user_async),
) -> Any:
    return current_user


@router.post("/me/claim-admin")
async def claim_admin(
    *,
    db: AsyncSession = Depends(get_async_db),
    current_user: UserModel = Depends(get_current_active_user_async),
) -> Any:
    """Allow user to claim admin if no admin exists. Remove after first use!"""
    from sqlalchemy import select

    # Check if any admin exists
    result = await db.execute(select(UserModel).filter(UserModel.is_superuser))
    existing_admin = result.scalar_one_or_none()
    if existing_admin:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Admin already exists: {existing_admin.email}",
        )

    # Make current user admin
    current_user.is_superuser = True
    await db.commit()
    await db.refresh(current_user)

    return {"success": True, "message": f"{current_user.email} is now an admin"}


@router.put("/me", response_model=User)
async def update_user_me(
    *,
    db: AsyncSession = Depends(get_async_db),
    user_update: UserUpdate,
    current_user: UserModel = Depends(get_current_active_user_async),
) -> Any:
    user = await update_user(db, current_user, user_update)
    return user


@router.get("/", response_model=list[User])
async def read_users(
    db: AsyncSession = Depends(get_async_db),
    skip: int = 0,
    limit: int = 100,
    current_user: UserModel = Depends(get_current_superuser_async),
) -> Any:
    users = await get_users(db, skip=skip, limit=limit)
    return users


@router.get("/{user_id}", response_model=User)
async def read_user(
    user_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: UserModel = Depends(get_current_superuser_async),
) -> Any:
    user = await get_user(db, user_id=user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found"
        )
    return user


@router.put("/{user_id}", response_model=User)
async def update_user_by_id(
    *,
    db: AsyncSession = Depends(get_async_db),
    user_id: UUID,
    user_update: UserUpdate,
    current_user: UserModel = Depends(get_current_superuser_async),
) -> Any:
    user = await get_user(db, user_id=user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found"
        )
    user = await update_user(db, user, user_update)
    return user


@router.delete("/{user_id}")
async def delete_user_by_id(
    *,
    db: AsyncSession = Depends(get_async_db),
    user_id: UUID,
    current_user: UserModel = Depends(get_current_superuser_async),
) -> Any:
    success = await delete_user(db, user_id=user_id)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found"
        )
    return {"message": "User deleted successfully"}


@router.get("/me/storage", response_model=StorageQuotaResponse)
async def get_user_storage(
    db: AsyncSession = Depends(get_async_db),
    current_user: UserModel = Depends(get_current_active_user_async),
) -> Any:
    """
    Get current user's storage usage and quota information.

    Returns:
        - used_bytes: Total storage used in bytes
        - quota_bytes: Total storage quota in bytes (based on subscription tier)
        - percentage_used: Percentage of quota used
        - files_count: Total number of files stored
    """
    storage_info = await StorageService.check_quota(
        db=db,
        user_id=current_user.id,
        subscription_tier=current_user.subscription_tier,
        additional_bytes=0,
    )
    return storage_info


# Profile management endpoints
@router.get("/me/profile", response_model=UserProfileResponse)
async def get_user_profile(
    current_user: UserModel = Depends(get_current_active_user_async),
) -> Any:
    """Get full user profile with all fields"""
    return current_user


@router.put("/me/profile", response_model=UserProfileResponse)
async def update_profile(
    *,
    db: AsyncSession = Depends(get_async_db),
    profile_update: UserProfileUpdate,
    current_user: UserModel = Depends(get_current_active_user_async),
) -> Any:
    """Update user profile (company, phone, full_name)"""
    user = await update_user_profile(db, current_user, profile_update)
    return user


@router.post("/me/avatar", response_model=UserProfileResponse)
async def upload_avatar(
    *,
    db: AsyncSession = Depends(get_async_db),
    file: UploadFile = File(...),
    current_user: UserModel = Depends(get_current_active_user_async),
) -> Any:
    """
    Upload user avatar image

    - Validates image type (jpg, png, webp)
    - Max size: 2MB
    - Resizes to 200x200
    - Returns updated profile with new avatar URL
    - Tracks storage usage and enforces quotas
    """
    # Delete old avatar if exists
    if current_user.avatar_url:
        await avatar_service.delete_avatar(
            current_user.avatar_url, db=db, user_id=current_user.id
        )

    # Save new avatar with storage tracking
    avatar_url = await avatar_service.save_avatar(
        file, current_user.id, db=db, subscription_tier=current_user.subscription_tier
    )

    # Update user avatar URL
    user = await update_user_avatar(db, current_user, avatar_url)

    return user


@router.delete("/me/avatar", response_model=UserProfileResponse)
async def remove_avatar(
    *,
    db: AsyncSession = Depends(get_async_db),
    current_user: UserModel = Depends(get_current_active_user_async),
) -> Any:
    """Remove user avatar and free up storage"""
    if current_user.avatar_url:
        await avatar_service.delete_avatar(
            current_user.avatar_url, db=db, user_id=current_user.id
        )
        user = await update_user_avatar(db, current_user, None)
        return user

    return current_user


@router.get("/me/activity", response_model=list[ActivityLogResponse])
async def get_activity(
    *,
    db: AsyncSession = Depends(get_async_db),
    skip: int = 0,
    limit: int = 20,
    current_user: UserModel = Depends(get_current_active_user_async),
) -> Any:
    """Get recent user activity from audit logs"""
    activities = await get_user_activity(db, current_user.id, skip=skip, limit=limit)
    return activities


# Automation streaming endpoints
@router.get("/me/automation-streaming", response_model=AutomationStreamingSettings)
async def get_automation_streaming_settings(
    current_user: UserModel = Depends(get_current_active_user_async),
) -> Any:
    """
    Get current user's automation streaming settings.

    Returns:
        - enabled: Whether streaming is enabled
        - sessions_limit: Maximum sessions per month (None = unlimited)
        - sessions_used: Number of sessions used this month
        - sessions_reset_at: When the session count will reset
    """
    return AutomationStreamingSettings(
        enabled=current_user.automation_streaming_enabled,
        sessions_limit=current_user.automation_sessions_limit,
        sessions_used=current_user.automation_sessions_used,
        sessions_reset_at=current_user.automation_sessions_reset_at,
    )


@router.post("/me/automation-streaming/toggle", response_model=AutomationStreamingSettings)
async def toggle_automation_streaming(
    *,
    db: AsyncSession = Depends(get_async_db),
    toggle_data: AutomationStreamingToggle,
    current_user: UserModel = Depends(get_current_active_user_async),
) -> Any:
    """
    Toggle automation streaming on/off.

    Logic:
        - If enabling and user is free tier: set sessions_limit=5, reset_at=next month
        - If enabling and user is paid: set sessions_limit=None (unlimited)
        - If disabling: just set enabled=False

    Request body:
        - enabled: bool

    Returns updated automation streaming settings.
    """
    current_user.automation_streaming_enabled = toggle_data.enabled

    if toggle_data.enabled:
        # Calculate next month for reset date
        now = datetime.now(timezone.utc)
        if now.month == 12:
            next_month = now.replace(year=now.year + 1, month=1, day=1)
        else:
            next_month = now.replace(month=now.month + 1, day=1)

        current_user.automation_sessions_reset_at = next_month

        # Set limits based on subscription tier
        if current_user.subscription_tier == "free":
            current_user.automation_sessions_limit = 5
        else:
            # Paid users get unlimited sessions
            current_user.automation_sessions_limit = None

    db.add(current_user)
    await db.commit()
    await db.refresh(current_user)

    return AutomationStreamingSettings(
        enabled=current_user.automation_streaming_enabled,
        sessions_limit=current_user.automation_sessions_limit,
        sessions_used=current_user.automation_sessions_used,
        sessions_reset_at=current_user.automation_sessions_reset_at,
    )


@router.post("/me/automation-streaming/reset-limit", response_model=AutomationStreamingSettings)
async def reset_automation_streaming_limit(
    *,
    db: AsyncSession = Depends(get_async_db),
    current_user: UserModel = Depends(get_current_active_user_async),
) -> Any:
    """
    Reset monthly session count.

    This endpoint can be called by users or automatically triggered monthly.
    Sets sessions_used=0 and sessions_reset_at=next month.

    Returns updated automation streaming settings.
    """
    # Reset the session counter
    current_user.automation_sessions_used = 0

    # Calculate next reset date (next month)
    now = datetime.now(timezone.utc)
    if now.month == 12:
        next_month = now.replace(year=now.year + 1, month=1, day=1)
    else:
        next_month = now.replace(month=now.month + 1, day=1)

    current_user.automation_sessions_reset_at = next_month

    db.add(current_user)
    await db.commit()
    await db.refresh(current_user)

    return AutomationStreamingSettings(
        enabled=current_user.automation_streaming_enabled,
        sessions_limit=current_user.automation_sessions_limit,
        sessions_used=current_user.automation_sessions_used,
        sessions_reset_at=current_user.automation_sessions_reset_at,
    )
