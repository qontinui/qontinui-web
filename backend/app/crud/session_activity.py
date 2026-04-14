"""
CRUD operations for SessionActivity model.
"""

from datetime import UTC, datetime, timedelta
from uuid import UUID

from app.core.config import settings
from app.models.session_activity import SessionActivity
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession


async def create_session_activity(
    db: AsyncSession,
    user_id: UUID,
    jti: str,
    first_login_at: datetime | None = None,
) -> SessionActivity:
    """
    Create a new session activity record.

    Args:
        db: Database session
        user_id: User ID
        jti: JWT ID from refresh token
        first_login_at: Optional first login timestamp (defaults to now)

    Returns:
        Created SessionActivity instance
    """
    now = datetime.now(UTC)
    first_login = first_login_at or now
    if first_login.tzinfo is None:
        first_login = first_login.replace(tzinfo=UTC)

    # Calculate absolute expiry based on MAX_SESSION_DAYS
    absolute_expiry = first_login + timedelta(days=settings.MAX_SESSION_DAYS)

    session_activity = SessionActivity(
        user_id=user_id,
        jti=jti,
        first_login_at=first_login,
        last_activity_at=now,
        absolute_expiry_at=absolute_expiry,
    )

    db.add(session_activity)
    await db.commit()
    await db.refresh(session_activity)

    return session_activity


async def get_session_by_jti(db: AsyncSession, jti: str) -> SessionActivity | None:
    """
    Get session activity by JWT ID.

    Args:
        db: Database session
        jti: JWT ID from refresh token

    Returns:
        SessionActivity instance or None if not found
    """
    result = await db.execute(select(SessionActivity).where(SessionActivity.jti == jti))
    return result.scalar_one_or_none()


async def update_last_activity(db: AsyncSession, jti: str) -> SessionActivity | None:
    """
    Update the last activity timestamp for a session.

    Args:
        db: Database session
        jti: JWT ID from refresh token

    Returns:
        Updated SessionActivity instance or None if not found
    """
    session_activity = await get_session_by_jti(db, jti)
    if not session_activity:
        return None

    session_activity.last_activity_at = datetime.now(UTC)
    await db.commit()
    await db.refresh(session_activity)

    return session_activity


async def is_session_expired(db: AsyncSession, jti: str) -> bool:
    """
    Check if a session has exceeded its absolute maximum duration.

    Args:
        db: Database session
        jti: JWT ID from refresh token

    Returns:
        True if session expired, False otherwise
    """
    session_activity = await get_session_by_jti(db, jti)
    if not session_activity:
        return True

    expiry = session_activity.absolute_expiry_at
    if expiry.tzinfo is None:
        expiry = expiry.replace(tzinfo=UTC)
    return datetime.now(UTC) > expiry


async def delete_session(db: AsyncSession, jti: str) -> bool:
    """
    Delete a session activity record (for logout).

    Args:
        db: Database session
        jti: JWT ID from refresh token

    Returns:
        True if deleted, False if not found
    """
    session_activity = await get_session_by_jti(db, jti)
    if not session_activity:
        return False

    await db.delete(session_activity)
    await db.commit()

    return True


async def delete_expired_sessions(db: AsyncSession) -> int:
    """
    Delete all expired sessions (cleanup task).

    Returns:
        Number of sessions deleted
    """
    now = datetime.now(UTC)
    result = await db.execute(
        select(SessionActivity).where(SessionActivity.absolute_expiry_at < now)
    )
    expired_sessions = result.scalars().all()

    for session in expired_sessions:
        await db.delete(session)

    await db.commit()

    return len(expired_sessions)


async def get_user_sessions(db: AsyncSession, user_id: UUID) -> list[SessionActivity]:
    """
    Get all active sessions for a user.

    Args:
        db: Database session
        user_id: User ID

    Returns:
        List of SessionActivity instances
    """
    result = await db.execute(
        select(SessionActivity)
        .where(SessionActivity.user_id == user_id)
        .where(SessionActivity.absolute_expiry_at > datetime.now(UTC))
        .order_by(SessionActivity.last_activity_at.desc())
    )
    return list(result.scalars().all())
