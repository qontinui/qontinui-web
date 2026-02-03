"""Pydantic schemas for training data export endpoints.

These schemas define request/response models for exporting training data
to S3 and local filesystem.
"""

from pydantic import BaseModel, Field, field_validator


class ExtraFile(BaseModel):
    """Additional file to export alongside the main data."""

    data: str = Field(..., description="The file content as a string")
    filename: str = Field(..., description="The filename for the extra file")


class S3ExportRequest(BaseModel):
    """Request schema for S3 export endpoint."""

    data: str = Field(..., description="The main data content to export")
    filename: str = Field(..., description="The filename for the main data file")
    bucket: str = Field(..., description="S3 bucket name")
    prefix: str = Field(..., description="S3 key prefix (folder path)")
    region: str = Field(..., description="AWS region for the S3 bucket")
    extra: ExtraFile | None = Field(
        default=None, description="Optional extra file to export"
    )

    @field_validator("bucket")
    @classmethod
    def validate_bucket(cls, v: str) -> str:
        """Validate bucket name is non-empty and reasonable."""
        if not v or not v.strip():
            raise ValueError("Bucket name cannot be empty")
        # S3 bucket names must be 3-63 characters
        if len(v) < 3 or len(v) > 63:
            raise ValueError("Bucket name must be between 3 and 63 characters")
        return v.strip()

    @field_validator("filename")
    @classmethod
    def validate_filename(cls, v: str) -> str:
        """Validate filename is non-empty and safe."""
        if not v or not v.strip():
            raise ValueError("Filename cannot be empty")
        # Prevent path traversal
        if ".." in v or v.startswith("/") or v.startswith("\\"):
            raise ValueError("Invalid filename: path traversal not allowed")
        return v.strip()

    @field_validator("prefix")
    @classmethod
    def validate_prefix(cls, v: str) -> str:
        """Validate prefix is safe."""
        # Prevent path traversal
        if ".." in v:
            raise ValueError("Invalid prefix: path traversal not allowed")
        # Normalize prefix (remove leading/trailing slashes)
        return v.strip().strip("/")


class S3ExportResponse(BaseModel):
    """Response schema for S3 export endpoint."""

    url: str = Field(..., description="S3 URL of the exported file")
    filename: str = Field(..., description="The filename that was exported")
    extra_url: str | None = Field(
        default=None, description="S3 URL of the extra file if exported"
    )
    extra_filename: str | None = Field(
        default=None, description="Filename of the extra file if exported"
    )


class LocalExportRequest(BaseModel):
    """Request schema for local filesystem export endpoint."""

    data: str = Field(..., description="The main data content to export")
    filename: str = Field(..., description="The filename for the main data file")
    path: str = Field(..., description="Local directory path to export to")
    extra: ExtraFile | None = Field(
        default=None, description="Optional extra file to export"
    )

    @field_validator("filename")
    @classmethod
    def validate_filename(cls, v: str) -> str:
        """Validate filename is non-empty and safe."""
        if not v or not v.strip():
            raise ValueError("Filename cannot be empty")
        # Prevent path traversal
        if ".." in v or "/" in v or "\\" in v:
            raise ValueError("Invalid filename: must be a simple filename without path")
        return v.strip()

    @field_validator("path")
    @classmethod
    def validate_path(cls, v: str) -> str:
        """Validate path is non-empty."""
        if not v or not v.strip():
            raise ValueError("Path cannot be empty")
        return v.strip()


class LocalExportResponse(BaseModel):
    """Response schema for local filesystem export endpoint."""

    path: str = Field(..., description="Full path to the exported file")
    filename: str = Field(..., description="The filename that was exported")
    extra_path: str | None = Field(
        default=None, description="Full path to the extra file if exported"
    )
    extra_filename: str | None = Field(
        default=None, description="Filename of the extra file if exported"
    )
