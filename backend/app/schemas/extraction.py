"""
Pydantic schemas for web extraction.
"""

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


# Bounding box
class BoundingBox(BaseModel):
    x: int
    y: int
    width: int
    height: int


# Element annotation
class ElementAnnotation(BaseModel):
    id: str
    bbox: BoundingBox
    element_type: str
    text_content: str | None = None
    selector: str
    is_interactive: bool = True
    is_enabled: bool = True
    semantic_role: str | None = None
    aria_label: str | None = None


# State annotation
class StateAnnotation(BaseModel):
    id: str
    name: str
    bbox: BoundingBox
    state_type: str
    element_ids: list[str] = Field(default_factory=list)


# Extraction config
class ExtractionConfig(BaseModel):
    viewports: list[tuple[int, int]] = Field(default=[(1920, 1080)])
    capture_hover_states: bool = True
    capture_focus_states: bool = True
    max_depth: int = 5
    max_pages: int = 100
    auth_cookies: dict[str, str] = Field(default_factory=dict)


# Create extraction session
class ExtractionSessionCreate(BaseModel):
    source_urls: list[str]
    config: ExtractionConfig = Field(default_factory=ExtractionConfig)


# Update extraction session
class ExtractionSessionUpdate(BaseModel):
    status: str | None = None
    stats: dict[str, Any] | None = None
    error_message: str | None = None


# Extraction session response
class ExtractionSessionResponse(BaseModel):
    id: str
    project_id: str
    source_urls: list[str]
    config: dict[str, Any]
    status: str
    stats: dict[str, Any]
    error_message: str | None
    created_at: datetime
    started_at: datetime | None
    completed_at: datetime | None
    created_by: str | None

    model_config = ConfigDict(from_attributes=True)

    @field_validator("id", "project_id", "created_by", mode="before")
    @classmethod
    def convert_uuid_to_str(cls, v):
        """Convert UUID objects to strings before validation"""
        if isinstance(v, UUID):
            return str(v)
        return v


# Extraction session with annotations
class ExtractionSessionDetail(ExtractionSessionResponse):
    annotations: list["ExtractionAnnotationResponse"] = Field(default_factory=list)


# Annotation update
class AnnotationUpdate(BaseModel):
    screenshot_id: str
    elements: list[ElementAnnotation]
    states: list[StateAnnotation]


# Annotation response
class ExtractionAnnotationResponse(BaseModel):
    id: str
    session_id: str
    screenshot_id: str
    source_url: str
    viewport_width: int
    viewport_height: int
    elements: list[dict[str, Any]]
    states: list[dict[str, Any]]
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)

    @field_validator("id", "session_id", mode="before")
    @classmethod
    def convert_uuid_to_str(cls, v):
        """Convert UUID objects to strings before validation"""
        if isinstance(v, UUID):
            return str(v)
        return v


# Import to state structure request
class StateImportRequest(BaseModel):
    state_ids: list[str] = Field(default_factory=list)  # Empty = all states
    target_workflow_id: str | None = None


# Import result
class ImportResult(BaseModel):
    imported_states: int
    imported_transitions: int
    workflow_id: str | None
