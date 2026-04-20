"""
Test notification service for managing test-related notifications.

This module provides backward compatibility. Import from app.services.notifications instead.

All functionality has been refactored into:
- app.services.notifications.test_notifications - TestNotificationService
- app.services.notifications.preferences - Preference management
- app.services.notifications.channels - Channel delivery
"""

# Re-export everything from the new location for backward compatibility
from app.services.notifications.test_notifications import (
    TestNotificationService,
    test_notification_service,
)

__all__ = [
    "TestNotificationService",
    "test_notification_service",
]
