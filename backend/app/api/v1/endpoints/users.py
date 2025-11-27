from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from fastapi import (
    APIRouter,
    Depends,
    File,
    HTTPException,
    Request,
    Response,
    UploadFile,
    status,
)
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import (
    get_async_db,
    get_current_active_user_async,
    get_current_superuser_async,
)
from app.core.audit import audit_logger
from app.crud.user import (
    delete_user,
    get_user,
    get_user_activity,
    get_users,
    update_user,
    update_user_avatar,
    update_user_profile,
)
from app.middleware.error_handler import not_found_error
from app.middleware.rate_limit import user_limiter
from app.models.user import User as UserModel
from app.schemas.storage import StorageQuotaResponse
from app.schemas.user import (
    ActivityLogResponse,
    AutomationStreamingSettings,
    AutomationStreamingToggle,
    RunnerConnectionInfo,
    User,
    UserProfileResponse,
    UserProfileUpdate,
    UserUpdate,
)
from app.services.avatar_service import avatar_service
from app.services.storage_service import StorageService

router = APIRouter()


@router.get("/me", response_model=User)
@user_limiter.limit("200 per minute")
async def read_user_me(
    request: Request,
    response: Response,
    current_user: UserModel = Depends(get_current_active_user_async),
) -> Any:
    return current_user


@router.get("/me/connection-info", response_model=RunnerConnectionInfo)
async def get_runner_connection_info(
    request: Request,
    current_user: UserModel = Depends(get_current_active_user_async),
) -> Any:
    """
    Get connection information for qontinui-runner desktop app.

    This endpoint returns all the necessary information for the desktop runner
    to connect to the backend, including the WebSocket URL and authentication token.

    Returns:
        - version: Connection protocol version
        - url: WebSocket URL for the runner
        - token: JWT access token for authentication
        - userId: Current user's ID
        - projectId: null (user will select this in the UI)
        - createdAt: Current timestamp
        - backendUrl: Backend HTTP(S) URL for REST API calls
    """
    from app.core.config import settings

    # Extract JWT token from Authorization header
    authorization = request.headers.get("Authorization")
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid authorization header",
        )

    token = authorization.replace("Bearer ", "")

    # Create connection info response
    connection_info = RunnerConnectionInfo(
        version="1.0",
        url=settings.RUNNER_WS_URL,
        token=token,
        userId=str(current_user.id),
        projectId=None,
        createdAt=datetime.now(UTC),
        backendUrl=settings.RUNNER_BACKEND_URL,
    )

    return connection_info


@router.post("/me/claim-admin")
async def claim_admin(
    *,
    db: AsyncSession = Depends(get_async_db),
    current_user: UserModel = Depends(get_current_active_user_async),
) -> Any:
    """Allow user to claim admin if no admin exists. Remove after first use!"""
    from sqlalchemy import select

    # Check if any admin exists
    result = await db.execute(select(UserModel).filter(UserModel.is_superuser))  # type: ignore[arg-type]
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
@user_limiter.limit("30 per minute")
async def update_user_me(
    *,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_async_db),
    user_update: UserUpdate,
    current_user: UserModel = Depends(get_current_active_user_async),
) -> Any:
    user = await update_user(db, current_user, user_update)
    return user


@router.get("", response_model=list[User])
async def read_users(
    request: Request,
    db: AsyncSession = Depends(get_async_db),
    skip: int = 0,
    limit: int = 100,
    current_user: UserModel = Depends(get_current_superuser_async),
) -> Any:
    users = await get_users(db, skip=skip, limit=limit)

    # Audit log: PII access (admin listing users with PII)
    await audit_logger.log_pii_access(
        db=db,
        user_id=current_user.id,
        resource_type="user_list",
        resource_id=f"skip_{skip}_limit_{limit}",
        fields_accessed=["email", "full_name", "phone"],
        reason="Admin user list view",
        request=request,
    )
    await db.commit()

    return users


