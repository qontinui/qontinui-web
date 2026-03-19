"""Pydantic schemas for element annotation API."""

from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.base import IsoDatetime

# Element schemas


class ElementAnnotationBase(BaseModel):
    """Base schema for element annotations."""

    x: int = Field(..., ge=0, description="X coordinate of bounding box")
    y: int = Field(..., ge=0, description="Y coordinate of bounding box")
    width: int = Field(..., gt=0, description="Width of bounding box")
    height: int = Field(..., gt=0, description="Height of bounding box")
    label: str | None = Field(None, description="Element label")
    element_type: str | None = Field(
        None, description="Element type (e.g., button, input, text)"
    )
    description: str | None = Field(None, description="Element description")
    notes: str | None = Field(None, description="Additional notes")
    extra_data: dict[str, Any] | None = Field(None, description="Custom properties")
    order: int = Field(default=0, ge=0, description="Display order")
    client_id: str | None = Field(None, description="Client-side ID for tracking/sync")


class ElementAnnotationCreate(ElementAnnotationBase):
    """Schema for creating an element annotation."""

    pass


class ElementAnnotationUpdate(BaseModel):
    """Schema for updating an element annotation."""

    x: int | None = Field(None, ge=0)
    y: int | None = Field(None, ge=0)
    width: int | None = Field(None, gt=0)
    height: int | None = Field(None, gt=0)
    label: str | None = None
    element_type: str | None = None
    description: str | None = None
    notes: str | None = None
    extra_data: dict[str, Any] | None = None
    order: int | None = Field(None, ge=0)
    client_id: str | None = None


class ElementAnnotationResponse(ElementAnnotationBase):
    """Schema for element annotation response."""

    id: str
    annotation_set_id: str

    model_config = ConfigDict(from_attributes=True)

    @field_validator("id", "annotation_set_id", mode="before")
    @classmethod
    def convert_uuid_to_str(cls, v: Any) -> str:
        """Convert UUID objects to strings before validation."""
        if isinstance(v, UUID):
            return str(v)
        return str(v)


# Annotation Set schemas


class ElementAnnotationSetCreate(BaseModel):
    """Schema for creating/saving element annotations."""

    elements: list[ElementAnnotationCreate] = Field(
        default_factory=list, description="List of element annotations"
    )
    screenshot_width: int = Field(..., gt=0, description="Screenshot width in pixels")
    screenshot_height: int = Field(..., gt=0, description="Screenshot height in pixels")
    screenshot_url: str | None = Field(None, description="URL of the screenshot")
    current_version_id: str | None = Field(
        None, description="ID of the version being saved (for updates)"
    )


class ElementAnnotationSetUpdate(BaseModel):
    """Schema for updating element annotations."""

    elements: list[ElementAnnotationCreate] = Field(
        ..., description="Complete list of element annotations"
    )
    screenshot_width: int = Field(..., gt=0, description="Screenshot width in pixels")
    screenshot_height: int = Field(..., gt=0, description="Screenshot height in pixels")
    screenshot_url: str | None = Field(None, description="URL of the screenshot")
    current_version_id: str | None = Field(
        None, description="ID of the version being updated"
    )


class ElementAnnotationSetResponse(BaseModel):
    """Schema for element annotation set response."""

    id: str
    project_id: str
    screenshot_width: int
    screenshot_height: int
    screenshot_url: str | None
    version_number: int
    is_current: bool
    version_comment: str | None
    created_at: IsoDatetime
    updated_at: IsoDatetime
    created_by_id: str
    elements: list[ElementAnnotationResponse] = Field(default_factory=list)
    element_count: int = Field(default=0)

    model_config = ConfigDict(from_attributes=True)

    @field_validator("id", "project_id", "created_by_id", mode="before")
    @classmethod
    def convert_uuid_to_str(cls, v: Any) -> str:
        """Convert UUID objects to strings before validation."""
        if isinstance(v, UUID):
            return str(v)
        return str(v)

    @field_validator("element_count", mode="before")
    @classmethod
    def set_element_count(cls, v: Any, info: Any) -> int:
        """Compute element count from elements list if not set."""
        if v is not None:
            return int(v)
        elements = info.data.get("elements", [])
        return len(elements) if elements else 0


class ElementAnnotationSetMetadata(BaseModel):
    """Metadata-only response for annotation sets (without elements)."""

    id: str
    project_id: str
    screenshot_width: int
    screenshot_height: int
    screenshot_url: str | None
    version_number: int
    is_current: bool
    version_comment: str | None
    created_at: IsoDatetime
    updated_at: IsoDatetime
    created_by_id: str
    element_count: int

    model_config = ConfigDict(from_attributes=True)

    @field_validator("id", "project_id", "created_by_id", mode="before")
    @classmethod
    def convert_uuid_to_str(cls, v: Any) -> str:
        """Convert UUID objects to strings before validation."""
        if isinstance(v, UUID):
            return str(v)
        return str(v)


# Version schemas


class VersionSnapshotCreate(BaseModel):
    """Schema for saving a new version snapshot."""

    comment: str | None = Field(None, description="Comment describing this version")
    elements: list[ElementAnnotationCreate] = Field(
        ..., description="Element annotations to save in this version"
    )


class VersionResponse(BaseModel):
    """Schema for version list response."""

    id: str
    version_number: int
    element_count: int
    is_current: bool
    version_comment: str | None
    created_at: IsoDatetime
    created_by_id: str

    model_config = ConfigDict(from_attributes=True)

    @field_validator("id", "created_by_id", mode="before")
    @classmethod
    def convert_uuid_to_str(cls, v: Any) -> str:
        """Convert UUID objects to strings before validation."""
        if isinstance(v, UUID):
            return str(v)
        return str(v)


class VersionListResponse(BaseModel):
    """Schema for list of versions."""

    versions: list[VersionResponse]
    total: int
    current_version_id: str | None

    @field_validator("current_version_id", mode="before")
    @classmethod
    def convert_optional_uuid_to_str(cls, v: Any) -> str | None:
        """Convert UUID objects to strings before validation."""
        if v is None:
            return None
        if isinstance(v, UUID):
            return str(v)
        return str(v)
