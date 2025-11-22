"""
Automation Session Cleanup Service

Provides cleanup utilities for automation sessions including:
- Orphaned session detection and cleanup
- Session timeout enforcement
- Automatic session abortion on disconnect
"""

from datetime import datetime, timedelta
from uuid import UUID

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.automation_session import AutomationSession

logger = structlog.get_logger(__name__)


async def cleanup_session_on_disconnect(
    db: AsyncSession,
    session_id: UUID | None,
    disconnect_reason: str = "websocket_disconnect",
) -> dict[str, any]:
    """
    Clean up automation session when WebSocket disconnects.

    Auto-aborts sessions that were active for more than 30 minutes without
    proper closure. This prevents orphaned sessions from accumulating costs.

    Args:
        db: Database session
        session_id: Session ID to cleanup (optional)
        disconnect_reason: Reason for disconnect (for logging)

    Returns:
        Dict with cleanup results
    """
    if not session_id:
        return {
            "status": "skipped",
            "reason": "no_session_id",
        }

    try:
        # Query the session
        query = select(AutomationSession).where(AutomationSession.id == session_id)
        result = await db.execute(query)
        session = result.scalar_one_or_none()

        if not session:
            logger.warning(
                "cleanup_session_not_found",
                session_id=str(session_id),
                disconnect_reason=disconnect_reason,
            )
            return {
                "status": "not_found",
                "session_id": str(session_id),
            }

        # Check if session is still active
        if session.status not in ("active",):
            logger.info(
                "cleanup_session_already_ended",
                session_id=str(session_id),
                status=session.status,
                disconnect_reason=disconnect_reason,
            )
            return {
                "status": "already_ended",
                "session_id": str(session_id),
                "session_status": session.status,
            }

        # Calculate session duration
        duration_minutes = (datetime.utcnow() - session.created_at).total_seconds() / 60

        # Auto-abort if active for more than 30 minutes
        if duration_minutes > 30:
            session.status = "aborted"
            session.ended_at = datetime.utcnow()
            await db.commit()

            logger.warning(
                "session_auto_aborted_on_disconnect",
                session_id=str(session_id),
                duration_minutes=round(duration_minutes, 2),
                disconnect_reason=disconnect_reason,
            )

            return {
                "status": "aborted",
                "session_id": str(session_id),
                "duration_minutes": round(duration_minutes, 2),
                "reason": "exceeded_30min_without_closure",
            }
        else:
            logger.info(
                "session_not_aborted_on_disconnect",
                session_id=str(session_id),
                duration_minutes=round(duration_minutes, 2),
                disconnect_reason=disconnect_reason,
                reason="duration_under_30min",
            )
            return {
                "status": "not_aborted",
                "session_id": str(session_id),
                "duration_minutes": round(duration_minutes, 2),
                "reason": "duration_under_30min",
            }

    except Exception as e:
        logger.exception(
            "cleanup_session_on_disconnect_failed",
            session_id=str(session_id) if session_id else None,
            error=str(e),
            error_type=type(e).__name__,
        )
        return {
            "status": "error",
            "session_id": str(session_id) if session_id else None,
            "error": str(e),
        }


async def check_session_timeout(
    db: AsyncSession,
    session_id: UUID,
) -> tuple[bool, dict[str, any]]:
    """
    Check if a session has exceeded its maximum duration.

    Args:
        db: Database session
        session_id: Session ID to check

    Returns:
        Tuple of (is_expired, session_info)
        - is_expired: True if session should be terminated
        - session_info: Dict with session details and expiry info
    """
    try:
        # Query the session
        query = select(AutomationSession).where(AutomationSession.id == session_id)
        result = await db.execute(query)
        session = result.scalar_one_or_none()

        if not session:
            return False, {
                "status": "not_found",
                "session_id": str(session_id),
            }

        # Check if session has expired
        if session.is_expired():
            duration_seconds = (datetime.utcnow() - session.created_at).total_seconds()

            logger.warning(
                "session_timeout_detected",
                session_id=str(session_id),
                duration_seconds=duration_seconds,
                max_duration_seconds=session.max_duration_seconds,
            )

            # Update session status
            session.status = "expired"
            session.ended_at = datetime.utcnow()
            await db.commit()

            return True, {
                "status": "expired",
                "session_id": str(session_id),
                "duration_seconds": duration_seconds,
                "max_duration_seconds": session.max_duration_seconds,
                "duration_hours": duration_seconds / 3600,
            }

        return False, {
            "status": "active",
            "session_id": str(session_id),
        }

    except Exception as e:
        logger.exception(
            "check_session_timeout_failed",
            session_id=str(session_id),
            error=str(e),
            error_type=type(e).__name__,
        )
        return False, {
            "status": "error",
            "session_id": str(session_id),
            "error": str(e),
        }
