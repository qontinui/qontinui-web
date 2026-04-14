"""Database cleanup tasks for session and token management.

This module handles cleanup of database records including:
- Expired user sessions (SessionActivity)
- Old device sessions (DeviceSession)
- Token blacklist cleanup
"""

from datetime import timedelta
from typing import Any

from app.core.config import settings
from app.worker.tasks.cleanup_utils import (
    CleanupResult,
    TaskTimer,
    create_error_result,
    create_success_result,
    logger,
)
from qontinui_schemas.common import utc_now


async def cleanup_expired_sessions(ctx: dict[str, Any]) -> CleanupResult:
    """Clean up expired SessionActivity records.

    Deletes sessions where absolute_expiry_at is in the past.

    Args:
        ctx: ARQ context (contains redis, job_id, etc.)

    Returns:
        Dict with cleanup statistics
    """
    logger.info("cleanup_expired_sessions_started")

    with TaskTimer() as timer:
        try:
            from app.db.session import AsyncSessionLocal
            from app.models.session_activity import SessionActivity
            from sqlalchemy import delete

            async with AsyncSessionLocal() as db:
                # Delete sessions that have passed their absolute expiry
                now = utc_now()
                delete_stmt = delete(SessionActivity).where(
                    SessionActivity.absolute_expiry_at < now
                )
                result = await db.execute(delete_stmt)
                deleted_count = result.rowcount or 0  # type: ignore[attr-defined]

                await db.commit()

            logger.info(
                "cleanup_expired_sessions_completed",
                deleted_count=deleted_count,
                execution_time_seconds=round(timer.elapsed, 2),
            )

            return create_success_result(
                task_name="cleanup_expired_sessions",
                execution_time=timer.elapsed,
                deleted_count=deleted_count,
            )

        except Exception as e:
            logger.exception(
                "cleanup_expired_sessions_failed",
                error=str(e),
                error_type=type(e).__name__,
                execution_time_seconds=round(timer.elapsed, 2),
            )
            return create_error_result(
                task_name="cleanup_expired_sessions",
                error=e,
                execution_time=timer.elapsed,
            )


async def cleanup_expired_device_sessions(ctx: dict[str, Any]) -> CleanupResult:
    """Clean up old DeviceSession records not accessed in configured days.

    Args:
        ctx: ARQ context

    Returns:
        Dict with cleanup statistics
    """
    logger.info("cleanup_expired_device_sessions_started")

    with TaskTimer() as timer:
        try:
            from app.db.session import AsyncSessionLocal
            from app.models.device_session import DeviceSession
            from sqlalchemy import delete

            # Use configured cleanup days
            days_to_keep = settings.CLEANUP_SESSION_DAYS
            cutoff_date = utc_now() - timedelta(days=days_to_keep)

            async with AsyncSessionLocal() as db:
                # Delete device sessions not accessed since cutoff date
                delete_stmt = delete(DeviceSession).where(
                    DeviceSession.last_seen < cutoff_date
                )
                result = await db.execute(delete_stmt)
                deleted_count = result.rowcount or 0  # type: ignore[attr-defined]

                await db.commit()

            logger.info(
                "cleanup_expired_device_sessions_completed",
                deleted_count=deleted_count,
                days_to_keep=days_to_keep,
                execution_time_seconds=round(timer.elapsed, 2),
            )

            return create_success_result(
                task_name="cleanup_expired_device_sessions",
                execution_time=timer.elapsed,
                deleted_count=deleted_count,
                days_to_keep=days_to_keep,
            )

        except Exception as e:
            logger.exception(
                "cleanup_expired_device_sessions_failed",
                error=str(e),
                error_type=type(e).__name__,
                execution_time_seconds=round(timer.elapsed, 2),
            )
            return create_error_result(
                task_name="cleanup_expired_device_sessions",
                error=e,
                execution_time=timer.elapsed,
            )


async def cleanup_token_blacklist(ctx: dict[str, Any]) -> CleanupResult:
    """Clean up expired tokens from the blacklist.

    For Redis: This is automatic via TTL, returns 0.
    For in-memory: Manually removes expired tokens.

    Args:
        ctx: ARQ context

    Returns:
        Dict with cleanup statistics
    """
    logger.info("cleanup_token_blacklist_started")

    with TaskTimer() as timer:
        try:
            from app.services.auth.token_blacklist_service import (
                token_blacklist_service,
            )

            deleted_count = await token_blacklist_service.clean_expired_tokens()

            logger.info(
                "cleanup_token_blacklist_completed",
                deleted_count=deleted_count,
                execution_time_seconds=round(timer.elapsed, 2),
            )

            return create_success_result(
                task_name="cleanup_token_blacklist",
                execution_time=timer.elapsed,
                deleted_count=deleted_count,
                note=(
                    "Redis handles TTL automatically"
                    if settings.REDIS_ENABLED
                    else "In-memory cleanup"
                ),
            )

        except Exception as e:
            logger.exception(
                "cleanup_token_blacklist_failed",
                error=str(e),
                error_type=type(e).__name__,
                execution_time_seconds=round(timer.elapsed, 2),
            )
            return create_error_result(
                task_name="cleanup_token_blacklist",
                error=e,
                execution_time=timer.elapsed,
            )


# Export all database cleanup tasks
__all__ = [
    "cleanup_expired_sessions",
    "cleanup_expired_device_sessions",
    "cleanup_token_blacklist",
]
