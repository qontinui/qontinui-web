"""
Admin notification settings model.

Stores global settings for admin email notifications including:
- Which events trigger notifications (user signup, project creation)
- Email addresses to send notifications to
- Toggle for enabling/disabling notifications
"""

from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, String, text
from sqlalchemy.dialects.postgresql import UUID

from app.db.base import Base


class AdminNotificationSettings(Base):
    """
    Singleton model for admin notification settings.

    This table should have only one row that stores the global admin
    notification configuration. Use the class methods to get/update settings.
    """

    __tablename__ = "admin_notification_settings"

    id = Column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )

    # Email notification settings
    notification_email = Column(
        String,
        nullable=False,
        comment="Email address to send admin notifications to",
    )

    # Event toggles
    notify_on_user_signup = Column(
        Boolean,
        default=True,
        nullable=False,
        comment="Send notification when a new user signs up",
    )
    notify_on_project_created = Column(
        Boolean,
        default=True,
        nullable=False,
        comment="Send notification when a new project is created",
    )

    # Global enable/disable
    notifications_enabled = Column(
        Boolean,
        default=True,
        nullable=False,
        comment="Master toggle for all admin notifications",
    )

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )
