"""
Notification services for managing in-app, email, and multi-channel notifications.

Provides:
- NotificationService: Core notification service for collaboration events
- TestNotificationService: Test-specific notifications with multi-channel delivery
"""

from app.services.notifications.core import (NotificationService,
                                             notification_service)
from app.services.notifications.test_notifications import (
    TestNotificationService, test_notification_service)

__all__ = [
    # Core notification service
    "NotificationService",
    "notification_service",
    # Test notification service
    "TestNotificationService",
    "test_notification_service",
]
