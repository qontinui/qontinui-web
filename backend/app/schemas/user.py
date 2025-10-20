import uuid

from fastapi_users import schemas
from pydantic import BaseModel, ConfigDict, EmailStr

from app.schemas.base import IsoDatetime


class UserRead(schemas.BaseUser[uuid.UUID]):
    """Schema for reading user data (fastapi-users compatible with UUID)."""

    username: str
    full_name: str | None = None
    company: str | None = None
    phone: str | None = None
    avatar_url: str | None = None
    subscription_tier: str
    is_beta: bool = False
    created_at: IsoDatetime
    updated_at: IsoDatetime


class UserCreate(schemas.BaseUserCreate):
    """Schema for creating users (fastapi-users compatible)."""

    username: str
    full_name: str | None = None
    company: str | None = None


class UserUpdate(schemas.BaseUserUpdate):
    """Schema for updating users (fastapi-users compatible)."""

    username: str | None = None
    full_name: str | None = None
    company: str | None = None
    phone: str | None = None


# Backward compatibility aliases
User = UserRead
UserBase = UserRead
UserInDB = UserRead
UserInDBBase = UserRead


# Profile management schemas
class UserProfileResponse(BaseModel):
    """Full user profile with all fields"""

    id: uuid.UUID  # Changed from int to UUID
    email: EmailStr
    username: str
    full_name: str | None = None
    company: str | None = None
    phone: str | None = None
    avatar_url: str | None = None
    is_verified: bool = False  # Changed from email_verified to match fastapi-users
    subscription_tier: str = "free"
    is_active: bool = True
    created_at: IsoDatetime
    updated_at: IsoDatetime

    model_config = ConfigDict(
        from_attributes=True,
    )


class UserProfileUpdate(BaseModel):
    """Fields that can be updated by the user"""

    full_name: str | None = None
    company: str | None = None
    phone: str | None = None


class ActivityLogResponse(BaseModel):
    """Activity log entry for user feed"""

    id: int
    action: str
    resource_type: str | None = None
    resource_id: str | None = None
    ip_address: str | None = None
    log_metadata: dict | None = None
    created_at: IsoDatetime

    model_config = ConfigDict(
        from_attributes=True,
    )
