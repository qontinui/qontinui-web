"""
Pydantic schemas for notifications.

Includes schemas for:
- Notifications (in-app and email)
- Notification preferences
"""

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import Field

from app.schemas.base import BaseORMSchema, BaseSchema, IsoDatetime

# ============================================================================
# Notification Schemas
# ============================================================================


class NotificationBase(BaseSchema):
    """Base notification schema."""

    type: str = Field(
        ..., description="Notification type: mention, share, comment, reply, etc."
    )
    title: str = Field(
        ..., min_length=1, max_length=255, description="Notification title"
    )
    message: str = Field(..., min_length=1, description="Notification message")


class NotificationCreate(NotificationBase):
    """Schema for creating a notification (internal use)."""

    user_id: UUID = Field(..., description="Recipient user ID")
    project_id: int | None = Field(None, description="Related project ID")
    resource_type: str | None = Field(None, description="Type of resource")
    resource_id: str | None = Field(None, description="Resource ID")
    actor_id: UUID | None = Field(
        None, description="User who triggered the notification"
    )
    metadata: dict[str, Any] | None = Field(None, description="Additional metadata")


class NotificationResponse(NotificationBase, BaseORMSchema):
    """Schema for notification response."""

    id: UUID
    user_id: UUID
    project_id: int | None = None
    resource_type: str | None = None
    resource_id: str | None = None
    actor_id: UUID | None = None
    read: bool
    read_at: IsoDatetime | None = None
    metadata: dict[str, Any] | None = None
    created_at: IsoDatetime

    # Populated from actor data
    actor_username: str | None = Field(None, description="Username of actor")
    actor_email: str | None = Field(None, description="Email of actor")
    actor_avatar_url: str | None = Field(None, description="Avatar URL of actor")

    # Populated from project data
    project_name: str | None = Field(None, description="Project name if applicable")


class NotificationUpdate(BaseSchema):
    """Schema for updating a notification."""

    read: bool | None = Field(None, description="Mark as read/unread")


class NotificationFilterParams(BaseSchema):
    """Schema for filtering notifications."""

    type: str | None = Field(None, description="Filter by notification type")
    read: bool | None = Field(None, description="Filter by read status")
    project_id: int | None = Field(None, description="Filter by project")
    start_date: datetime | None = Field(None, description="Start date for filtering")
    end_date: datetime | None = Field(None, description="End date for filtering")
    limit: int = Field(50, ge=1, le=100, description="Maximum number of results")
    offset: int = Field(0, ge=0, description="Offset for pagination")


class UnreadCountResponse(BaseSchema):
    """Schema for unread notification count response."""

    count: int = Field(..., description="Number of unread notifications")
    by_type: dict[str, int] | None = Field(
        None, description="Count by notification type"
    )


class MarkAllReadResponse(BaseSchema):
    """Schema for mark all as read response."""

    marked_count: int = Field(..., description="Number of notifications marked as read")
    success: bool = True


# ============================================================================
# Notification Preferences Schemas
# ============================================================================


class NotificationPreferencesBase(BaseSchema):
    """Base notification preferences schema."""

    # Email preferences
    email_mentions: bool = Field(True, description="Email for mentions")
    email_comments: bool = Field(True, description="Email for comments")
    email_shares: bool = Field(True, description="Email for shares")
    email_replies: bool = Field(True, description="Email for replies")
    email_team_invites: bool = Field(True, description="Email for team invites")
    email_gate_action: bool = Field(
        True, description="Email for merge-gate actions on your PRs"
    )

    # In-app preferences
    in_app_mentions: bool = Field(True, description="In-app for mentions")
    in_app_comments: bool = Field(True, description="In-app for comments")
    in_app_shares: bool = Field(True, description="In-app for shares")
    in_app_replies: bool = Field(True, description="In-app for replies")
    in_app_team_invites: bool = Field(True, description="In-app for team invites")
    in_app_project_updates: bool = Field(True, description="In-app for project updates")
    in_app_gate_action: bool = Field(
        True, description="In-app for merge-gate actions on your PRs"
    )


class NotificationPreferencesUpdate(BaseSchema):
    """Schema for updating notification preferences."""

    # Email preferences
    email_mentions: bool | None = None
    email_comments: bool | None = None
    email_shares: bool | None = None
    email_replies: bool | None = None
    email_team_invites: bool | None = None
    email_gate_action: bool | None = None

    # In-app preferences
    in_app_mentions: bool | None = None
    in_app_comments: bool | None = None
    in_app_shares: bool | None = None
    in_app_replies: bool | None = None
    in_app_team_invites: bool | None = None
    in_app_project_updates: bool | None = None
    in_app_gate_action: bool | None = None


class NotificationPreferencesResponse(NotificationPreferencesBase, BaseORMSchema):
    """Schema for notification preferences response."""

    id: UUID
    user_id: UUID
    created_at: IsoDatetime
    updated_at: IsoDatetime
