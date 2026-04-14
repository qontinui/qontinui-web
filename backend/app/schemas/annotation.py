"""
Pydantic schemas for annotation API
"""

from typing import Any
from uuid import UUID

from app.schemas.base import IsoDatetime
from pydantic import BaseModel, ConfigDict, Field, field_validator

# Screenshot schema for multi-screenshot support


class Screenshot(BaseModel):
    """Individual screenshot metadata"""

    name: str
    url: str
    width: int = Field(..., gt=0)
    height: int = Field(..., gt=0)


# Annotation schemas


class AnnotationBase(BaseModel):
    x: int = Field(..., ge=0)
    y: int = Field(..., ge=0)
    width: int = Field(..., gt=0)
    height: int = Field(..., gt=0)
    label: str | None = None
    description: str | None = None
    reason: str | None = None
    extra_data: dict[str, Any] | None = None
    screenshot_index: int = Field(
        default=0,
        ge=0,
        description="Index of the screenshot this annotation belongs to",
    )


class AnnotationCreate(AnnotationBase):
    pass


class AnnotationUpdate(BaseModel):
    x: int | None = Field(None, ge=0)
    y: int | None = Field(None, ge=0)
    width: int | None = Field(None, gt=0)
    height: int | None = Field(None, gt=0)
    label: str | None = None
    description: str | None = None
    reason: str | None = None
    extra_data: dict[str, Any] | None = None
    screenshot_index: int | None = Field(
        None, ge=0, description="Index of the screenshot this annotation belongs to"
    )


class AnnotationResponse(AnnotationBase):
    id: str
    annotation_set_id: str
    order: int

    model_config = ConfigDict(from_attributes=True)

    @field_validator("id", "annotation_set_id", mode="before")
    @classmethod
    def convert_uuid_to_str(cls, v):
        """Convert UUID objects to strings before validation"""
        if isinstance(v, UUID):
            return str(v)
        return v


# Annotation Set schemas


class AnnotationSetBase(BaseModel):
    screenshot_name: str
    screenshot_url: str
    image_width: int = Field(..., gt=0)
    image_height: int = Field(..., gt=0)
    notes: str | None = None
    boundary_width: int = Field(
        default=5, ge=0, le=50, description="Boundary tolerance in pixels for matching"
    )
    screenshots: list[Screenshot] | None = Field(
        None, description="Array of screenshots for multi-screenshot support"
    )


class AnnotationSetCreate(AnnotationSetBase):
    annotations: list[AnnotationCreate] | None = None

    @field_validator("annotations")
    @classmethod
    def validate_screenshot_indices(cls, v, info):
        """Validate that annotation screenshot_index values are consistent with screenshots array"""
        if v is None:
            return v

        screenshots = info.data.get("screenshots")
        max_index = len(screenshots) - 1 if screenshots else 0

        for annotation in v:
            if annotation.screenshot_index > max_index:
                raise ValueError(
                    f"Annotation screenshot_index {annotation.screenshot_index} exceeds "
                    f"maximum screenshot index {max_index}"
                )

        return v


class AnnotationSetUpdate(BaseModel):
    screenshot_name: str | None = None
    screenshot_url: str | None = None
    notes: str | None = None
    boundary_width: int | None = Field(
        None, ge=0, le=50, description="Boundary tolerance in pixels"
    )
    screenshots: list[Screenshot] | None = Field(
        None, description="Array of screenshots for multi-screenshot support"
    )
    annotations: list[AnnotationCreate] | None = None

    @field_validator("annotations")
    @classmethod
    def validate_screenshot_indices(cls, v, info):
        """Validate that annotation screenshot_index values are consistent with screenshots array"""
        if v is None:
            return v

        screenshots = info.data.get("screenshots")
        max_index = len(screenshots) - 1 if screenshots else 0

        for annotation in v:
            if annotation.screenshot_index > max_index:
                raise ValueError(
                    f"Annotation screenshot_index {annotation.screenshot_index} exceeds "
                    f"maximum screenshot index {max_index}"
                )

        return v


class AnnotationSetResponse(AnnotationSetBase):
    id: str
    created_at: IsoDatetime
    updated_at: IsoDatetime
    created_by_id: str
    annotations: list[AnnotationResponse] = []

    model_config = ConfigDict(from_attributes=True)

    @field_validator("id", "created_by_id", mode="before")
    @classmethod
    def convert_uuid_to_str(cls, v):
        """Convert UUID objects to strings before validation"""
        if isinstance(v, UUID):
            return str(v)
        return v

    @property
    def screenshot_count(self) -> int:
        """Get the number of screenshots in this set"""
        if self.screenshots is None:
            return 1  # Single screenshot (backward compatibility)
        return len(self.screenshots)
