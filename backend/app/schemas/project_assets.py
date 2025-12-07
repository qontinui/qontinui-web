"""
Pydantic schemas for project assets (screenshots and images).

These schemas define the request/response models for managing project screenshots
and images that are used in visual automation workflows.
"""

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

from app.schemas.base import BaseORMSchema, IsoDatetime

# ============================================================================
# ProjectScreenshot Schemas
# ============================================================================


class ProjectScreenshotBase(BaseModel):
    """Shared fields for project screenshots."""

    name: str = Field(..., min_length=1, max_length=255, description="Screenshot name")
    source: Literal["manual_upload", "runner_capture", "web_capture"] = Field(
        ..., description="Source of the screenshot"
    )
    monitor_index: int | None = Field(
        None, ge=0, description="Monitor index if captured from multi-monitor setup"
    )
    metadata: dict[str, Any] | None = Field(
        None,
        description="Additional metadata (window title, resolution, timestamp, etc.)",
    )


class ProjectScreenshotCreate(BaseModel):
    """Schema for creating a new project screenshot."""

    name: str = Field(..., min_length=1, max_length=255, description="Screenshot name")
    source: Literal["manual_upload", "runner_capture", "web_capture"] = Field(
        "manual_upload", description="Source of the screenshot"
    )
    monitor_index: int | None = Field(
        None, ge=0, description="Monitor index if captured from multi-monitor setup"
    )
    metadata: dict[str, Any] | None = Field(
        None,
        description="Additional metadata (window title, resolution, timestamp, etc.)",
    )

    @field_validator("metadata")
    @classmethod
    def validate_metadata(cls, v):
        """Ensure metadata doesn't contain sensitive information."""
        if v is None:
            return v

        # List of keys that might contain sensitive information
        sensitive_keys = [
            "password",
            "token",
            "secret",
            "api_key",
            "apikey",
            "credentials",
        ]

        for key in v.keys():
            if any(sensitive in key.lower() for sensitive in sensitive_keys):
                raise ValueError(
                    f"Metadata key '{key}' appears to contain sensitive information"
                )

        return v


class ProjectScreenshotUpdate(BaseModel):
    """Schema for updating a project screenshot."""

    name: str | None = Field(None, min_length=1, max_length=255)
    source: Literal["manual_upload", "runner_capture", "web_capture"] | None = None
    monitor_index: int | None = Field(None, ge=0)
    metadata: dict[str, Any] | None = None

    @field_validator("metadata")
    @classmethod
    def validate_metadata(cls, v):
        """Ensure metadata doesn't contain sensitive information."""
        if v is None:
            return v

        sensitive_keys = [
            "password",
            "token",
            "secret",
            "api_key",
            "apikey",
            "credentials",
        ]

        for key in v.keys():
            if any(sensitive in key.lower() for sensitive in sensitive_keys):
                raise ValueError(
                    f"Metadata key '{key}' appears to contain sensitive information"
                )

        return v


class ProjectScreenshotResponse(BaseORMSchema, ProjectScreenshotBase):
    """Schema for project screenshot response with full details."""

    id: UUID
    project_id: UUID
    storage_path: str = Field(..., description="S3/MinIO storage path")
    presigned_url: str | None = Field(
        None, description="Temporary presigned URL for downloading"
    )
    thumbnail_url: str | None = Field(
        None, description="Temporary presigned URL for thumbnail"
    )
    width: int = Field(..., gt=0, description="Image width in pixels")
    height: int = Field(..., gt=0, description="Image height in pixels")
    file_size: int = Field(..., ge=0, description="File size in bytes")
    content_type: str = Field(
        default="image/png", description="MIME type (image/png, image/jpeg, etc.)"
    )
    created_at: IsoDatetime
    updated_at: IsoDatetime

    @field_validator("presigned_url", "thumbnail_url", mode="before")
    @classmethod
    def ensure_string_or_none(cls, v):
        """Ensure URLs are strings or None."""
        if v is None or isinstance(v, str):
            return v
        return str(v)


# ============================================================================
# ProjectImage Schemas
# ============================================================================


class ProjectImageBase(BaseModel):
    """Shared fields for project images."""

    name: str = Field(..., min_length=1, max_length=255, description="Image name")
    description: str | None = Field(None, description="Image description")
    image_type: Literal["reference", "template", "icon", "logo", "other"] = Field(
        ..., description="Type of image"
    )
    tags: list[str] | None = Field(
        None, max_length=50, description="Tags for categorization"
    )
    metadata: dict[str, Any] | None = Field(
        None, description="Additional metadata (purpose, detection settings, etc.)"
    )


