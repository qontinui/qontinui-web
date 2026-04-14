"""
Pydantic schemas for collaboration features.

Includes schemas for:
- Organizations and team members
- Invitations
- Project access control
- Locks, comments, and activity logs
"""

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import EmailStr, Field, field_validator

from app.schemas.base import BaseORMSchema, BaseSchema, IsoDatetime

# ============================================================================
# Organization Schemas
# ============================================================================


class OrganizationBase(BaseSchema):
    """Base organization schema with common fields."""

    name: str = Field(
        ..., min_length=1, max_length=255, description="Organization name"
    )
    description: str | None = Field(
        None, max_length=1000, description="Organization description"
    )


class OrganizationCreate(OrganizationBase):
    """Schema for creating a new organization."""

    slug: str | None = Field(
        None,
        min_length=3,
        max_length=63,
        pattern="^[a-z0-9][a-z0-9-]*[a-z0-9]$",
        description="URL-friendly organization identifier",
    )


class OrganizationUpdate(BaseSchema):
    """Schema for updating an organization."""

    name: str | None = Field(None, min_length=1, max_length=255)
    description: str | None = Field(None, max_length=1000)
    avatar_url: str | None = None
    settings: dict[str, Any] | None = None
    is_active: bool | None = None


class OrganizationResponse(OrganizationBase, BaseORMSchema):
    """Schema for organization response."""

    id: UUID
    slug: str
    owner_id: UUID
    avatar_url: str | None = None
    settings: dict[str, Any] = Field(default_factory=dict)
    is_active: bool
    created_at: IsoDatetime
    updated_at: IsoDatetime
    member_count: int | None = Field(None, description="Total number of members")


# ============================================================================
# Team Member Schemas
# ============================================================================


class TeamMemberBase(BaseSchema):
    """Base team member schema."""

    role: str = Field(..., description="Member role: owner, admin, member, viewer")


class TeamMemberCreate(TeamMemberBase):
    """Schema for adding a team member."""

    user_id: UUID = Field(..., description="ID of user to add")


class TeamMemberUpdate(BaseSchema):
    """Schema for updating team member."""

    role: str | None = Field(None, description="New role for member")
    permissions: dict[str, Any] | None = Field(None, description="Custom permissions")


class TeamMemberResponse(TeamMemberBase, BaseORMSchema):
    """Schema for team member response."""

    id: UUID
    organization_id: UUID
    user_id: UUID
    permissions: dict[str, Any] = Field(default_factory=dict)
    invited_by: UUID | None = None
    joined_at: IsoDatetime
    last_active_at: IsoDatetime | None = None

    # Populated from joined user data
    email: str | None = Field(None, description="Member email")
    username: str | None = Field(None, description="Member username")
    full_name: str | None = Field(None, description="Member full name")
    avatar_url: str | None = Field(None, description="Member avatar URL")


# ============================================================================
# Invitation Schemas
# ============================================================================


class InvitationBase(BaseSchema):
    """Base invitation schema."""

    email: EmailStr = Field(..., description="Email address to invite")
    role: str = Field(
        default="member", description="Role to assign: admin, member, viewer"
    )


class InvitationCreate(InvitationBase):
    """Schema for creating an invitation."""

    pass


class InvitationResponse(InvitationBase, BaseORMSchema):
    """Schema for invitation response."""

    id: UUID
    organization_id: UUID
    invited_by: UUID | None = None
    token: str
    expires_at: IsoDatetime
    accepted_at: IsoDatetime | None = None
    created_at: IsoDatetime
    is_expired: bool = Field(..., description="Whether invitation has expired")
    is_accepted: bool = Field(..., description="Whether invitation was accepted")

    # Populated from inviter data
    inviter_username: str | None = Field(None, description="Username of inviter")
    inviter_email: str | None = Field(None, description="Email of inviter")
    organization_name: str | None = Field(None, description="Organization name")


class InvitationAccept(BaseSchema):
    """Schema for accepting an invitation."""

    token: str = Field(..., description="Invitation token from email")


# ============================================================================
# Project Sharing Schemas
# ============================================================================


class ProjectShareBase(BaseSchema):
    """Base project sharing schema."""

    permission_level: str = Field(
        default="view", description="Permission level: view, comment, edit, admin"
    )


class ProjectShareRequest(ProjectShareBase):
    """Schema for sharing a project."""

    user_id: UUID | None = Field(None, description="User ID to share with")
    organization_id: UUID | None = Field(
        None, description="Organization ID to share with"
    )
    expires_at: datetime | None = Field(None, description="Optional expiration date")

    @field_validator("permission_level")
    @classmethod
    def validate_permission_level(cls, v: str) -> str:
        """Validate permission level."""
        allowed = ["view", "comment", "edit", "admin"]
        if v not in allowed:
            raise ValueError(f"Permission level must be one of: {', '.join(allowed)}")
        return v


class CollaboratorResponse(ProjectShareBase, BaseORMSchema):
    """Schema for project collaborator response."""

    id: UUID
    project_id: int
    user_id: UUID | None = None
    organization_id: UUID | None = None
    created_by: UUID | None = None
    expires_at: IsoDatetime | None = None
    created_at: IsoDatetime
    is_expired: bool = Field(..., description="Whether access has expired")

    # Populated from joined data
    username: str | None = Field(None, description="Collaborator username")
    email: str | None = Field(None, description="Collaborator email")
    full_name: str | None = Field(None, description="Collaborator full name")
    avatar_url: str | None = Field(None, description="Collaborator avatar URL")
    organization_name: str | None = Field(
        None, description="Organization name if org access"
    )


