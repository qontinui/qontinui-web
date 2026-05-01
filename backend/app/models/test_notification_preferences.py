"""
Test notification preferences model for project-level notification settings.

Manages notification delivery preferences for test runs, deficiencies,
and coverage alerts across multiple channels (WebSocket, email, Slack, webhooks).
"""

from datetime import UTC, datetime
from decimal import Decimal
from uuid import UUID, uuid4

from sqlalchemy import DateTime, ForeignKey, Numeric, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class TestNotificationPreferences(Base):
    """
    Project-level test notification preferences.

    Manages which test events trigger notifications and which channels
    to use for delivery (WebSocket, email, Slack, generic webhooks).
    """

    __tablename__ = "test_notification_preferences"
    __table_args__ = {"schema": "project"}

    # Primary key
    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
        server_default=text("gen_random_uuid()"),
    )

    # Foreign key
    project_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("project.projects.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
    )

    # Test run event preferences
    notify_test_run_completed: Mapped[bool] = mapped_column(
        nullable=False,
        default=True,
        comment="Send notification when test run completes successfully",
    )

    notify_test_run_failed: Mapped[bool] = mapped_column(
        nullable=False,
        default=True,
        comment="Send notification when test run fails or times out",
    )

    # Deficiency event preferences
    notify_critical_deficiency: Mapped[bool] = mapped_column(
        nullable=False,
        default=True,
        comment="Send immediate notification for critical deficiencies",
    )

    notify_high_deficiency: Mapped[bool] = mapped_column(
        nullable=False,
        default=True,
        comment="Send immediate notification for high severity deficiencies",
    )

    notify_medium_deficiency: Mapped[bool] = mapped_column(
        nullable=False,
        default=False,
        comment="Send notification for medium severity deficiencies",
    )

    notify_low_deficiency: Mapped[bool] = mapped_column(
        nullable=False,
        default=False,
        comment="Send notification for low severity deficiencies",
    )

    # Coverage event preferences
    notify_coverage_drop: Mapped[bool] = mapped_column(
        nullable=False,
        default=True,
        comment="Alert when coverage drops below threshold",
    )

    coverage_drop_threshold: Mapped[Decimal] = mapped_column(
        Numeric(5, 2),
        nullable=False,
        default=Decimal("80.00"),
        comment="Coverage percentage threshold (0-100)",
    )

    # Channel configurations (stored as JSONB for flexibility)
    websocket_config: Mapped[dict] = mapped_column(
        JSONB,
        nullable=False,
        default=dict,
        comment="WebSocket notification configuration",
    )

    email_config: Mapped[dict] = mapped_column(
        JSONB,
        nullable=False,
        default=dict,
        comment="Email notification configuration",
    )

    slack_config: Mapped[dict] = mapped_column(
        JSONB,
        nullable=False,
        default=dict,
        comment="Slack webhook configuration",
    )

    webhook_config: Mapped[dict] = mapped_column(
        JSONB,
        nullable=False,
        default=dict,
        comment="Generic webhook configuration",
    )

    # Audit timestamps
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(UTC)
    )

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
    )

    # Relationships
    project = relationship("Project", back_populates="test_notification_preferences")

    @classmethod
    def create_default(cls, project_id: UUID) -> "TestNotificationPreferences":
        """
        Create default test notification preferences for a project.

        Args:
            project_id: ID of the project

        Returns:
            TestNotificationPreferences with sensible defaults
        """
        return cls(
            project_id=project_id,
            notify_test_run_completed=True,
            notify_test_run_failed=True,
            notify_critical_deficiency=True,
            notify_high_deficiency=True,
            notify_medium_deficiency=False,
            notify_low_deficiency=False,
            notify_coverage_drop=True,
            coverage_drop_threshold=Decimal("80.00"),
            websocket_config={
                "enabled": True,
                "websocket_enabled": True,
            },
            email_config={
                "enabled": False,
                "email_enabled": False,
                "email_recipients": [],
            },
            slack_config={
                "enabled": False,
                "slack_enabled": False,
                "slack_webhook_url": None,
                "slack_channel": None,
            },
            webhook_config={
                "enabled": False,
                "webhook_enabled": False,
                "webhook_url": None,
                "webhook_headers": {},
            },
        )

    def should_notify_test_run(self, status: str) -> bool:
        """
        Check if notification should be sent for a test run.

        Args:
            status: Test run status (completed, failed, etc.)

        Returns:
            True if notification should be sent
        """
        if status in ("completed",):
            return self.notify_test_run_completed
        elif status in ("failed", "timeout", "cancelled"):
            return self.notify_test_run_failed
        return False

    def should_notify_deficiency(self, severity: str) -> bool:
        """
        Check if notification should be sent for a deficiency.

        Args:
            severity: Deficiency severity (critical, high, medium, low, info)

        Returns:
            True if notification should be sent
        """
        severity_map = {
            "critical": self.notify_critical_deficiency,
            "high": self.notify_high_deficiency,
            "medium": self.notify_medium_deficiency,
            "low": self.notify_low_deficiency,
            "info": False,
        }
        return severity_map.get(severity.lower(), False)

    def should_notify_coverage_drop(self, coverage: Decimal) -> bool:
        """
        Check if notification should be sent for coverage drop.

        Args:
            coverage: Current coverage percentage

        Returns:
            True if notification should be sent
        """
        return self.notify_coverage_drop and coverage < self.coverage_drop_threshold

    def is_channel_enabled(self, channel: str) -> bool:
        """
        Check if a notification channel is enabled.

        Args:
            channel: Channel name (websocket, email, slack, webhook)

        Returns:
            True if channel is enabled
        """
        config_map = {
            "websocket": self.websocket_config,
            "email": self.email_config,
            "slack": self.slack_config,
            "webhook": self.webhook_config,
        }
        config = config_map.get(channel.lower(), {})
        result = config.get("enabled", False)
        return bool(result)

    def __repr__(self) -> str:
        return (
            f"<TestNotificationPreferences(id={self.id}, project_id={self.project_id})>"
        )