class ProjectImageCreate(BaseModel):
    """Schema for creating a new project image."""

    name: str = Field(..., min_length=1, max_length=255, description="Image name")
    description: str | None = Field(None, description="Image description")
    image_type: Literal["reference", "template", "icon", "logo", "other"] = Field(
        "template", description="Type of image"
    )
    tags: list[str] | None = Field(
        None, max_length=50, description="Tags for categorization"
    )
    metadata: dict[str, Any] | None = Field(
        None, description="Additional metadata (purpose, detection settings, etc.)"
    )

    @field_validator("tags")
    @classmethod
    def validate_tags(cls, v):
        """Ensure tags are non-empty and reasonably short."""
        if v is None:
            return v

        if len(v) > 50:
            raise ValueError("Maximum 50 tags allowed")

        for tag in v:
            if not tag or len(tag.strip()) == 0:
                raise ValueError("Tags cannot be empty")
            if len(tag) > 100:
                raise ValueError("Tag length cannot exceed 100 characters")

        return v

    @field_validator("metadata")
    @classmethod
    def validate_metadata(cls, v):
        """Ensure metadata doesn't contain sensitive information."""
        if v is None:
            return v

        sensitive_keys = [
            "password",
            "token",
            "secret",
            "api_key",
            "apikey",
            "credentials",
        ]

        for key in v.keys():
            if any(sensitive in key.lower() for sensitive in sensitive_keys):
                raise ValueError(
                    f"Metadata key '{key}' appears to contain sensitive information"
                )

        return v


class ProjectImageUpdate(BaseModel):
    """Schema for updating a project image."""

    name: str | None = Field(None, min_length=1, max_length=255)
    description: str | None = None
    image_type: Literal["reference", "template", "icon", "logo", "other"] | None = None
    tags: list[str] | None = Field(None, max_length=50)
    metadata: dict[str, Any] | None = None

    @field_validator("tags")
    @classmethod
    def validate_tags(cls, v):
        """Ensure tags are non-empty and reasonably short."""
        if v is None:
            return v

        if len(v) > 50:
            raise ValueError("Maximum 50 tags allowed")

        for tag in v:
            if not tag or len(tag.strip()) == 0:
                raise ValueError("Tags cannot be empty")
            if len(tag) > 100:
                raise ValueError("Tag length cannot exceed 100 characters")

        return v

    @field_validator("metadata")
    @classmethod
    def validate_metadata(cls, v):
        """Ensure metadata doesn't contain sensitive information."""
        if v is None:
            return v

        sensitive_keys = [
            "password",
            "token",
            "secret",
            "api_key",
            "apikey",
            "credentials",
        ]

        for key in v.keys():
            if any(sensitive in key.lower() for sensitive in sensitive_keys):
                raise ValueError(
                    f"Metadata key '{key}' appears to contain sensitive information"
                )

        return v


class ProjectImageResponse(BaseORMSchema, ProjectImageBase):
    """Schema for project image response with full details."""

    id: UUID
    project_id: UUID
    storage_path: str = Field(..., description="S3/MinIO storage path")
    presigned_url: str | None = Field(
        None, description="Temporary presigned URL for downloading"
    )
    thumbnail_url: str | None = Field(
        None, description="Temporary presigned URL for thumbnail"
    )
    width: int = Field(..., gt=0, description="Image width in pixels")
    height: int = Field(..., gt=0, description="Image height in pixels")
    file_size: int = Field(..., ge=0, description="File size in bytes")
    content_type: str = Field(
        default="image/png", description="MIME type (image/png, image/jpeg, etc.)"
    )
    created_at: IsoDatetime
    updated_at: IsoDatetime

    @field_validator("presigned_url", "thumbnail_url", mode="before")
    @classmethod
    def ensure_string_or_none(cls, v):
        """Ensure URLs are strings or None."""
        if v is None or isinstance(v, str):
            return v
        return str(v)


# ============================================================================
# Paginated List Response Schemas
# ============================================================================


class ProjectScreenshotListResponse(BaseModel):
    """Paginated list of project screenshots."""

    screenshots: list[ProjectScreenshotResponse] = Field(
        default_factory=list, description="List of screenshots"
    )
    total: int = Field(..., ge=0, description="Total number of screenshots")
    limit: int = Field(..., ge=1, description="Number of items per page")
    offset: int = Field(..., ge=0, description="Offset for pagination")


class ProjectImageListResponse(BaseModel):
    """Paginated list of project images."""

    images: list[ProjectImageResponse] = Field(
        default_factory=list, description="List of images"
    )
    total: int = Field(..., ge=0, description="Total number of images")
    limit: int = Field(..., ge=1, description="Number of items per page")
    offset: int = Field(..., ge=0, description="Offset for pagination")


# ============================================================================
# Batch Operations
# ============================================================================


class BatchProjectScreenshotDelete(BaseModel):
    """Schema for batch deleting project screenshots."""

    screenshot_ids: list[UUID] = Field(
        ..., min_length=1, max_length=100, description="Screenshot IDs to delete"
    )


class BatchProjectImageDelete(BaseModel):
    """Schema for batch deleting project images."""

    image_ids: list[UUID] = Field(
        ..., min_length=1, max_length=100, description="Image IDs to delete"
    )


class BatchDeleteResponse(BaseModel):
    """Response for batch delete operations."""

    deleted_count: int = Field(..., ge=0, description="Number of items deleted")
    failed_ids: list[UUID] = Field(
        default_factory=list, description="IDs that failed to delete"
    )
    errors: list[str] = Field(default_factory=list, description="Error messages")
