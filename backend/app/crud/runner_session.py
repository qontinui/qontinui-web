"""
CRUD operations for runner sessions (the audit-log table for runner
WebSocket sessions).

The unified runner architecture (Phase 2) replaced the old
``runner_connections`` model with ``runner_sessions`` and a parent
``runners`` row that owns all of a runner's sessions over its
lifetime. This module owns the session-history CRUD and delegates
fleet-level CRUD (token + runner registration) to
:mod:`app.crud.runner_crud` via re-exports so legacy callers that
imported ``from app.crud import runner`` keep working until the
endpoint layer is rewritten in Phase 2B.
"""

from uuid import UUID

from qontinui_schemas.common import utc_now
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.crud.runner_crud import (
    create_runner_token,
    delete_runner,
    get_runner,
    get_runner_token,
    heartbeat_runner,
    list_runner_tokens,
    list_runners,
    register_runner,
    revoke_runner_token,
    validate_runner_token,
)
from app.models.runner_session import RunnerSession

__all__ = [
    # Runner token + fleet CRUD (re-exported from runner_crud)
    "create_runner_token",
    "validate_runner_token",
    "revoke_runner_token",
    "list_runner_tokens",
    "get_runner_token",
    "register_runner",
    "heartbeat_runner",
    "list_runners",
    "get_runner",
    "delete_runner",
    # Session history CRUD (defined below)
    "create_session_record",
    "close_session_record",
    "get_session_history",
    "get_active_sessions",
    "get_active_session_for_project",
    "close_orphaned_sessions",
    "get_session_by_session_id",
]


async def create_session_record(
    db: AsyncSession,
    *,
    runner_id: UUID,
    user_id: UUID,
    ip_address: str | None = None,
    project_id: UUID | None = None,
    session_id: str | None = None,
) -> RunnerSession:
    """Log the start of a runner WebSocket session.

    Phase 2B endpoint code is expected to call this from the WS connect
    handler immediately after upserting the parent ``runners`` row.

    Args:
        db: Active async session.
        runner_id: ID of the parent ``runners`` row this session belongs to.
        user_id: Owning user.
        ip_address: Optional client IP address.
        project_id: Optional project association.
        session_id: Optional WebSocket session ID for log correlation.

    Returns:
        The created :class:`RunnerSession` record.
    """
    record = RunnerSession(
        runner_id=runner_id,
        user_id=user_id,
        ip_address=ip_address,
        project_id=project_id,
        session_id=session_id,
    )

    db.add(record)
    await db.commit()
    await db.refresh(record)

    return record


async def close_session_record(
    db: AsyncSession,
    session_pk: int,
) -> RunnerSession | None:
    """Log the end of a runner WebSocket session.

    Stamps ``disconnected_at`` and computes ``duration_seconds``.

    Args:
        db: Active async session.
        session_pk: Primary key of the ``runner_sessions`` row.

    Returns:
        Updated :class:`RunnerSession`, or ``None`` if no row matches.
    """
    query = select(RunnerSession).where(RunnerSession.id == session_pk)
    result = await db.execute(query)
    record = result.scalar_one_or_none()

    if not record:
        return None

    record.disconnected_at = utc_now()
    record.calculate_duration()

    await db.commit()
    await db.refresh(record)

    return record


async def get_session_history(
    db: AsyncSession,
    user_id: UUID,
    *,
    runner_id: UUID | None = None,
    limit: int = 50,
    offset: int = 0,
) -> tuple[list[RunnerSession], int]:
    """Return paginated session history for a user, newest first.

    Args:
        db: Active async session.
        user_id: Owning user.
        runner_id: If supplied, filter to only sessions for that runner.
        limit: Max rows to return.
        offset: Rows to skip (for pagination).

    Returns:
        ``(sessions, total_count)``.
    """
    conditions = [RunnerSession.user_id == user_id]
    if runner_id is not None:
        conditions.append(RunnerSession.runner_id == runner_id)

    where_clause = and_(*conditions)

    count_query = select(func.count(RunnerSession.id)).where(where_clause)
    count_result = await db.execute(count_query)
    total = count_result.scalar_one()

    query = (
        select(RunnerSession)
        .where(where_clause)
        .order_by(RunnerSession.connected_at.desc())
        .limit(limit)
        .offset(offset)
    )
    result = await db.execute(query)
    sessions = list(result.scalars().all())

    return sessions, total


async def get_active_sessions(
    db: AsyncSession,
    user_id: UUID,
) -> list[RunnerSession]:
    """Return currently-open sessions for a user, newest first."""
    query = (
        select(RunnerSession)
        .where(
            and_(
                RunnerSession.user_id == user_id,
                RunnerSession.disconnected_at.is_(None),
            )
        )
        .order_by(RunnerSession.connected_at.desc())
    )
    result = await db.execute(query)
    return list(result.scalars().all())


async def get_active_session_for_project(
    db: AsyncSession,
    project_id: UUID,
) -> RunnerSession | None:
    """Return the currently-open session for a specific project, if any.

    Returns the most recent open session if multiple exist (shouldn't
    happen, but the caller is robust).
    """
    query = (
        select(RunnerSession)
        .where(
            and_(
                RunnerSession.project_id == project_id,
                RunnerSession.disconnected_at.is_(None),
            )
        )
        .order_by(RunnerSession.connected_at.desc())
    )
    result = await db.execute(query)
    return result.scalars().first()


async def close_orphaned_sessions(
    db: AsyncSession,
    user_id: UUID,
    exclude_session_id: int | None = None,
) -> list[int]:
    """Close any orphaned (still-open) sessions for a user.

    Used to clean up sessions that weren't properly closed on
    disconnect (e.g. network drop, runner crash).

    Args:
        db: Active async session.
        user_id: Owning user.
        exclude_session_id: Optional session pk to exclude (typically the
            session that just connected).

    Returns:
        List of session pks that were closed.
    """
    conditions = [
        RunnerSession.user_id == user_id,
        RunnerSession.disconnected_at.is_(None),
    ]

    if exclude_session_id is not None:
        conditions.append(RunnerSession.id != exclude_session_id)

    query = select(RunnerSession).where(and_(*conditions))
    result = await db.execute(query)
    orphaned = list(result.scalars().all())

    closed_ids: list[int] = []
    for record in orphaned:
        record.disconnected_at = utc_now()
        record.calculate_duration()
        closed_ids.append(record.id)

    if closed_ids:
        await db.commit()

    return closed_ids


async def get_session_by_session_id(
    db: AsyncSession,
    session_id: str,
) -> RunnerSession | None:
    """Look up a session by its WebSocket session_id correlation string."""
    query = select(RunnerSession).where(RunnerSession.session_id == session_id)
    result = await db.execute(query)
    return result.scalar_one_or_none()
