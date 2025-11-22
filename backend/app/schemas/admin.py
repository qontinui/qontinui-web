"""Pydantic schemas for admin endpoints."""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, EmailStr, Field


class AdminUserData(BaseModel):
    """Schema for admin user data response."""

    id: str = Field(..., description="User UUID")
    email: EmailStr
    username: str
    full_name: Optional[str] = None
    is_active: bool
    is_verified: bool
    created_at: str = Field(..., description="ISO 8601 datetime string")
    project_count: int = Field(..., ge=0)
    subscription_tier: str = Field(
        ..., description="Subscription tier: free, hobby, or pro"
    )
    last_login: Optional[str] = Field(None, description="ISO 8601 datetime string")
    email_verified: bool = Field(
        default=False, description="Email verification status (alias for is_verified)"
    )

    class Config:
        from_attributes = True


class AdminProjectData(BaseModel):
    """Schema for admin project data response."""

    id: str = Field(..., description="Project ID or UUID")
    name: str = Field(..., min_length=1)
    description: Optional[str] = None
    owner_id: str = Field(..., description="Owner UUID")
    owner_username: str
    owner_email: EmailStr
    created_at: Optional[str] = Field(None, description="ISO 8601 datetime string")
    updated_at: Optional[str] = Field(None, description="ISO 8601 datetime string")
    state_count: int = Field(..., ge=0)
    transition_count: int = Field(..., ge=0)

    class Config:
        from_attributes = True


class AdminStats(BaseModel):
    """Schema for admin statistics response."""

    total_users: int = Field(..., ge=0)
    new_users_week: int = Field(..., ge=0)
    new_users_month: int = Field(..., ge=0)
    total_projects: int = Field(..., ge=0)
    projects_week: int = Field(..., ge=0)
    active_users: int = Field(..., ge=0)

    class Config:
        from_attributes = True
