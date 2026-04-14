"""
Pydantic schemas for conflict resolution features.

Includes schemas for:
- ConflictLog: Merge conflict tracking and resolution
- ConflictChange: Individual field-level conflicts
"""

from typing import Any
from uuid import UUID

from app.schemas.base import BaseORMSchema, BaseSchema, IsoDatetime
from pydantic import Field, field_validator

# ============================================================================
# Conflict Change Schemas
# ============================================================================


class ConflictChange(BaseSchema):
    """Schema for a single field-level conflict."""

    field: str = Field(..., description="JSON path to the conflicting field")
    base_value: Any = Field(None, description="Original value before both edits")
    local_value: Any = Field(None, description="Local user's value")
    remote_value: Any = Field(None, description="Remote user's value")
    conflict_type: str = Field(
        ...,
        description="Type of conflict: modify_modify, modify_delete, delete_modify, add_add",
    )

    @field_validator("conflict_type")
    @classmethod
    def validate_conflict_type(cls, v: str) -> str:
        """Validate conflict type."""
        allowed = ["modify_modify", "modify_delete", "delete_modify", "add_add"]
        if v not in allowed:
            raise ValueError(f"Conflict type must be one of: {', '.join(allowed)}")
        return v


# ============================================================================
# Conflict Log Schemas
# ============================================================================


class ConflictLogBase(BaseSchema):
    """Base conflict log schema."""

    resource_type: str = Field(
        ..., description="Type of resource (workflow, state, etc.)"
    )
    resource_id: str = Field(..., description="ID of the conflicting resource")
    local_version: int = Field(..., description="Version number of local changes")
    remote_version: int = Field(..., description="Version number of remote changes")


class ConflictLogCreate(ConflictLogBase):
    """Schema for creating a conflict log."""

    local_user_id: UUID = Field(..., description="ID of user with local changes")
    remote_user_id: UUID = Field(..., description="ID of user with remote changes")
    base_data: dict[str, Any] | None = Field(None, description="Data before both edits")
    local_data: dict[str, Any] | None = Field(None, description="Local user's changes")
    remote_data: dict[str, Any] | None = Field(
        None, description="Remote user's changes"
    )
    metadata: dict[str, Any] | None = Field(None, description="Additional metadata")


class ConflictLogResponse(ConflictLogBase, BaseORMSchema):
    """Schema for conflict log response."""

    id: UUID
    local_user_id: UUID
    remote_user_id: UUID
    base_data: dict[str, Any] | None = None
    local_data: dict[str, Any] | None = None
    remote_data: dict[str, Any] | None = None
    changes: list[ConflictChange] | None = Field(
        None, description="Array of field-level conflicts"
    )
    detected_at: IsoDatetime
    resolved: bool
    resolved_at: IsoDatetime | None = None
    resolution_type: str | None = Field(
        None, description="Resolution type: local, remote, merge"
    )
    resolved_data: dict[str, Any] | None = Field(None, description="Final merged data")
    metadata: dict[str, Any] | None = None

    # Populated from joined user data
    local_user_username: str | None = Field(None, description="Local user's username")
    local_user_email: str | None = Field(None, description="Local user's email")
    local_user_avatar_url: str | None = Field(
        None, description="Local user's avatar URL"
    )
    remote_user_username: str | None = Field(None, description="Remote user's username")
    remote_user_email: str | None = Field(None, description="Remote user's email")
    remote_user_avatar_url: str | None = Field(
        None, description="Remote user's avatar URL"
    )


class ConflictResolveRequest(BaseSchema):
    """Schema for resolving a conflict."""

    resolution_type: str = Field(
        ..., description="Resolution type: local, remote, or merge"
    )
    merged_data: dict[str, Any] | None = Field(
        None, description="Final merged data (required for 'merge' resolution)"
    )

    @field_validator("resolution_type")
    @classmethod
    def validate_resolution_type(cls, v: str) -> str:
        """Validate resolution type."""
        allowed = ["local", "remote", "merge"]
        if v not in allowed:
            raise ValueError(f"Resolution type must be one of: {', '.join(allowed)}")
        return v


class ConflictListFilter(BaseSchema):
    """Schema for filtering conflict lists."""

    resource_type: str | None = Field(None, description="Filter by resource type")
    resource_id: str | None = Field(None, description="Filter by resource ID")
    user_id: UUID | None = Field(None, description="Filter by user involvement")
    resolved: bool | None = Field(None, description="Filter by resolved status")
    skip: int = Field(0, ge=0, description="Number of records to skip")
    limit: int = Field(50, ge=1, le=100, description="Maximum number of results")


# ============================================================================
# Conflict Summary Schemas
# ============================================================================


class ConflictSummary(BaseSchema):
    """Summary of conflicts for a project or resource."""

    total_conflicts: int = Field(..., description="Total number of conflicts")
    unresolved_conflicts: int = Field(..., description="Number of unresolved conflicts")
    resolved_conflicts: int = Field(..., description="Number of resolved conflicts")
    conflicts_by_type: dict[str, int] = Field(
        default_factory=dict, description="Count of conflicts by resource type"
    )
    recent_conflicts: list[ConflictLogResponse] = Field(
        default_factory=list, description="Most recent conflicts"
    )


# ============================================================================
# Annotation Conflict Detection Schemas
# ============================================================================


class AnnotationConflictCheckRequest(BaseSchema):
    """Request schema for checking annotation conflicts before saving."""

    project_id: str = Field(..., description="Project ID to check conflicts for")
    local_version_id: str | None = Field(
        None, description="Version ID of local changes (null for new annotations)"
    )
    local_element_count: int = Field(
        ..., ge=0, description="Number of annotation elements in local state"
    )
    local_elements_hash: str = Field(
        ...,
        description="MD5 hash of JSON-stringified elements for comparison",
        min_length=32,
        max_length=32,
    )
    local_updated_at: int = Field(
        ..., description="Timestamp (milliseconds) of local last update"
    )


class AnnotationDiffSummary(BaseSchema):
    """Summary of differences between local and remote annotation states."""

    added: int = Field(..., ge=0, description="Number of elements added remotely")
    removed: int = Field(..., ge=0, description="Number of elements removed remotely")
    modified: int = Field(..., ge=0, description="Number of elements modified remotely")


class AnnotationConflictCheckResponse(BaseSchema):
    """Response schema for annotation conflict check."""

    has_conflict: bool = Field(..., description="Whether a conflict exists")
    remote_version_id: str | None = Field(
        None, description="Version ID of remote state"
    )
    remote_element_count: int = Field(
        ..., ge=0, description="Number of annotation elements in remote state"
    )
    remote_updated_at: int = Field(
        ..., description="Timestamp (milliseconds) of remote last update"
    )
    conflict_type: str = Field(
        ...,
        description="Type of conflict: none, version_mismatch, concurrent_edit, element_difference",
    )
    diff_summary: AnnotationDiffSummary | None = Field(
        None, description="Summary of differences if conflict exists"
    )

    @field_validator("conflict_type")
    @classmethod
    def validate_conflict_type(cls, v: str) -> str:
        """Validate conflict type."""
        allowed = ["none", "version_mismatch", "concurrent_edit", "element_difference"]
        if v not in allowed:
            raise ValueError(f"Conflict type must be one of: {', '.join(allowed)}")
        return v
