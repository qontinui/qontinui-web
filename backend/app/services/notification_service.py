"""
Notification service for managing collaboration event notifications.

This module provides backward compatibility. Import from app.services.notifications instead.

All functionality has been refactored into:
- app.services.notifications.core - NotificationService
- app.services.notifications.preferences - Preference management
- app.services.notifications.channels - Channel delivery
"""

# Re-export everything from the new location for backward compatibility
from app.services.notifications.core import (NotificationService,
                                             notification_service)

__all__ = [
    "NotificationService",
    "notification_service",
]
