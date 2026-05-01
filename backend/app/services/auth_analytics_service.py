"""
Analytics service for tracking authentication and user behavior events.

Single-tenant write path — records auth events
(login, token refresh, password change, device fingerprint mismatch,
remember-me session expiry) into `analytics_event`. Cross-user aggregator
methods (event summaries, remember-me adoption rate, active-sessions count,
device-mismatch count, top active users, comprehensive admin dashboard
summary) live in cloud-control at
`qontinui_cloud_control/services/auth_analytics_aggregator.py` —
those are admin-dashboard read paths consumed only by the cloud-control
`admin/analytics` route, not by OSS-only deploys.
"""

from datetime import UTC, datetime
from typing import Any
from uuid import UUID

import structlog
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.analytics_event import AnalyticsEvent

logger = structlog.get_logger(__name__)


class AuthAnalyticsService:
    """Service for tracking authentication events (write path only)."""

    async def track_event(
        self,
        db: AsyncSession,
        event_name: str,
        user_id: UUID | None = None,
        properties: dict[str, Any] | None = None,
    ) -> AnalyticsEvent:
        """
        Track an analytics event.

        Args:
            db: Database session
            event_name: Name of the event (e.g., 'user_login', 'token_refresh')
            user_id: User ID associated with the event (optional)
            properties: Additional event properties (optional)

        Returns:
            The created AnalyticsEvent
        """
        event = AnalyticsEvent(
            event_name=event_name,
            user_id=user_id,
            properties=properties or {},
            timestamp=datetime.now(UTC),
        )

        db.add(event)
        await db.commit()
        await db.refresh(event)

        logger.info(
            "analytics_event_tracked",
            event_name=event_name,
            user_id=str(user_id) if user_id else None,
            properties=properties,
        )

        return event


# Create singleton instance
auth_analytics_service = AuthAnalyticsService()