@router.get("/{user_id}", response_model=User)
async def read_user(
    user_id: UUID,
    request: Request,
    db: AsyncSession = Depends(get_async_db),
    current_user: UserModel = Depends(get_current_superuser_async),
) -> Any:
    user = await get_user(db, user_id=user_id)
    if not user:
        raise not_found_error("User", "user")

    # Audit log: PII access (admin reading user details)
    pii_fields = []
    if user.email:
        pii_fields.append("email")
    if user.full_name:
        pii_fields.append("full_name")
    if user.phone:
        pii_fields.append("phone")

    if pii_fields:
        await audit_logger.log_pii_access(
            db=db,
            user_id=current_user.id,
            resource_type="user",
            resource_id=str(user_id),
            fields_accessed=pii_fields,
            reason="Admin user profile view",
            request=request,
        )
        await db.commit()

    return user


@router.put("/{user_id}", response_model=User)
async def update_user_by_id(
    *,
    db: AsyncSession = Depends(get_async_db),
    user_id: UUID,
    user_update: UserUpdate,
    current_user: UserModel = Depends(get_current_superuser_async),
    request: Request,
) -> Any:
    user = await get_user(db, user_id=user_id)
    if not user:
        raise not_found_error("User", "user")

    # Capture before state for audit log (excluding password)
    before_state = {
        "email": user.email,
        "is_active": user.is_active,
        "is_superuser": user.is_superuser,
    }

    user = await update_user(db, user, user_update)

    # Capture after state
    after_state = {
        "email": user.email,
        "is_active": user.is_active,
        "is_superuser": user.is_superuser,
    }

    # Audit log: admin account modification
    await audit_logger.log_account_modification(
        db=db,
        user_id=current_user.id,
        target_user_id=user_id,
        changes_dict={"before": before_state, "after": after_state},
        action="admin_update_account",
        request=request,
    )
    await db.commit()

    return user


@router.delete("/{user_id}")
async def delete_user_by_id(
    *,
    db: AsyncSession = Depends(get_async_db),
    user_id: UUID,
    current_user: UserModel = Depends(get_current_superuser_async),
    request: Request,
) -> Any:
    # Get user before deletion for audit log
    user_to_delete = await get_user(db, user_id=user_id)
    if not user_to_delete:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found"
        )

    deleted_user_info = {
        "email": user_to_delete.email,
        "username": user_to_delete.username,
        "full_name": user_to_delete.full_name,
    }

    success = await delete_user(db, user_id=user_id)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found"
        )

    # Audit log: account deletion
    await audit_logger.log_account_modification(
        db=db,
        user_id=current_user.id,
        target_user_id=user_id,
        changes_dict={"before": deleted_user_info, "after": {"deleted": True}},
        action="delete_account",
        request=request,
    )
    await db.commit()

    return {"message": "User deleted successfully"}


@router.get("/me/storage", response_model=StorageQuotaResponse)
@user_limiter.limit("60 per minute")
async def get_user_storage(
    request: Request,
    response: Response,
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
    request: Request,
) -> Any:
    """Update user profile (company, phone, full_name)"""
    # Capture before state for audit log
    before_state = {
        "full_name": current_user.full_name,
        "company": current_user.company,
        "phone": current_user.phone,
    }

    user = await update_user_profile(db, current_user, profile_update)

    # Capture after state
    after_state = {
        "full_name": user.full_name,
        "company": user.company,
        "phone": user.phone,
    }

    # Audit log: profile update
    await audit_logger.log_account_modification(
        db=db,
        user_id=current_user.id,
        target_user_id=current_user.id,
        changes_dict={"before": before_state, "after": after_state},
        action="update_profile",
        request=request,
    )
    await db.commit()

    return user


@router.get("/me/avatar")
async def get_avatar(
    current_user: UserModel = Depends(get_current_active_user_async),
) -> Any:
    """
    Get user avatar URL

    Returns a redirect to the avatar image or 404 if no avatar is set
    """
    from fastapi.responses import RedirectResponse

    if not current_user.avatar_url:
        raise not_found_error("Avatar", None)

    # Return redirect to the avatar URL
    return RedirectResponse(url=current_user.avatar_url)


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
        user = await update_user_avatar(db, current_user, None)  # type: ignore[arg-type]
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


@router.post(
    "/me/automation-streaming/toggle", response_model=AutomationStreamingSettings
)
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
        now = datetime.now(UTC)
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


@router.post(
    "/me/automation-streaming/reset-limit", response_model=AutomationStreamingSettings
)
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
    now = datetime.now(UTC)
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
