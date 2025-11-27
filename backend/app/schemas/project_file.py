"""
Schemas for project file management.

Pydantic models for file upload, management, and validation.
"""

from datetime import datetime

from pydantic import BaseModel, Field, validator

# ============================================================================
# Request Schemas
# ============================================================================


class FileUploadRequest(BaseModel):
    """Request to upload a file to project."""

    path: str = Field(
        ...,
        description="Relative path where file should be saved (e.g., 'scripts/detector.py')",
    )
    content: str = Field(..., description="File content (text)")
    overwrite: bool = Field(
        default=False, description="Allow overwriting existing file"
    )

    @validator("path")
    def validate_path(cls, v):
        """Validate file path."""
        # No absolute paths
        if v.startswith("/"):
            raise ValueError("Path must be relative")

        # No parent directory references
        if ".." in v:
            raise ValueError("Path cannot contain '..' (parent directory references)")

        # Must have valid extension
        allowed_extensions = {".py", ".txt", ".md", ".json", ".yaml", ".yml"}
        if not any(v.endswith(ext) for ext in allowed_extensions):
            raise ValueError(
                f"File must have one of these extensions: {', '.join(allowed_extensions)}"
            )

        return v

    @validator("content")
    def validate_content_size(cls, v):
        """Validate content size."""
        max_size = 1024 * 1024  # 1MB
        size_bytes = len(v.encode("utf-8"))

        if size_bytes > max_size:
            raise ValueError(
                f"File content exceeds maximum size of 1MB (got {size_bytes} bytes)"
            )

        return v


class FileUpdateRequest(BaseModel):
    """Request to update an existing file."""

    content: str = Field(..., description="New file content")

    @validator("content")
    def validate_content_size(cls, v):
        """Validate content size."""
        max_size = 1024 * 1024  # 1MB
        size_bytes = len(v.encode("utf-8"))

        if size_bytes > max_size:
            raise ValueError(
                f"File content exceeds maximum size of 1MB (got {size_bytes} bytes)"
            )

        return v


class FolderCreateRequest(BaseModel):
    """Request to create a folder."""

    path: str = Field(
        ...,
        description="Relative path for new folder (e.g., 'lib/utils')",
    )

    @validator("path")
    def validate_path(cls, v):
        """Validate folder path."""
        # No absolute paths
        if v.startswith("/"):
            raise ValueError("Path must be relative")

        # No parent directory references
        if ".." in v:
            raise ValueError("Path cannot contain '..' (parent directory references)")

        return v


# ============================================================================
# Response Schemas
# ============================================================================


class FileInfo(BaseModel):
    """Information about a file."""

    path: str = Field(..., description="Relative file path")
    name: str = Field(..., description="File name")
    size_bytes: int = Field(..., description="File size in bytes")
    extension: str = Field(..., description="File extension (e.g., '.py')")
    is_directory: bool = Field(default=False, description="True if this is a directory")
    created_at: datetime | None = Field(None, description="Creation timestamp")
    modified_at: datetime | None = Field(
        None, description="Last modification timestamp"
    )


class FileListResponse(BaseModel):
    """Response for file listing."""

    files: list[FileInfo] = Field(..., description="List of files")
    total_count: int = Field(..., description="Total number of files")
    total_size_bytes: int = Field(..., description="Total size of all files in bytes")


class FileContentResponse(BaseModel):
    """Response for file content retrieval."""

    path: str = Field(..., description="Relative file path")
    content: str = Field(..., description="File content")
    size_bytes: int = Field(..., description="File size in bytes")
    extension: str = Field(..., description="File extension")
    modified_at: datetime | None = Field(
        None, description="Last modification timestamp"
    )


class FileUploadResponse(BaseModel):
    """Response for file upload."""

    success: bool = Field(..., description="Upload success status")
    path: str = Field(..., description="Uploaded file path")
    size_bytes: int = Field(..., description="Uploaded file size")
    message: str = Field(..., description="Success message")


class FileDeleteResponse(BaseModel):
    """Response for file deletion."""

    success: bool = Field(..., description="Deletion success status")
    path: str = Field(..., description="Deleted file path")
    message: str = Field(..., description="Success message")


class FolderCreateResponse(BaseModel):
    """Response for folder creation."""

    success: bool = Field(..., description="Creation success status")
    path: str = Field(..., description="Created folder path")
    message: str = Field(..., description="Success message")


class ProjectLimitsResponse(BaseModel):
    """Response for project limits check."""

    within_limits: bool = Field(..., description="Whether project is within limits")
    size_bytes: int = Field(..., description="Current project size in bytes")
    size_limit_bytes: int = Field(..., description="Maximum allowed size in bytes")
    size_percentage: float = Field(..., description="Percentage of size limit used")
    file_count: int = Field(..., description="Current number of files")
    file_limit: int = Field(..., description="Maximum allowed number of files")
    file_percentage: float = Field(..., description="Percentage of file limit used")
