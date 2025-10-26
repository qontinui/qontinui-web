"""Background cleanup tasks for removing expired sessions and old data."""

import time
from datetime import datetime, timedelta
from typing import Any

import structlog

from app.core.config import settings

logger = structlog.get_logger(__name__)


async def cleanup_expired_sessions(ctx: dict[str, Any]) -> dict[str, Any]:
    """
    Clean up expired SessionActivity records.

    Deletes sessions where absolute_expiry_at is in the past.

    Args:
        ctx: ARQ context (contains redis, job_id, etc.)

    Returns:
        Dict with cleanup statistics
    """
    start_time = time.time()
    logger.info("cleanup_expired_sessions_started")

    try:
        from sqlalchemy import delete

        from app.db.session import AsyncSessionLocal
        from app.models.session_activity import SessionActivity

        async with AsyncSessionLocal() as db:
            # Delete sessions that have passed their absolute expiry
            now = datetime.utcnow()
            delete_stmt = delete(SessionActivity).where(
                SessionActivity.absolute_expiry_at < now
            )
            result = await db.execute(delete_stmt)
            deleted_count = result.rowcount

            await db.commit()

        execution_time = time.time() - start_time

        logger.info(
            "cleanup_expired_sessions_completed",
            deleted_count=deleted_count,
            execution_time_seconds=round(execution_time, 2),
        )

        return {
            "status": "success",
            "task": "cleanup_expired_sessions",
            "deleted_count": deleted_count,
            "execution_time_seconds": round(execution_time, 2),
            "timestamp": datetime.utcnow().isoformat(),
        }

    except Exception as e:
        execution_time = time.time() - start_time
        logger.exception(
            "cleanup_expired_sessions_failed",
            error=str(e),
            error_type=type(e).__name__,
            execution_time_seconds=round(execution_time, 2),
        )
        return {
            "status": "error",
            "task": "cleanup_expired_sessions",
            "error": str(e),
            "execution_time_seconds": round(execution_time, 2),
            "timestamp": datetime.utcnow().isoformat(),
        }


async def cleanup_expired_device_sessions(ctx: dict[str, Any]) -> dict[str, Any]:
    """
    Clean up old DeviceSession records not accessed in 90 days.

    Args:
        ctx: ARQ context

    Returns:
        Dict with cleanup statistics
    """
    start_time = time.time()
    logger.info("cleanup_expired_device_sessions_started")

    try:
        from sqlalchemy import delete

        from app.db.session import AsyncSessionLocal
        from app.models.device_session import DeviceSession

        # Use configured cleanup days
        days_to_keep = settings.CLEANUP_SESSION_DAYS
        cutoff_date = datetime.utcnow() - timedelta(days=days_to_keep)

        async with AsyncSessionLocal() as db:
            # Delete device sessions not accessed since cutoff date
            delete_stmt = delete(DeviceSession).where(
                DeviceSession.last_seen < cutoff_date
            )
            result = await db.execute(delete_stmt)
            deleted_count = result.rowcount

            await db.commit()

        execution_time = time.time() - start_time

        logger.info(
            "cleanup_expired_device_sessions_completed",
            deleted_count=deleted_count,
            days_to_keep=days_to_keep,
            execution_time_seconds=round(execution_time, 2),
        )

        return {
            "status": "success",
            "task": "cleanup_expired_device_sessions",
            "deleted_count": deleted_count,
            "days_to_keep": days_to_keep,
            "execution_time_seconds": round(execution_time, 2),
            "timestamp": datetime.utcnow().isoformat(),
        }

    except Exception as e:
        execution_time = time.time() - start_time
        logger.exception(
            "cleanup_expired_device_sessions_failed",
            error=str(e),
            error_type=type(e).__name__,
            execution_time_seconds=round(execution_time, 2),
        )
        return {
            "status": "error",
            "task": "cleanup_expired_device_sessions",
            "error": str(e),
            "execution_time_seconds": round(execution_time, 2),
            "timestamp": datetime.utcnow().isoformat(),
        }


