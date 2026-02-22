"""Pydantic schemas for workflow sequence management."""

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class ScheduleConfig(BaseModel):
    """Schedule configuration for a workflow sequence."""

    item_schedules: list[str | None] = []
    timezone: str = "UTC"


class WorkflowSequenceCreate(BaseModel):
    """Schema for creating a workflow sequence."""

    name: str = Field(..., min_length=1, max_length=200)
    description: str | None = Field(None, max_length=2000)
    workflow_ids: list[str] = Field(..., min_length=1)
    stop_on_failure: bool = True
    schedule: ScheduleConfig | None = None


class WorkflowSequenceUpdate(BaseModel):
    """Schema for updating a workflow sequence."""

    name: str | None = Field(None, min_length=1, max_length=200)
    description: str | None = Field(None, max_length=2000)
    workflow_ids: list[str] | None = Field(None, min_length=1)
    stop_on_failure: bool | None = None
    schedule: ScheduleConfig | None = None


class WorkflowSequenceResponse(BaseModel):
    """Full workflow sequence response."""

    id: UUID
    project_id: UUID
    created_by: UUID
    name: str
    description: str | None
    workflow_ids: list[str]
    stop_on_failure: bool
    schedule: dict[str, Any] | None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class WorkflowSequenceSummary(BaseModel):
    """Lightweight summary for list views."""

    id: UUID
    project_id: UUID
    name: str
    description: str | None
    workflow_count: int
    has_schedule: bool
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class WorkflowSequenceListResponse(BaseModel):
    """Paginated list of workflow sequences."""

    sequences: list[WorkflowSequenceSummary]
    total: int
    limit: int
    offset: int
    has_more: bool
