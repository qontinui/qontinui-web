from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_active_user, get_current_superuser, get_db
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
    User,
    UserProfileResponse,
    UserProfileUpdate,
    UserUpdate,
)
from app.services.avatar_service import avatar_service
from app.services.storage_service import StorageService

router = APIRouter()


@router.get("/me", response_model=User)
def read_user_me(current_user: UserModel = Depends(get_current_active_user)) -> Any:
    return current_user


@router.post("/me/claim-admin")
def claim_admin(
    *,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_active_user),
) -> Any:
    """Allow user to claim admin if no admin exists. Remove after first use!"""
    # Check if any admin exists
    existing_admin = db.query(UserModel).filter(UserModel.is_superuser).first()
    if existing_admin:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Admin already exists: {existing_admin.email}",
        )

    # Make current user admin
    current_user.is_superuser = True
    db.commit()
    db.refresh(current_user)

    return {"success": True, "message": f"{current_user.email} is now an admin"}


@router.put("/me", response_model=User)
def update_user_me(
    *,
    db: Session = Depends(get_db),
    user_update: UserUpdate,
    current_user: UserModel = Depends(get_current_active_user),
) -> Any:
    user = update_user(db, current_user, user_update)
    return user


@router.get("/", response_model=list[User])
def read_users(
    db: Session = Depends(get_db),
    skip: int = 0,
    limit: int = 100,
    current_user: UserModel = Depends(get_current_superuser),
) -> Any:
    users = get_users(db, skip=skip, limit=limit)
    return users


@router.get("/{user_id}", response_model=User)
def read_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_superuser),
) -> Any:
    user = get_user(db, user_id=user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found"
        )
    return user


@router.put("/{user_id}", response_model=User)
def update_user_by_id(
    *,
    db: Session = Depends(get_db),
    user_id: int,
    user_update: UserUpdate,
    current_user: UserModel = Depends(get_current_superuser),
) -> Any:
    user = get_user(db, user_id=user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found"
        )
    user = update_user(db, user, user_update)
    return user


@router.delete("/{user_id}")
def delete_user_by_id(
    *,
    db: Session = Depends(get_db),
    user_id: int,
    current_user: UserModel = Depends(get_current_superuser),
) -> Any:
    success = delete_user(db, user_id=user_id)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found"
        )
    return {"message": "User deleted successfully"}


@router.get("/me/storage", response_model=StorageQuotaResponse)
def get_user_storage(
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_active_user),
) -> Any:
    """
    Get current user's storage usage and quota information.

    Returns:
        - used_bytes: Total storage used in bytes
        - quota_bytes: Total storage quota in bytes (based on subscription tier)
        - percentage_used: Percentage of quota used
        - files_count: Total number of files stored
    """
    storage_info = StorageService.check_quota(
        db=db,
        user_id=current_user.id,
        subscription_tier=current_user.subscription_tier,
        additional_bytes=0,
    )
    return storage_info


# Profile management endpoints
@router.get("/me/profile", response_model=UserProfileResponse)
def get_user_profile(
    current_user: UserModel = Depends(get_current_active_user),
) -> Any:
    """Get full user profile with all fields"""
    return current_user


@router.put("/me/profile", response_model=UserProfileResponse)
def update_profile(
    *,
    db: Session = Depends(get_db),
    profile_update: UserProfileUpdate,
    current_user: UserModel = Depends(get_current_active_user),
) -> Any:
    """Update user profile (company, phone, full_name)"""
    user = update_user_profile(db, current_user, profile_update)
    return user


@router.post("/me/avatar", response_model=UserProfileResponse)
async def upload_avatar(
    *,
    db: Session = Depends(get_db),
    file: UploadFile = File(...),
    current_user: UserModel = Depends(get_current_active_user),
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
        avatar_service.delete_avatar(
            current_user.avatar_url, db=db, user_id=current_user.id
        )

    # Save new avatar with storage tracking
    avatar_url = await avatar_service.save_avatar(
        file, current_user.id, db=db, subscription_tier=current_user.subscription_tier
    )

    # Update user avatar URL
    user = update_user_avatar(db, current_user, avatar_url)

    return user


@router.delete("/me/avatar", response_model=UserProfileResponse)
def remove_avatar(
    *,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_active_user),
) -> Any:
    """Remove user avatar and free up storage"""
    if current_user.avatar_url:
        avatar_service.delete_avatar(
            current_user.avatar_url, db=db, user_id=current_user.id
        )
        user = update_user_avatar(db, current_user, None)
        return user

    return current_user


@router.get("/me/activity", response_model=list[ActivityLogResponse])
def get_activity(
    *,
    db: Session = Depends(get_db),
    skip: int = 0,
    limit: int = 20,
    current_user: UserModel = Depends(get_current_active_user),
) -> Any:
    """Get recent user activity from audit logs"""
    activities = get_user_activity(db, current_user.id, skip=skip, limit=limit)
    return activities
