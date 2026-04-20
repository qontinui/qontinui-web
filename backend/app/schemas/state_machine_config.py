"""Pydantic schemas for state machine configuration management."""

from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.base import IsoDatetime


class StateMachineConfigCreate(BaseModel):
    """Schema for creating a state machine config."""

    name: str = Field(..., min_length=1, max_length=200)
    description: str | None = Field(None, max_length=2000)
    configuration: dict[str, Any] = Field(
        ..., description="Full builder state: {states, transitions, fingerprintDetails}"
    )
    tags: list[str] = Field(default_factory=list, max_length=20)


class StateMachineConfigUpdate(BaseModel):
    """Schema for updating a state machine config."""

    name: str | None = Field(None, min_length=1, max_length=200)
    description: str | None = Field(None, max_length=2000)
    configuration: dict[str, Any] | None = None
    tags: list[str] | None = Field(None, max_length=20)


class StateMachineConfigResponse(BaseModel):
    """Full config response."""

    id: UUID
    project_id: UUID
    created_by: UUID
    name: str
    description: str | None
    version: str
    configuration: dict[str, Any]
    tags: list[str]
    created_at: IsoDatetime
    updated_at: IsoDatetime

    model_config = ConfigDict(from_attributes=True)


class StateMachineConfigSummary(BaseModel):
    """Lightweight config summary for list views."""

    id: UUID
    name: str
    description: str | None
    tags: list[str]
    updated_at: IsoDatetime

    model_config = ConfigDict(from_attributes=True)


class StateMachineConfigListResponse(BaseModel):
    """Paginated list of configs."""

    configs: list[StateMachineConfigSummary]
    total: int
    limit: int
    offset: int
    has_more: bool