class ProjectShareUpdate(BaseSchema):
    """Schema for updating project sharing."""

    permission_level: str | None = Field(None, description="New permission level")
    expires_at: datetime | None = Field(None, description="New expiration date")


# ============================================================================
# Lock Schemas
# ============================================================================


class LockBase(BaseSchema):
    """Base lock schema."""

    resource_type: str = Field(
        ..., description="Type: workflow, state, image, transition, action, project"
    )
    resource_id: str = Field(..., description="ID of the resource to lock")


class LockRequest(LockBase):
    """Schema for acquiring a lock."""

    duration_minutes: int | None = Field(
        5, ge=1, le=30, description="Lock duration in minutes (1-30)"
    )
    metadata: dict[str, Any] | None = Field(None, description="Optional metadata")


class LockResponse(LockBase, BaseORMSchema):
    """Schema for lock response."""

    id: UUID
    project_id: int
    user_id: UUID
    acquired_at: IsoDatetime
    expires_at: IsoDatetime
    auto_release: bool
    metadata: dict[str, Any] | None = None
    is_expired: bool = Field(..., description="Whether lock has expired")

    # Populated from user data
    username: str | None = Field(None, description="Username of lock holder")
    email: str | None = Field(None, description="Email of lock holder")


class LockExtendRequest(BaseSchema):
    """Schema for extending a lock."""

    duration_minutes: int = Field(
        5, ge=1, le=30, description="Additional minutes to extend"
    )


# ============================================================================
# Comment Schemas
# ============================================================================


class CommentPosition(BaseSchema):
    """Schema for comment canvas position."""

    x: float = Field(..., description="X coordinate on canvas")
    y: float = Field(..., description="Y coordinate on canvas")


class CommentBase(BaseSchema):
    """Base comment schema."""

    content: str = Field(
        ..., min_length=1, max_length=5000, description="Comment content"
    )
    workflow_id: str | None = Field(None, description="Optional workflow ID")
    action_id: str | None = Field(None, description="Optional action/state ID")
    position: CommentPosition | None = Field(
        None, description="Canvas position for visual comments"
    )
    mentions: list[UUID] | None = Field(None, description="List of mentioned user IDs")


class CommentCreate(CommentBase):
    """Schema for creating a comment."""

    parent_comment_id: UUID | None = Field(
        None, description="Parent comment ID for threading"
    )


class CommentUpdate(BaseSchema):
    """Schema for updating a comment."""

    content: str | None = Field(None, min_length=1, max_length=5000)
    position: CommentPosition | None = None


class CommentResponse(CommentBase, BaseORMSchema):
    """Schema for comment response."""

    id: UUID
    project_id: int
    author_id: UUID
    parent_comment_id: UUID | None = None
    resolved: bool
    resolved_by: UUID | None = None
    resolved_at: IsoDatetime | None = None
    created_at: IsoDatetime
    updated_at: IsoDatetime
    metadata: dict[str, Any] | None = None

    # Populated from author data
    author_username: str | None = Field(None, description="Author username")
    author_email: str | None = Field(None, description="Author email")
    author_avatar_url: str | None = Field(None, description="Author avatar URL")

    # Reply information
    reply_count: int | None = Field(0, description="Number of replies")


class CommentResolveRequest(BaseSchema):
    """Schema for resolving/unresolving a comment."""

    resolved: bool = Field(..., description="True to resolve, False to unresolve")


# ============================================================================
# Activity Log Schemas
# ============================================================================


class ActivityLogResponse(BaseORMSchema):
    """Schema for activity log response."""

    id: UUID
    project_id: int
    user_id: UUID
    action_type: str = Field(
        ..., description="Type of action: created, modified, deleted, etc."
    )
    resource_type: str = Field(
        ..., description="Type of resource: workflow, state, image, etc."
    )
    resource_id: str
    resource_name: str | None = None
    changes: dict[str, Any] | None = None
    metadata: dict[str, Any] | None = None
    created_at: IsoDatetime

    # Populated from user data
    username: str | None = Field(None, description="Username of actor")
    email: str | None = Field(None, description="Email of actor")
    avatar_url: str | None = Field(None, description="Avatar URL of actor")


class ActivityFilterParams(BaseSchema):
    """Schema for filtering activity logs."""

    action_type: str | None = Field(None, description="Filter by action type")
    resource_type: str | None = Field(None, description="Filter by resource type")
    user_id: UUID | None = Field(None, description="Filter by user")
    start_date: datetime | None = Field(None, description="Start date for filtering")
    end_date: datetime | None = Field(None, description="End date for filtering")
    limit: int = Field(50, ge=1, le=100, description="Maximum number of results")
    offset: int = Field(0, ge=0, description="Offset for pagination")


# ============================================================================
# Organization Switching
# ============================================================================


class OrganizationSwitchRequest(BaseSchema):
    """Schema for switching current organization context."""

    organization_id: UUID | None = Field(
        None, description="Organization to switch to, null for personal"
    )


class OrganizationSwitchResponse(BaseSchema):
    """Schema for organization switch response."""

    current_organization_id: UUID | None = None
    success: bool = True
    message: str = "Organization context switched successfully"


# ============================================================================
# Organization Statistics
# ============================================================================


class OrganizationStatistics(BaseSchema):
    """Schema for organization statistics response."""

    member_count: int = Field(0, description="Total number of members")
    project_count: int = Field(0, description="Total number of projects")
    active_users_today: int = Field(
        0, description="Number of users active in last 24 hours"
    )
    total_workflows: int = Field(0, description="Total number of workflows")
