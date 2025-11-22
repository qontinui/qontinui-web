from typing import Any
from uuid import UUID

from app.schemas.base import BaseORMSchema, BaseSchema, IsoDatetime


# ProjectVersion Schemas
class ProjectVersionBase(BaseSchema):
    """Base schema for project versions"""
    comment: str | None = None


class ProjectVersionCreate(ProjectVersionBase):
    """Schema for creating a new version snapshot"""
    snapshot: dict[str, Any]
    project_id: int
    version_number: int


class ProjectVersionResponse(ProjectVersionBase, BaseORMSchema):
    """Schema for version history response"""
    id: UUID
    project_id: int
    version_number: int
    snapshot: dict[str, Any]
    created_by: UUID | None
    created_at: IsoDatetime


class ProjectVersionListItem(BaseORMSchema):
    """Lightweight schema for version list (without full snapshot)"""
    id: UUID
    project_id: int
    version_number: int
    created_by: UUID | None
    created_at: IsoDatetime
    comment: str | None = None


class VersionComparisonResponse(BaseSchema):
    """Schema for comparing two versions"""
    version_from: int
    version_to: int
    created_at_from: IsoDatetime
    created_at_to: IsoDatetime
    changes: dict[str, Any]  # Diff between versions
    summary: str  # Human-readable summary


# EditCommand Schemas
class EditCommandBase(BaseSchema):
    """Base schema for edit commands"""
    command_type: str  # 'update', 'create', 'delete'
    entity_type: str  # 'workflow', 'state', 'action', 'project', etc.
    entity_id: str
    payload: dict[str, Any]


class EditCommandCreate(EditCommandBase):
    """Schema for creating an edit command"""
    project_id: int


class EditCommandResponse(EditCommandBase, BaseORMSchema):
    """Schema for edit command response"""
    id: UUID
    project_id: int
    user_id: UUID | None
    sequence_number: int
    applied_at: IsoDatetime


class EditCommandHistoryResponse(BaseSchema):
    """Schema for command history list"""
    commands: list[EditCommandResponse]
    total_count: int
    project_id: int


# Version Restore Schemas
class VersionRestoreRequest(BaseSchema):
    """Schema for restoring a version"""
    comment: str | None = None  # Optional comment for the restore action


class VersionRestoreResponse(BaseSchema):
    """Schema for version restore response"""
    success: bool
    new_version_number: int
    restored_from_version: int
    message: str
