"""
Session health statistics.

Monitors active session counts, remember-me adoption,
and session expiration metrics.
"""

from datetime import datetime, timedelta
from typing import Any

import structlog
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.session_activity import SessionActivity

logger = structlog.get_logger(__name__)


async def get_session_stats(db: AsyncSession) -> dict[str, Any]:
    """
    Get session statistics and adoption metrics.

    Args:
        db: Database session

    Returns:
        Dictionary with session metrics:
        - total_active_sessions: Number of active sessions
        - remember_me_sessions: Sessions with remember_me enabled
        - standard_sessions: Standard session count
        - remember_me_adoption_rate: Percentage of sessions using remember_me
        - avg_session_age_hours: Average age of active sessions
        - sessions_expiring_soon: Sessions expiring in next hour
    """
    now = datetime.utcnow()

    try:
        # Total active sessions
        result = await db.execute(
            select(func.count(SessionActivity.id)).where(
                SessionActivity.absolute_expiry_at > now
            )
        )
        total_active = result.scalar() or 0

        # Get session details for analysis
        result = await db.execute(
            select(
                SessionActivity.first_login_at,
                SessionActivity.absolute_expiry_at,
                SessionActivity.last_activity_at,
            ).where(SessionActivity.absolute_expiry_at > now)
        )
        sessions = result.all()

        # Calculate remember_me vs standard based on expiry duration
        # Remember me: 90 days, Standard: 30 days
        remember_me_count = 0
        standard_count = 0
        total_age_hours = 0.0

        for session in sessions:
            session_duration = (
                session.absolute_expiry_at - session.first_login_at
            ).total_seconds()
            session_age = (now - session.first_login_at).total_seconds() / 3600
            total_age_hours += session_age

            # Check if duration is closer to 90 days or 30 days
            if session_duration > (60 * 24 * 3600):  # > 60 days = remember_me
                remember_me_count += 1
            else:
                standard_count += 1

        # Calculate averages
        avg_session_age_hours = (
            round(total_age_hours / len(sessions), 2) if sessions else 0.0
        )
        remember_me_adoption_rate = (
            round((remember_me_count / total_active * 100), 2)
            if total_active > 0
            else 0.0
        )

        # Sessions expiring soon (within 1 hour)
        one_hour_ahead = now + timedelta(hours=1)
        result = await db.execute(
            select(func.count(SessionActivity.id)).where(
                and_(
                    SessionActivity.absolute_expiry_at > now,
                    SessionActivity.absolute_expiry_at <= one_hour_ahead,
                )
            )
        )
        expiring_soon = result.scalar() or 0

        # Sessions by activity (active in last hour)
        hour_ago = now - timedelta(hours=1)
        result = await db.execute(
            select(func.count(SessionActivity.id)).where(
                and_(
                    SessionActivity.absolute_expiry_at > now,
                    SessionActivity.last_activity_at >= hour_ago,
                )
            )
        )
        active_last_hour = result.scalar() or 0

        return {
            "total_active_sessions": total_active,
            "remember_me_sessions": remember_me_count,
            "standard_sessions": standard_count,
            "remember_me_adoption_rate": remember_me_adoption_rate,
            "avg_session_age_hours": avg_session_age_hours,
            "sessions_expiring_soon": expiring_soon,
            "sessions_active_last_hour": active_last_hour,
            "activity_rate": (
                round((active_last_hour / total_active * 100), 2)
                if total_active > 0
                else 0.0
            ),
        }

    except Exception as e:
        logger.error("session_stats_error", error=str(e))
        return {
            "total_active_sessions": 0,
            "remember_me_sessions": 0,
            "standard_sessions": 0,
            "remember_me_adoption_rate": 0.0,
            "avg_session_age_hours": 0.0,
            "sessions_expiring_soon": 0,
            "sessions_active_last_hour": 0,
            "activity_rate": 0.0,
            "error": str(e),
        }
