"""Pydantic schemas for web extraction."""

from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.base import IsoDatetime


class BoundingBox(BaseModel):
    """Bounding box coordinates for an element."""

    x: int
    y: int
    width: int
    height: int


class ElementAnnotation(BaseModel):
    """Annotation data for a single UI element."""

    id: str
    bbox: BoundingBox
    element_type: str
    text_content: str | None = None
    selector: str
    is_interactive: bool = True
    is_enabled: bool = True
    semantic_role: str | None = None
    aria_label: str | None = None


class StateAnnotation(BaseModel):
    """Annotation data for a UI state."""

    id: str
    name: str
    bbox: BoundingBox
    state_type: str
    element_ids: list[str] = Field(default_factory=list)


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
    elements: list[ElementAnnotation]
    states: list[StateAnnotation]


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
