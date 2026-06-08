"""
Notification models for collaboration event notifications.

Includes:
- Notification: System notifications for collaboration events
- NotificationPreferences: User preferences for notification delivery
"""

from datetime import UTC, datetime
from enum import StrEnum

from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    DateTime,
    Enum,
    ForeignKey,
    String,
    Text,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class NotificationType(StrEnum):
    """Types of notifications."""

    MENTION = "mention"
    SHARE = "share"
    COMMENT = "comment"
    REPLY = "reply"
    LOCK_RELEASED = "lock_released"
    PROJECT_UPDATE = "project_update"
    TEAM_INVITE = "team_invite"
    ACCESS_GRANTED = "access_granted"
    ACCESS_REVOKED = "access_revoked"
    # Merge-gate escalation: a PR the user is responsible for was escalated
    # to specialist review by coord's merge gate (gate-action-notifications
    # T3). Defaults ON for both in-app and email — the author should hear
    # about their own gated PR by default — while still honouring an
    # explicit opt-out (see NotificationPreferences mappings below).
    GATE_ACTION = "gate_action"


class Notification(Base):
    """
    System notifications for collaboration events.

    Stores in-app notifications for various collaboration activities like
    mentions, shares, comments, and other project-related events.
    """

    __tablename__ = "notifications"
    __table_args__ = {"schema": "project"}

    id = Column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    user_id = Column(
        UUID(as_uuid=True),
        ForeignKey("auth.users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    type: Column[NotificationType] = Column(
        Enum(NotificationType), nullable=False, index=True
    )
    title = Column(String, nullable=False)
    message = Column(Text, nullable=False)
    project_id = Column(
        UUID(as_uuid=True),
        ForeignKey("project.projects.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    resource_type = Column(String, nullable=True)  # workflow, state, comment, etc.
    resource_id = Column(String, nullable=True)  # ID of the specific resource
    actor_id = Column(
        UUID(as_uuid=True),
        ForeignKey("auth.users.id", ondelete="SET NULL"),
        nullable=True,
    )  # Who triggered the notification
    read: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False, index=True
    )
    read_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    notification_metadata: Mapped[dict] = mapped_column(
        "metadata", JSON, nullable=True
    )  # Additional context (deep links, etc.)
    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        nullable=False,
        index=True,
    )

    # Relationships
    user = relationship("User", foreign_keys=[user_id], backref="notifications")
    actor = relationship(
        "User", foreign_keys=[actor_id], backref="triggered_notifications"
    )
    project = relationship("Project", backref="notifications")

    def mark_as_read(self) -> None:
        """Mark notification as read."""
        self.read = True
        self.read_at = datetime.now(UTC)

    def mark_as_unread(self) -> None:
        """Mark notification as unread."""
        self.read = False
        self.read_at = None


class NotificationPreferences(Base):
    """
    User preferences for notification delivery.

    Controls which notification types should trigger email or in-app notifications.
    """

    __tablename__ = "notification_preferences"
    __table_args__ = {"schema": "project"}

    id = Column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    user_id = Column(
        UUID(as_uuid=True),
        ForeignKey("auth.users.id", ondelete="CASCADE"),
        unique=True,
        nullable=False,
    )

    # Email notification preferences
    email_mentions = Column(Boolean, default=True, nullable=False)
    email_comments = Column(Boolean, default=True, nullable=False)
    email_shares = Column(Boolean, default=True, nullable=False)
    email_replies = Column(Boolean, default=True, nullable=False)
    email_team_invites = Column(Boolean, default=True, nullable=False)

    # In-app notification preferences
    in_app_mentions = Column(Boolean, default=True, nullable=False)
    in_app_comments = Column(Boolean, default=True, nullable=False)
    in_app_shares = Column(Boolean, default=True, nullable=False)
    in_app_replies = Column(Boolean, default=True, nullable=False)
    in_app_team_invites = Column(Boolean, default=True, nullable=False)
    in_app_project_updates = Column(Boolean, default=True, nullable=False)

    created_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False
    )
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
        nullable=False,
    )

    # Relationships
    user = relationship("User", backref="notification_preferences", uselist=False)

    @classmethod
    def create_default(cls, user_id):
        """Create default notification preferences for a user."""
        return cls(user_id=user_id)

    def should_send_email(self, notification_type: NotificationType) -> bool:
        """Check if email should be sent for a notification type."""
        mapping = {
            NotificationType.MENTION: self.email_mentions,
            NotificationType.COMMENT: self.email_comments,
            NotificationType.SHARE: self.email_shares,
            NotificationType.REPLY: self.email_replies,
            NotificationType.TEAM_INVITE: self.email_team_invites,
            # GATE_ACTION has no dedicated preference column (a column would
            # require a migration; the T3 design is metadata-only). It
            # therefore defaults ON for email — coord escalating the
            # author's own PR is high-signal and worth an email by default.
            NotificationType.GATE_ACTION: True,
        }
        # Email defaults OFF for unmapped types (conservative), but the
        # explicitly mapped GATE_ACTION above defaults ON.
        result = mapping.get(notification_type, False)
        return bool(result)

    def should_send_in_app(self, notification_type: NotificationType) -> bool:
        """Check if in-app notification should be sent for a notification type."""
        mapping = {
            NotificationType.MENTION: self.in_app_mentions,
            NotificationType.COMMENT: self.in_app_comments,
            NotificationType.SHARE: self.in_app_shares,
            NotificationType.REPLY: self.in_app_replies,
            NotificationType.TEAM_INVITE: self.in_app_team_invites,
            NotificationType.PROJECT_UPDATE: self.in_app_project_updates,
            # GATE_ACTION: no dedicated column (metadata-only T3 design, no
            # migration) — defaults ON, matching the unmapped-type default.
            NotificationType.GATE_ACTION: True,
        }
        # In-app defaults ON for unmapped types.
        result = mapping.get(notification_type, True)
        return bool(result)
