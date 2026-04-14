"""
Pydantic schemas for detected issues.

Issues are detected during AI-assisted automation sessions and synced from the runner.
"""

from datetime import datetime
from typing import Literal
from uuid import UUID

from app.schemas.base import BaseORMSchema, IsoDatetime
from pydantic import BaseModel, Field

# Type definitions matching runner types
IssueSeverity = Literal["critical", "high", "medium", "low"]
IssueType = Literal["error", "warning", "exception", "type_error", "runtime_error"]
IssueStatus = Literal["detected", "in_progress", "resolved", "skipped"]
IssueSourceType = Literal[
    "log", "screenshot", "console", "test_output", "ai_analysis", "other"
]


class IssueSource(BaseModel):
    """Where the AI found/detected the error."""

    type: IssueSourceType
    path: str | None = None
    line_range: tuple[int, int] | None = None
    description: str | None = None


# Base schemas
class DetectedIssueBase(BaseModel):
    """Base schema for detected issues."""

    type: IssueType
    severity: IssueSeverity
    title: str = Field(..., max_length=500)
    description: str | None = None
    file: str | None = Field(None, max_length=1000)
    line: int | None = None
    source: IssueSource


class DetectedIssueCreate(DetectedIssueBase):
    """Schema for creating a detected issue."""

    session_id: str = Field(..., max_length=255)
    project_id: UUID | None = None
    detected_at: datetime


class DetectedIssueUpdate(BaseModel):
    """Schema for updating a detected issue."""

    status: IssueStatus | None = None
    resolution: str | None = None


class DetectedIssueResponse(BaseORMSchema, DetectedIssueBase):
    """Schema for returning a detected issue."""

    id: UUID
    session_id: str
    project_id: UUID | None
    user_id: UUID
    status: IssueStatus
    resolution: str | None
    detected_at: IsoDatetime
    resolved_at: IsoDatetime | None
    created_at: IsoDatetime
    updated_at: IsoDatetime


# Bulk sync schemas (for runner to web sync)
class IssueSyncItem(DetectedIssueBase):
    """Single issue in a sync request."""

    id: str  # Client-generated ID for deduplication
    session_id: str = Field(..., max_length=255)
    status: IssueStatus = "detected"
    resolution: str | None = None
    detected_at: datetime
    resolved_at: datetime | None = None


class IssuesSyncRequest(BaseModel):
    """Request to sync multiple issues from runner."""

    project_id: UUID | None = None
    issues: list[IssueSyncItem]


class IssuesSyncResponse(BaseModel):
    """Response from sync operation."""

    synced: int
    updated: int
    errors: list[str] = Field(default_factory=list)


# Statistics schemas
class IssueStats(BaseModel):
    """Aggregated issue statistics."""

    total: int = 0
    by_status: dict[str, int] = Field(default_factory=dict)
    by_severity: dict[str, int] = Field(default_factory=dict)
    by_type: dict[str, int] = Field(default_factory=dict)
    resolved_today: int = 0
    detected_today: int = 0


class IssueListResponse(BaseModel):
    """Paginated list of issues."""

    issues: list[DetectedIssueResponse]
    total: int
    limit: int
    offset: int
