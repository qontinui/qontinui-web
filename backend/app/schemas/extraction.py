"""Pydantic schemas for web extraction.

This module re-exports shared schemas from qontinui-schemas and adds
backend-specific schemas (with UUID conversion, ORM integration, etc.).
"""

from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

# Re-export shared schemas from qontinui-schemas
from qontinui_schemas.extraction import (
    BoundingBox,
    ElementAnnotation,
    ExtractionStats,
    InferredTransition,
    StateAnnotation,
    StateType,
    TriggerType,
)

from app.schemas.base import IsoDatetime

# Re-export for backward compatibility
__all__ = [
    "BoundingBox",
    "ElementAnnotation",
    "ExtractionStats",
    "InferredTransition",
    "StateAnnotation",
    "StateType",
    "TriggerType",
    "ExtractionConfig",
    "ExtractionSessionCreate",
    "ExtractionSessionUpdate",
    "ExtractionSessionResponse",
    "ExtractionSessionDetail",
    "AnnotationUpdate",
    "ExtractionAnnotationResponse",
    "StateImportRequest",
    "ImportResult",
]


class ExtractionConfig(BaseModel):
    """Configuration for web extraction session."""

    viewports: list[tuple[int, int]] = Field(default=[(1920, 1080)])
    capture_hover_states: bool = True
    capture_focus_states: bool = True
    max_depth: int = 5
    max_pages: int = 100
    auth_cookies: dict[str, str] = Field(default_factory=dict)


class ExtractionSessionCreate(BaseModel):
    """Request schema for creating an extraction session."""

    source_urls: list[str]
    config: ExtractionConfig = Field(default_factory=ExtractionConfig)


class ExtractionSessionUpdate(BaseModel):
    """Request schema for updating an extraction session."""

    status: str | None = None
    stats: dict[str, Any] | None = None
    error_message: str | None = None


class ExtractionSessionResponse(BaseModel):
    """Response schema for an extraction session."""

    id: str
    project_id: str
    source_urls: list[str]
    config: dict[str, Any]
    status: str
    stats: dict[str, Any]
    error_message: str | None
    created_at: IsoDatetime
    started_at: IsoDatetime | None
    completed_at: IsoDatetime | None
    created_by: str | None

    model_config = ConfigDict(from_attributes=True)

    @field_validator("id", "project_id", "created_by", mode="before")
    @classmethod
    def convert_uuid_to_str(cls, v):
        """Convert UUID objects to strings before validation."""
        if isinstance(v, UUID):
            return str(v)
        return v


class ExtractionSessionDetail(ExtractionSessionResponse):
    """Extraction session with annotations included."""

    annotations: list["ExtractionAnnotationResponse"] = Field(default_factory=list)


class AnnotationUpdate(BaseModel):
    """Request schema for updating annotations."""

    screenshot_id: str
    source_url: str = ""
    viewport_width: int = 1920
    viewport_height: int = 1080
    elements: list[ElementAnnotation] = Field(default_factory=list)
    states: list[StateAnnotation] = Field(default_factory=list)


class ExtractionAnnotationResponse(BaseModel):
    """Response schema for an extraction annotation."""

    id: str
    session_id: str
    screenshot_id: str
    source_url: str
    viewport_width: int
    viewport_height: int
    elements: list[dict[str, Any]]
    states: list[dict[str, Any]]
    created_at: IsoDatetime
    updated_at: IsoDatetime

    model_config = ConfigDict(from_attributes=True)

    @field_validator("id", "session_id", mode="before")
    @classmethod
    def convert_uuid_to_str(cls, v):
        """Convert UUID objects to strings before validation."""
        if isinstance(v, UUID):
            return str(v)
        return v


class StateImportRequest(BaseModel):
    """Request schema for importing states to state structure."""

    state_ids: list[str] = Field(default_factory=list)  # Empty = all states
    target_workflow_id: str | None = None


class ImportResult(BaseModel):
    """Response schema for import operation result."""

    imported_states: int
    imported_transitions: int
    workflow_id: str | None
