"""
Notification services for managing in-app and email notifications.

Provides:
- NotificationService: Core notification service for collaboration events
"""

from app.services.notifications.core import NotificationService, notification_service

__all__ = [
    "NotificationService",
    "notification_service",
]
