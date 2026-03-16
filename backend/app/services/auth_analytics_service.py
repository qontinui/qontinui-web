"""
Analytics service for tracking authentication and user behavior events.

This service provides comprehensive analytics tracking including:
- Login events with remember_me tracking
- Device fingerprint validation
- Session lifecycle events
- User activity metrics
"""

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, cast
from uuid import UUID

import structlog
from sqlalchemy import and_, desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.analytics_event import AnalyticsEvent
from app.models.device_session import DeviceSession
from app.models.user import User

logger = structlog.get_logger(__name__)


@dataclass
class EventSummary:
    """Summary statistics for an event type."""

    event_name: str
    total_count: int
    last_7_days: int
    last_30_days: int
    unique_users: int
    last_occurrence: datetime | None


@dataclass
class UserActivitySummary:
    """User activity statistics."""

    user_id: UUID
    username: str
    email: str
    total_logins: int
    remember_me_logins: int
    last_login: datetime | None
    device_count: int
    subscription_tier: str


class AuthAnalyticsService:
    """Service for tracking and analyzing authentication events."""

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

    async def get_events(
        self,
        db: AsyncSession,
        event_name: str | None = None,
        user_id: UUID | None = None,
        start_date: datetime | None = None,
        end_date: datetime | None = None,
        limit: int = 100,
    ) -> list[AnalyticsEvent]:
        """
        Retrieve analytics events with optional filtering.

        Args:
            db: Database session
            event_name: Filter by event name (optional)
            user_id: Filter by user ID (optional)
            start_date: Filter events after this date (optional)
            end_date: Filter events before this date (optional)
            limit: Maximum number of events to return

        Returns:
            List of AnalyticsEvent objects
        """
        query = select(AnalyticsEvent)

        conditions = []
        if event_name:
            conditions.append(AnalyticsEvent.event_name == event_name)
        if user_id:
            conditions.append(AnalyticsEvent.user_id == user_id)
        if start_date:
            conditions.append(AnalyticsEvent.timestamp >= start_date)
        if end_date:
            conditions.append(AnalyticsEvent.timestamp <= end_date)

        if conditions:
            query = query.where(and_(*conditions))

        query = query.order_by(desc(AnalyticsEvent.timestamp)).limit(limit)

        result = await db.execute(query)
        return list(result.scalars().all())

    async def get_event_summary(
        self,
        db: AsyncSession,
        event_name: str,
    ) -> EventSummary:
        """
        Get summary statistics for a specific event type.

        Args:
            db: Database session
            event_name: Name of the event to summarize

        Returns:
            EventSummary with statistics
        """
        now = datetime.now(UTC)
        seven_days_ago = now - timedelta(days=7)
        thirty_days_ago = now - timedelta(days=30)

        # Total count
        result = await db.execute(
            select(func.count(AnalyticsEvent.id)).where(
                AnalyticsEvent.event_name == event_name
            )
        )
        total_count = result.scalar() or 0

        # Last 7 days count
        result = await db.execute(
            select(func.count(AnalyticsEvent.id)).where(
                and_(
                    AnalyticsEvent.event_name == event_name,
                    AnalyticsEvent.timestamp >= seven_days_ago,
                )
            )
        )
        last_7_days = result.scalar() or 0

        # Last 30 days count
        result = await db.execute(
            select(func.count(AnalyticsEvent.id)).where(
                and_(
                    AnalyticsEvent.event_name == event_name,
                    AnalyticsEvent.timestamp >= thirty_days_ago,
                )
            )
        )
        last_30_days = result.scalar() or 0

        # Unique users
        result = await db.execute(
            select(func.count(func.distinct(AnalyticsEvent.user_id))).where(
                and_(
                    AnalyticsEvent.event_name == event_name,
                    AnalyticsEvent.user_id.isnot(None),
                )
            )
        )
        unique_users = result.scalar() or 0

        # Last occurrence
        result = await db.execute(
            select(AnalyticsEvent.timestamp)
            .where(AnalyticsEvent.event_name == event_name)
            .order_by(desc(AnalyticsEvent.timestamp))
            .limit(1)
        )
        last_occurrence = cast(datetime | None, result.scalar())

        return EventSummary(
            event_name=event_name,
            total_count=total_count,
            last_7_days=last_7_days,
            last_30_days=last_30_days,
            unique_users=unique_users,
            last_occurrence=last_occurrence,
        )

    async def get_remember_me_adoption_rate(
        self,
        db: AsyncSession,
        days: int = 30,
    ) -> dict[str, Any]:
        """
        Calculate remember me adoption rate.

        Args:
            db: Database session
            days: Number of days to look back

        Returns:
            Dict with adoption rate statistics
        """
        start_date = datetime.now(UTC) - timedelta(days=days)

        # Total logins in period
        result = await db.execute(
            select(func.count(AnalyticsEvent.id)).where(
                and_(
                    AnalyticsEvent.event_name == "user_login",
                    AnalyticsEvent.timestamp >= start_date,
                )
            )
        )
        total_logins = result.scalar() or 0

        # Remember me logins in period
        result = await db.execute(
            select(func.count(AnalyticsEvent.id)).where(
                and_(
                    AnalyticsEvent.event_name == "user_login",
                    AnalyticsEvent.timestamp >= start_date,
                    AnalyticsEvent.properties["remember_me"].astext == "true",
                )
            )
        )
        remember_me_logins = result.scalar() or 0

        adoption_rate = (
            (remember_me_logins / total_logins * 100) if total_logins > 0 else 0.0
        )

        return {
            "period_days": days,
            "total_logins": total_logins,
            "remember_me_logins": remember_me_logins,
            "standard_logins": total_logins - remember_me_logins,
            "adoption_rate_percent": round(adoption_rate, 2),
        }

    async def get_active_sessions_count(
        self,
        db: AsyncSession,
    ) -> int:
        """
        Get count of currently active device sessions.

        Args:
            db: Database session

        Returns:
            Count of active device sessions
        """
        # Consider sessions active if last seen within last 7 days
        cutoff_date = datetime.now(UTC) - timedelta(days=7)

        result = await db.execute(
            select(func.count(DeviceSession.id)).where(
                DeviceSession.last_seen >= cutoff_date
            )
        )
        return result.scalar() or 0

    async def get_device_mismatch_count(
        self,
        db: AsyncSession,
        days: int = 30,
    ) -> int:
        """
        Get count of device fingerprint mismatch events.

        Args:
            db: Database session
            days: Number of days to look back

        Returns:
            Count of device mismatch events
        """
        start_date = datetime.now(UTC) - timedelta(days=days)

        result = await db.execute(
            select(func.count(AnalyticsEvent.id)).where(
                and_(
                    AnalyticsEvent.event_name == "device_fingerprint_mismatch",
                    AnalyticsEvent.timestamp >= start_date,
                )
            )
        )
        return result.scalar() or 0

    async def get_top_active_users(
        self,
        db: AsyncSession,
        days: int = 30,
        limit: int = 10,
    ) -> list[UserActivitySummary]:
        """
        Get top users by activity.

        Args:
            db: Database session
            days: Number of days to look back
            limit: Maximum number of users to return

        Returns:
            List of UserActivitySummary for most active users
        """
        start_date = datetime.now(UTC) - timedelta(days=days)

        # Get users with most login events in the period
        result = await db.execute(
            select(  # type: ignore[call-overload]
                User.id,
                User.username,
                User.email,
                User.login_count,
                User.remember_me_usage_count,
                User.last_login_at,
                User.subscription_tier,
                func.count(AnalyticsEvent.id).label("recent_logins"),
            )
            .join(AnalyticsEvent, User.id == AnalyticsEvent.user_id)
            .where(
                and_(
                    AnalyticsEvent.event_name == "user_login",
                    AnalyticsEvent.timestamp >= start_date,
                )
            )
            .group_by(
                User.id,
                User.username,
                User.email,
                User.login_count,
                User.remember_me_usage_count,
                User.last_login_at,
                User.subscription_tier,
            )
            .order_by(desc("recent_logins"))
            .limit(limit)
        )

        users_data = result.all()

        # Get device counts for each user
        summaries = []
        for user_data in users_data:
            result = await db.execute(
                select(func.count(DeviceSession.id)).where(
                    DeviceSession.user_id == user_data.id
                )
            )
            device_count = result.scalar() or 0

            summaries.append(
                UserActivitySummary(
                    user_id=user_data.id,
                    username=user_data.username,
                    email=user_data.email,
                    total_logins=user_data.login_count,
                    remember_me_logins=user_data.remember_me_usage_count,
                    last_login=user_data.last_login_at,
                    device_count=device_count,
                    subscription_tier=user_data.subscription_tier,
                )
            )

        return summaries

    async def get_comprehensive_summary(
        self,
        db: AsyncSession,
        days: int = 30,
    ) -> dict[str, Any]:
        """
        Get comprehensive analytics summary for admin dashboard.

        Args:
            db: Database session
            days: Number of days to look back for trends

        Returns:
            Dict with comprehensive analytics data
        """
        # Get event summaries for key events
        login_summary = await self.get_event_summary(db, "user_login")
        token_refresh_summary = await self.get_event_summary(db, "token_refresh")
        session_expired_summary = await self.get_event_summary(
            db, "remember_me_session_expired"
        )
        device_mismatch_summary = await self.get_event_summary(
            db, "device_fingerprint_mismatch"
        )

        # Get remember me adoption rate
        remember_me_stats = await self.get_remember_me_adoption_rate(db, days)

        # Get active sessions count
        active_sessions = await self.get_active_sessions_count(db)

        # Get top active users
        top_users = await self.get_top_active_users(db, days, limit=10)

        return {
            "period_days": days,
            "generated_at": datetime.now(UTC).isoformat(),
            "login_stats": {
                "total_logins_7_days": login_summary.last_7_days,
                "total_logins_30_days": login_summary.last_30_days,
                "unique_users": login_summary.unique_users,
                "last_login": (
                    login_summary.last_occurrence.isoformat()
                    if login_summary.last_occurrence
                    else None
                ),
            },
            "remember_me_stats": remember_me_stats,
            "session_stats": {
                "active_sessions_count": active_sessions,
                "token_refreshes_7_days": token_refresh_summary.last_7_days,
                "token_refreshes_30_days": token_refresh_summary.last_30_days,
                "expired_sessions_7_days": session_expired_summary.last_7_days,
                "expired_sessions_30_days": session_expired_summary.last_30_days,
            },
            "security_stats": {
                "device_mismatches_7_days": device_mismatch_summary.last_7_days,
                "device_mismatches_30_days": device_mismatch_summary.last_30_days,
            },
            "top_users": [
                {
                    "user_id": str(user.user_id),
                    "username": user.username,
                    "email": user.email,
                    "total_logins": user.total_logins,
                    "remember_me_logins": user.remember_me_logins,
                    "last_login": (
                        user.last_login.isoformat() if user.last_login else None
                    ),
                    "device_count": user.device_count,
                    "subscription_tier": user.subscription_tier,
                }
                for user in top_users
            ],
        }


# Create singleton instance
auth_analytics_service = AuthAnalyticsService()
