"""Pydantic schemas for tenant-scoped design/UX policies."""

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

from app.schemas.base import BaseORMSchema, IsoDatetime

Severity = Literal["info", "warning", "error"]


class DesignPolicyBase(BaseModel):
    """Base schema for design policy fields."""

    slug: str = Field(..., max_length=100)
    name: str = Field(..., max_length=255)
    principle: str = ""
    rationale: str = ""
    enforcement: str = ""
    category: str = Field("", max_length=50)
    severity: Severity = "info"
    applies_to: str = Field("", max_length=255)
    sort_order: int = Field(0, ge=0)
    enabled: bool = True


class DesignPolicyCreate(DesignPolicyBase):
    """Schema for creating a design policy."""

    pass


class DesignPolicyUpdate(BaseModel):
    """Schema for updating a design policy (all fields optional)."""

    name: str | None = Field(None, max_length=255)
    principle: str | None = None
    rationale: str | None = None
    enforcement: str | None = None
    category: str | None = Field(None, max_length=50)
    severity: Severity | None = None
    applies_to: str | None = Field(None, max_length=255)
    sort_order: int | None = Field(None, ge=0)
    enabled: bool | None = None


class DesignPolicyResponse(BaseORMSchema, DesignPolicyBase):
    """Response schema for a design policy."""

    id: UUID
    tenant_id: UUID
    is_built_in: bool
    created_at: IsoDatetime
    updated_at: IsoDatetime


class DesignPolicyListResponse(BaseModel):
    """List response for design policies."""

    items: list[DesignPolicyResponse]
    count: int
