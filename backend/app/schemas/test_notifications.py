"""
Test notification schemas for test run and deficiency notifications.

Provides Pydantic schemas for test-related notifications sent via
WebSocket, email, Slack, and generic webhooks.
"""

from datetime import datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, Field, HttpUrl


class TestRunNotificationBase(BaseModel):
    """Base schema for test run notifications."""

    test_run_id: UUID
    project_id: UUID
    workflow_id: str | None = None
    status: str
    started_at: datetime
    completed_at: datetime | None = None


class TestRunNotification(TestRunNotificationBase):
    """
    Notification sent when a test run completes.

    Includes summary statistics and links to detailed results.
    """

    # Aggregate statistics
    total_transitions: int = Field(default=0, ge=0)
    successful_transitions: int = Field(default=0, ge=0)
    failed_transitions: int = Field(default=0, ge=0)
    skipped_transitions: int = Field(default=0, ge=0)

    # Coverage metrics
    coverage_percentage: Decimal = Field(default=Decimal("0.00"), ge=0, le=100)
    unique_states_visited: int = Field(default=0, ge=0)
    unique_paths_found: int = Field(default=0, ge=0)

    # Deficiency summary
    deficiencies_found: int = Field(default=0, ge=0)
    critical_deficiencies: int = Field(default=0, ge=0)
    high_deficiencies: int = Field(default=0, ge=0)

    # Links
    dashboard_url: str | None = None
    report_url: str | None = None

    # Runtime info
    duration_seconds: int | None = Field(default=None, ge=0)
    error_summary: str | None = None

    class Config:
        from_attributes = True


class DeficiencyNotificationBase(BaseModel):
    """Base schema for deficiency notifications."""

    deficiency_id: UUID
    test_run_id: UUID
    project_id: UUID
    severity: str
    deficiency_type: str
    title: str


class DeficiencyNotification(DeficiencyNotificationBase):
    """
    Notification sent for critical or high-severity deficiencies.

    Sent immediately when discovered during test execution.
    """

    description: str
    screenshot_urls: list[str] = Field(default_factory=list)
    video_url: str | None = None
    reproducible: bool = True
    reproduction_rate: Decimal | None = Field(default=None, ge=0, le=100)

    # Context
    environment_info: dict = Field(default_factory=dict)
    workflow_id: str | None = None

    # Links
    deficiency_url: str | None = None
    test_run_url: str | None = None

    first_seen_at: datetime
    occurrence_count: int = Field(default=1, ge=1)

    class Config:
        from_attributes = True


class CoverageAlertNotificationBase(BaseModel):
    """Base schema for coverage drop alerts."""

    test_run_id: UUID
    project_id: UUID
    current_coverage: Decimal = Field(ge=0, le=100)
    previous_coverage: Decimal | None = Field(default=None, ge=0, le=100)
    threshold: Decimal = Field(ge=0, le=100)


class CoverageAlertNotification(CoverageAlertNotificationBase):
    """
    Notification sent when code coverage drops below threshold.

    Alerts team to potential regression in test coverage.
    """

    coverage_drop: Decimal | None = Field(default=None)
    workflow_id: str | None = None

    # Details
    states_covered: int = Field(default=0, ge=0)
    states_total: int = Field(default=0, ge=0)
    transitions_covered: int = Field(default=0, ge=0)
    transitions_total: int = Field(default=0, ge=0)

    # Links
    dashboard_url: str | None = None
    report_url: str | None = None

    class Config:
        from_attributes = True


class NotificationChannelConfig(BaseModel):
    """
    Configuration for a notification channel.

    Defines which events trigger notifications for a specific channel.
    """

    enabled: bool = True

    # WebSocket notifications (real-time dashboard updates)
    websocket_enabled: bool = True

    # Email notifications
    email_enabled: bool = False
    email_recipients: list[str] = Field(default_factory=list)

    # Slack notifications
    slack_enabled: bool = False
    slack_webhook_url: HttpUrl | None = None
    slack_channel: str | None = None

    # Generic webhook
    webhook_enabled: bool = False
    webhook_url: HttpUrl | None = None
    webhook_headers: dict[str, str] = Field(default_factory=dict)

    class Config:
        from_attributes = True


class TestNotificationPreferencesBase(BaseModel):
    """Base schema for test notification preferences."""

    project_id: UUID


class TestNotificationPreferencesCreate(TestNotificationPreferencesBase):
    """Schema for creating test notification preferences."""

    # Test run events
    notify_test_run_completed: bool = True
    notify_test_run_failed: bool = True

    # Deficiency events
    notify_critical_deficiency: bool = True
    notify_high_deficiency: bool = True
    notify_medium_deficiency: bool = False
    notify_low_deficiency: bool = False

    # Coverage events
    notify_coverage_drop: bool = True
    coverage_drop_threshold: Decimal = Field(default=Decimal("80.00"), ge=0, le=100)

    # Channel configurations
    websocket_config: NotificationChannelConfig = Field(
        default_factory=NotificationChannelConfig
    )
    email_config: NotificationChannelConfig = Field(
        default_factory=NotificationChannelConfig
    )
    slack_config: NotificationChannelConfig = Field(
        default_factory=NotificationChannelConfig
    )
    webhook_config: NotificationChannelConfig = Field(
        default_factory=NotificationChannelConfig
    )


class TestNotificationPreferencesUpdate(BaseModel):
    """Schema for updating test notification preferences."""

    # Test run events (all optional for partial updates)
    notify_test_run_completed: bool | None = None
    notify_test_run_failed: bool | None = None

    # Deficiency events
    notify_critical_deficiency: bool | None = None
    notify_high_deficiency: bool | None = None
    notify_medium_deficiency: bool | None = None
    notify_low_deficiency: bool | None = None

    # Coverage events
    notify_coverage_drop: bool | None = None
    coverage_drop_threshold: Decimal | None = Field(default=None, ge=0, le=100)

    # Channel configurations
    websocket_config: NotificationChannelConfig | None = None
    email_config: NotificationChannelConfig | None = None
    slack_config: NotificationChannelConfig | None = None
    webhook_config: NotificationChannelConfig | None = None


class TestNotificationPreferences(TestNotificationPreferencesBase):
    """Schema for test notification preferences."""

    id: UUID

    # Test run events
    notify_test_run_completed: bool
    notify_test_run_failed: bool

    # Deficiency events
    notify_critical_deficiency: bool
    notify_high_deficiency: bool
    notify_medium_deficiency: bool
    notify_low_deficiency: bool

    # Coverage events
    notify_coverage_drop: bool
    coverage_drop_threshold: Decimal

    # Channel configurations
    websocket_config: NotificationChannelConfig
    email_config: NotificationChannelConfig
    slack_config: NotificationChannelConfig
    webhook_config: NotificationChannelConfig

    # Audit
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
