from datetime import datetime

from pydantic import BaseModel, EmailStr


class UserBase(BaseModel):
    email: EmailStr
    username: str
    full_name: str | None = None
    is_active: bool = True
    is_superuser: bool = False
    email_verified: bool = False


class UserCreate(BaseModel):
    email: EmailStr
    username: str
    password: str
    full_name: str | None = None


class UserUpdate(BaseModel):
    email: EmailStr | None = None
    username: str | None = None
    full_name: str | None = None
    password: str | None = None


class UserInDBBase(UserBase):
    id: int
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class User(UserInDBBase):
    pass


class UserInDB(UserInDBBase):
    hashed_password: str


# Profile management schemas
class UserProfileResponse(BaseModel):
    """Full user profile with all fields"""

    id: int
    email: EmailStr
    username: str
    full_name: str | None = None
    company: str | None = None
    phone: str | None = None
    avatar_url: str | None = None
    email_verified: bool = False
    subscription_tier: str = "free"
    is_active: bool = True
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


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
    created_at: datetime

    class Config:
        from_attributes = True
