"""
Pydantic schemas for discoveries.

Discoveries are config improvements detected by runners that users can review and accept/reject.
"""

from typing import Any, Literal
from uuid import UUID

from app.schemas.base import BaseORMSchema, IsoDatetime
from pydantic import BaseModel, Field

# Type definitions
DiscoveryType = Literal[
    "new_element",
    "new_transition",
    "timing_update",
    "flaky_detection",
    "unexpected_element",
]
DiscoveryStatus = Literal["pending", "accepted", "rejected", "deferred"]


class DiscoveryBase(BaseModel):
    """Base schema for discoveries."""

    runner_id: str = Field(..., max_length=100)
    runner_name: str | None = Field(None, max_length=255)
    config_id: str = Field(..., max_length=100)
    config_name: str | None = Field(None, max_length=255)
    discovery_type: DiscoveryType
    title: str = Field(..., max_length=500)
    description: str | None = None
    discovery_data: dict[str, Any] = Field(default_factory=dict)
    evidence: dict[str, Any] = Field(default_factory=dict)
    confidence: float = Field(0.0, ge=0.0, le=1.0)
    runs_observed: int = Field(0, ge=0)


class DiscoveryCreate(DiscoveryBase):
    """Schema for creating a discovery."""

    project_id: UUID


class DiscoveryFromRunner(DiscoveryBase):
    """
    Schema for runner submissions.

    The runner POSTs discoveries with project_id and runner_id.
    The backend looks up the user from the project.
    """

    project_id: UUID


class DiscoveryUpdate(BaseModel):
    """Schema for updating a discovery."""

    status: DiscoveryStatus | None = None
    user_notes: str | None = None
    applied_to_config: bool | None = None


class DiscoveryResponse(BaseORMSchema, DiscoveryBase):
    """Schema for returning a discovery."""

    id: UUID
    project_id: UUID
    user_id: UUID
    status: DiscoveryStatus
    reviewed_at: IsoDatetime | None
    reviewed_by_id: UUID | None
    user_notes: str | None
    applied_to_config: bool
    created_at: IsoDatetime
    updated_at: IsoDatetime


class DiscoveryListResponse(BaseModel):
    """Paginated list of discoveries."""

    discoveries: list[DiscoveryResponse]
    total: int
    limit: int
    offset: int


class DiscoveryAcceptRequest(BaseModel):
    """Request to accept a discovery."""

    user_notes: str | None = None
    apply_to_config: bool = False


class DiscoveryRejectRequest(BaseModel):
    """Request to reject a discovery."""

    user_notes: str | None = None


class DiscoveryStats(BaseModel):
    """Aggregated discovery statistics."""

    total: int = 0
    pending: int = 0
    accepted: int = 0
    rejected: int = 0
    deferred: int = 0
    by_type: dict[str, int] = Field(default_factory=dict)


class PendingCountResponse(BaseModel):
    """Response for pending count endpoint."""

    pending_count: int