async def cleanup_old_analytics_events(ctx: dict[str, Any]) -> dict[str, Any]:
    """
    Clean up old analytics events older than configured days.

    Note: Since AnalyticsEvent model doesn't exist yet, this is a placeholder
    that will return success with 0 deletions. Update this function when the
    AnalyticsEvent model is implemented.

    Args:
        ctx: ARQ context

    Returns:
        Dict with cleanup statistics
    """
    start_time = time.time()
    logger.info("cleanup_old_analytics_events_started")

    try:
        # TODO: Implement when AnalyticsEvent model exists
        # from sqlalchemy import delete
        # from app.models.analytics_event import AnalyticsEvent
        #
        # days_to_keep = settings.CLEANUP_ANALYTICS_DAYS
        # cutoff_date = datetime.utcnow() - timedelta(days=days_to_keep)
        #
        # async with AsyncSessionLocal() as db:
        #     delete_stmt = delete(AnalyticsEvent).where(
        #         AnalyticsEvent.created_at < cutoff_date
        #     )
        #     result = await db.execute(delete_stmt)
        #     deleted_count = result.rowcount
        #     await db.commit()

        deleted_count = 0
        execution_time = time.time() - start_time

        logger.info(
            "cleanup_old_analytics_events_completed",
            deleted_count=deleted_count,
            note="AnalyticsEvent model not yet implemented",
            execution_time_seconds=round(execution_time, 2),
        )

        return {
            "status": "success",
            "task": "cleanup_old_analytics_events",
            "deleted_count": deleted_count,
            "note": "AnalyticsEvent model not yet implemented",
            "execution_time_seconds": round(execution_time, 2),
            "timestamp": datetime.utcnow().isoformat(),
        }

    except Exception as e:
        execution_time = time.time() - start_time
        logger.exception(
            "cleanup_old_analytics_events_failed",
            error=str(e),
            error_type=type(e).__name__,
            execution_time_seconds=round(execution_time, 2),
        )
        return {
            "status": "error",
            "task": "cleanup_old_analytics_events",
            "error": str(e),
            "execution_time_seconds": round(execution_time, 2),
            "timestamp": datetime.utcnow().isoformat(),
        }


async def cleanup_token_blacklist(ctx: dict[str, Any]) -> dict[str, Any]:
    """
    Clean up expired tokens from the blacklist.

    For Redis: This is automatic via TTL, returns 0.
    For in-memory: Manually removes expired tokens.

    Args:
        ctx: ARQ context

    Returns:
        Dict with cleanup statistics
    """
    start_time = time.time()
    logger.info("cleanup_token_blacklist_started")

    try:
        from app.services.auth.token_blacklist_service import token_blacklist_service

        deleted_count = await token_blacklist_service.clean_expired_tokens()
        execution_time = time.time() - start_time

        logger.info(
            "cleanup_token_blacklist_completed",
            deleted_count=deleted_count,
            execution_time_seconds=round(execution_time, 2),
        )

        return {
            "status": "success",
            "task": "cleanup_token_blacklist",
            "deleted_count": deleted_count,
            "note": "Redis handles TTL automatically"
            if settings.REDIS_ENABLED
            else "In-memory cleanup",
            "execution_time_seconds": round(execution_time, 2),
            "timestamp": datetime.utcnow().isoformat(),
        }

    except Exception as e:
        execution_time = time.time() - start_time
        logger.exception(
            "cleanup_token_blacklist_failed",
            error=str(e),
            error_type=type(e).__name__,
            execution_time_seconds=round(execution_time, 2),
        )
        return {
            "status": "error",
            "task": "cleanup_token_blacklist",
            "error": str(e),
            "execution_time_seconds": round(execution_time, 2),
            "timestamp": datetime.utcnow().isoformat(),
        }


# Export all cleanup task functions
__all__ = [
    "cleanup_expired_sessions",
    "cleanup_expired_device_sessions",
    "cleanup_old_analytics_events",
    "cleanup_token_blacklist",
]
