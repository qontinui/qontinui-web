import uuid
from typing import Literal

from fastapi_users import schemas
from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.schemas.base import IsoDatetime


class UserPreferences(BaseModel):
    """User preferences stored as JSON."""

    product_mode: Literal["ai", "visual"] | None = None
    ui_bridge_co_pilot_enabled: bool = Field(
        default=False,
        description=(
            "Per-user durable opt-in for the UI Bridge AI co-pilot. When "
            "false (default), the relay listener never mounts. When true, "
            "the listener still requires a per-session consent grant before "
            "mounting (sessionStorage). See "
            "plans/2026-05-28-production-safe-ui-bridge-design.md §4.5."
        ),
    )

    model_config = ConfigDict(extra="allow")


class UserRead(schemas.BaseUser[uuid.UUID]):
    """Schema for reading user data (fastapi-users compatible with UUID)."""

    # Override the inherited ``EmailStr`` with a plain ``str``. A read schema
    # must never 500 on already-stored data: a federated identity that hid its
    # email is provisioned with a synthetic placeholder address, and write-time
    # validation already guards new rows. Keeping ``EmailStr`` here turned any
    # such user's /users/me into an unhandled ValidationError (500). Validation
    # of *incoming* emails stays on ``UserCreate``/``UserUpdate`` (still EmailStr).
    email: str
    username: str
    full_name: str | None = None
    company: str | None = None
    phone: str | None = None
    avatar_url: str | None = None
    subscription_tier: str
    is_beta: bool = False
    preferences: UserPreferences | None = None
    created_at: IsoDatetime
    updated_at: IsoDatetime
    tenant_id: uuid.UUID | None = None
    tenant_slug: str | None = None


class UserCreate(schemas.BaseUserCreate):
    """Schema for creating users (fastapi-users compatible)."""

    username: str
    full_name: str | None = None
    company: str | None = None


class UserUpdate(schemas.BaseUserUpdate):
    """Schema for updating users (fastapi-users compatible).

    Cognito is the sole authentication mechanism: there is no local
    password. The inherited ``password`` field is force-dropped from the
    update dict so the fastapi-users manager never tries to set a
    (now-nonexistent) ``hashed_password`` column.
    """

    username: str | None = None
    full_name: str | None = None
    company: str | None = None
    phone: str | None = None

    def create_update_dict(self) -> dict:
        data: dict = super().create_update_dict()
        data.pop("password", None)
        return data

    def create_update_dict_superuser(self) -> dict:
        data: dict = super().create_update_dict_superuser()
        data.pop("password", None)
        return data


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


# Automation streaming schemas
class AutomationStreamingSettings(BaseModel):
    """Response model for automation streaming settings"""

    enabled: bool
    sessions_limit: int | None = None
    sessions_used: int
    sessions_reset_at: IsoDatetime | None = None

    model_config = ConfigDict(
        from_attributes=True,
    )


class AutomationStreamingToggle(BaseModel):
    """Request model for toggling automation streaming"""

    enabled: bool


class UserPreferencesUpdate(BaseModel):
    """Request model for updating user preferences. Merges with existing preferences."""

    product_mode: Literal["ai", "visual"] | None = None
    ui_bridge_co_pilot_enabled: bool | None = Field(
        default=None,
        description=(
            "When set, persists the per-user UI Bridge co-pilot opt-in. "
            "Pass `true` to enable, `false` to disable, omit to leave "
            "unchanged. See §4.5 of the production-safe plan."
        ),
    )

    model_config = ConfigDict(extra="ignore")


# Runner connection schemas
class RunnerConnectionInfo(BaseModel):
    """Connection information for qontinui-runner desktop app"""

    version: str
    url: str
    token: str
    userId: str
    projectId: int | None = None
    createdAt: IsoDatetime
    backendUrl: str  # HTTP(S) URL for REST API calls
    tokenExpiresAt: IsoDatetime | None = None  # When the token expires

    model_config = ConfigDict(
        from_attributes=True,
    )
