"""Pydantic schemas for error monitor CRUD operations."""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class ErrorMonitorEntryCreate(BaseModel):
    """Create a new error monitor entry."""

    error_type: str = Field(..., max_length=255)
    message: str
    stack_trace: str | None = None
    severity: str = Field(default="medium", max_length=20)
    category: str | None = Field(default=None, max_length=100)
    source: str | None = Field(default=None, max_length=255)
    file_path: str | None = Field(default=None, max_length=500)
    line_number: int | None = None
    task_run_id: UUID | None = None
    project_id: UUID | None = None
    extra_metadata: dict | None = None


class ErrorMonitorEntryUpdate(BaseModel):
    """Update an error monitor entry."""

    severity: str | None = Field(default=None, max_length=20)
    status: str | None = Field(default=None, max_length=20)
    category: str | None = Field(default=None, max_length=100)
    acknowledged: bool | None = None
    resolution_notes: str | None = None


class ErrorMonitorEntryResponse(BaseModel):
    """Error monitor entry response."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    created_by_user_id: UUID
    project_id: UUID | None
    task_run_id: UUID | None
    error_type: str
    message: str
    stack_trace: str | None
    severity: str
    status: str
    category: str | None
    source: str | None
    file_path: str | None
    line_number: int | None
    occurrence_count: int
    first_seen_at: datetime
    last_seen_at: datetime
    acknowledged: bool
    acknowledged_at: datetime | None
    resolved_at: datetime | None
    resolution_notes: str | None
    resolved_by_task_run_id: UUID | None
    extra_metadata: dict | None
    created_at: datetime
    updated_at: datetime


class ErrorMonitorListResponse(BaseModel):
    """Paginated list of error entries."""

    items: list[ErrorMonitorEntryResponse]
    pagination: dict


class ErrorMonitorSummary(BaseModel):
    """Summary stats for error monitor."""

    total: int
    by_severity: dict[str, int]
    by_status: dict[str, int]
    by_category: dict[str, int]
