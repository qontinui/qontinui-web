"""CRUD operations for UI Bridge exploration sessions."""

from collections.abc import Sequence
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.ui_bridge_state import UIBridgeExplorationSession
from app.schemas.ui_bridge_state import (
    ExplorationSessionAppendRenders,
    ExplorationSessionCreate,
    ExplorationSessionUpdate,
)

_TERMINAL_STATUSES = ("completed", "failed", "cancelled")


async def list_sessions(
    db: AsyncSession,
    project_id: UUID,
    *,
    include_completed: bool,
    limit: int,
) -> Sequence[UIBridgeExplorationSession]:
    """List a project's sessions, newest first, up to ``limit``."""
    query = select(UIBridgeExplorationSession).where(
        UIBridgeExplorationSession.project_id == project_id
    )

    if not include_completed:
        query = query.where(UIBridgeExplorationSession.status != "completed")

    query = query.order_by(UIBridgeExplorationSession.created_at.desc()).limit(limit)

    result = await db.execute(query)
    return result.scalars().all()


async def get_session(
    db: AsyncSession, project_id: UUID, session_id: UUID
) -> UIBridgeExplorationSession | None:
    """Get a session by ID, scoped to its project."""
    result = await db.execute(
        select(UIBridgeExplorationSession).where(
            UIBridgeExplorationSession.id == session_id,
            UIBridgeExplorationSession.project_id == project_id,
        )
    )
    return result.scalar_one_or_none()


async def create_session(
    db: AsyncSession, project_id: UUID, data: ExplorationSessionCreate
) -> UIBridgeExplorationSession:
    """Create a ``running`` session with no renders. Commits, then refreshes it.

    An unnamed session is named after the current UTC minute.
    """
    name = data.name or f"Exploration {datetime.now(UTC).strftime('%Y-%m-%d %H:%M')}"

    session = UIBridgeExplorationSession(
        project_id=project_id,
        name=name,
        status="running",
        target_type=data.target_type,
        target_url=data.target_url,
        exploration_config=data.exploration_config,
        render_logs=[],
        elements_discovered=0,
        elements_explored=0,
        render_count=0,
    )

    db.add(session)
    await db.commit()
    await db.refresh(session)
    return session


async def update_session(
    db: AsyncSession,
    session: UIBridgeExplorationSession,
    data: ExplorationSessionUpdate,
) -> UIBridgeExplorationSession:
    """Apply the non-``None`` fields. Commits, then refreshes the session.

    ``render_logs`` is APPENDED to the stored list, not a replacement, and
    a terminal ``status`` stamps ``completed_at``.
    """
    if data.status is not None:
        session.status = data.status.value
        if data.status.value in _TERMINAL_STATUSES:
            session.completed_at = datetime.now(UTC)

    if data.render_logs is not None:
        session.render_logs = session.render_logs + data.render_logs
        session.render_count = len(session.render_logs)

    if data.elements_discovered is not None:
        session.elements_discovered = data.elements_discovered

    if data.elements_explored is not None:
        session.elements_explored = data.elements_explored

    if data.error_message is not None:
        session.error_message = data.error_message

    if data.discovery_completed is not None:
        session.discovery_completed = data.discovery_completed

    if data.saved_config_id is not None:
        session.saved_config_id = data.saved_config_id

    await db.commit()
    await db.refresh(session)
    return session


async def append_renders(
    db: AsyncSession,
    session: UIBridgeExplorationSession,
    data: ExplorationSessionAppendRenders,
) -> UIBridgeExplorationSession:
    """Append render logs and update the counters. Commits, then refreshes."""
    session.render_logs = session.render_logs + data.render_logs
    session.render_count = len(session.render_logs)

    if data.elements_discovered is not None:
        session.elements_discovered = data.elements_discovered

    if data.elements_explored is not None:
        session.elements_explored = data.elements_explored

    await db.commit()
    await db.refresh(session)
    return session


async def delete_session(db: AsyncSession, session: UIBridgeExplorationSession) -> None:
    """Delete a session. Commits."""
    await db.delete(session)
    await db.commit()
