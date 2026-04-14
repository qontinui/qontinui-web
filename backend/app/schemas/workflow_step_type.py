"""Pydantic schemas for workflow step type configurations."""

from typing import Literal
from uuid import UUID

from app.schemas.base import BaseORMSchema, IsoDatetime
from pydantic import BaseModel, Field

WorkflowPhase = Literal["setup", "verification", "agentic", "completion"]


# ─── Step Type Configs ───────────────────────────────────────────────────────


class StepTypeConfigBase(BaseModel):
    """Base schema for workflow step type configuration fields."""

    step_type: str = Field(..., max_length=50)
    phase: WorkflowPhase
    label: str = Field(..., max_length=255)
    description: str = ""
    icon: str = Field(..., max_length=50)
    color: str = Field(..., max_length=30)
    sort_order: int = Field(..., ge=0)
    enabled: bool = True


class StepTypeConfigCreate(StepTypeConfigBase):
    """Schema for creating a workflow step type configuration."""

    pass


class StepTypeConfigUpdate(BaseModel):
    """Schema for updating a workflow step type configuration."""

    label: str | None = Field(None, max_length=255)
    description: str | None = None
    icon: str | None = Field(None, max_length=50)
    color: str | None = Field(None, max_length=30)
    sort_order: int | None = Field(None, ge=0)
    enabled: bool | None = None


class StepTypeConfigResponse(BaseORMSchema, StepTypeConfigBase):
    """Response schema for a workflow step type configuration."""

    id: UUID
    user_id: UUID
    is_built_in: bool
    created_at: IsoDatetime
    updated_at: IsoDatetime


class StepTypeConfigListResponse(BaseModel):
    """Paginated list response for step type configurations."""

    items: list[StepTypeConfigResponse]
    count: int


# ─── GUI Action Type Configs ─────────────────────────────────────────────────


class GuiActionTypeConfigBase(BaseModel):
    """Base schema for GUI action type configuration fields."""

    action_type: str = Field(..., max_length=50)
    label: str = Field(..., max_length=255)
    description: str = ""
    icon: str = Field(..., max_length=50)
    sort_order: int = Field(..., ge=0)
    enabled: bool = True


class GuiActionTypeConfigCreate(GuiActionTypeConfigBase):
    """Schema for creating a GUI action type configuration."""

    pass


class GuiActionTypeConfigUpdate(BaseModel):
    """Schema for updating a GUI action type configuration."""

    label: str | None = Field(None, max_length=255)
    description: str | None = None
    icon: str | None = Field(None, max_length=50)
    sort_order: int | None = Field(None, ge=0)
    enabled: bool | None = None


class GuiActionTypeConfigResponse(BaseORMSchema, GuiActionTypeConfigBase):
    """Response schema for a GUI action type configuration."""

    id: UUID
    user_id: UUID
    is_built_in: bool
    created_at: IsoDatetime
    updated_at: IsoDatetime


class GuiActionTypeConfigListResponse(BaseModel):
    """Paginated list response for GUI action type configurations."""

    items: list[GuiActionTypeConfigResponse]
    count: int


# ─── Workflow Phase Configs ──────────────────────────────────────────────────


class WorkflowPhaseConfigBase(BaseModel):
    """Base schema for workflow phase configuration fields."""

    phase: WorkflowPhase
    label: str = Field(..., max_length=255)
    description: str = ""
    color: str = Field(..., max_length=30)
    sort_order: int = Field(..., ge=0)
    enabled: bool = True


class WorkflowPhaseConfigCreate(WorkflowPhaseConfigBase):
    """Schema for creating a workflow phase configuration."""

    pass


class WorkflowPhaseConfigUpdate(BaseModel):
    """Schema for updating a workflow phase configuration."""

    label: str | None = Field(None, max_length=255)
    description: str | None = None
    color: str | None = Field(None, max_length=30)
    sort_order: int | None = Field(None, ge=0)
    enabled: bool | None = None


class WorkflowPhaseConfigResponse(BaseORMSchema, WorkflowPhaseConfigBase):
    """Response schema for a workflow phase configuration."""

    id: UUID
    user_id: UUID
    is_built_in: bool
    created_at: IsoDatetime
    updated_at: IsoDatetime


class WorkflowPhaseConfigListResponse(BaseModel):
    """Paginated list response for workflow phase configurations."""

    items: list[WorkflowPhaseConfigResponse]
    count: int
