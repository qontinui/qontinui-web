"""Pydantic schemas for finding category configurations."""

from typing import Literal
from uuid import UUID

from app.schemas.base import BaseORMSchema, IsoDatetime
from pydantic import BaseModel, Field

ActionType = Literal["auto_fix", "needs_user_input", "manual", "informational"]


class FindingCategoryConfigBase(BaseModel):
    """Base schema for finding category configuration fields."""

    slug: str = Field(..., max_length=100)
    name: str = Field(..., max_length=255)
    description: str = ""
    icon: str = Field(..., max_length=50)
    color: str = Field(..., max_length=30)
    default_action_type: ActionType
    sort_order: int = Field(..., ge=0)
    enabled: bool = True


class FindingCategoryConfigCreate(FindingCategoryConfigBase):
    """Schema for creating a finding category configuration."""

    pass


class FindingCategoryConfigUpdate(BaseModel):
    """Schema for updating a finding category configuration."""

    name: str | None = Field(None, max_length=255)
    description: str | None = None
    icon: str | None = Field(None, max_length=50)
    color: str | None = Field(None, max_length=30)
    default_action_type: ActionType | None = None
    sort_order: int | None = Field(None, ge=0)
    enabled: bool | None = None


class FindingCategoryConfigResponse(BaseORMSchema, FindingCategoryConfigBase):
    """Response schema for a finding category configuration."""

    id: UUID
    user_id: UUID
    is_built_in: bool
    created_at: IsoDatetime
    updated_at: IsoDatetime


class FindingCategoryConfigListResponse(BaseModel):
    """Paginated list response for finding category configurations."""

    items: list[FindingCategoryConfigResponse]
    count: int
