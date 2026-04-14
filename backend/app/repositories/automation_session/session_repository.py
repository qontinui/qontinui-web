"""
Core session repository for automation session CRUD and access control.

Handles: list_with_stats, get_with_stats, check_session_access
"""

from datetime import datetime
from typing import Any
from uuid import UUID

import structlog
from app.models.automation_log import AutomationLog
from app.models.automation_screenshot import AutomationScreenshot
from app.models.automation_session import AutomationSession
from app.repositories.automation_session.schemas import AutomationSessionCreate
from app.repositories.base import BaseRepository
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

logger = structlog.get_logger(__name__)


class SessionRepository(BaseRepository[AutomationSession, AutomationSessionCreate]):
    """
    Repository for core automation session operations.

    Provides:
    - List sessions with log/screenshot counts
    - Get single session with stats
    - Check session access permissions
    """

    def __init__(self) -> None:
        super().__init__(AutomationSession)

    async def list_with_stats(
        self,
        db: AsyncSession,
        accessible_project_ids: list[UUID],
        user_id: UUID,
        status: str | None = None,
        start_date: datetime | None = None,
        end_date: datetime | None = None,
        skip: int = 0,
        limit: int = 50,
    ) -> tuple[list[dict[str, Any]], int]:
        """
        List automation sessions with log and screenshot counts.

        Sessions are returned if:
        - Session is linked to a project where user has VIEW+ permission, OR
        - Session is not linked to a project and was created by the user

        Args:
            db: Async database session
            accessible_project_ids: List of project UUIDs the user can access
            user_id: ID of the current user
            status: Optional filter by session status
            start_date: Optional filter for sessions created after this date
            end_date: Optional filter for sessions created before this date
            skip: Number of sessions to skip (pagination)
            limit: Maximum number of sessions to return

        Returns:
            Tuple of (list of session dicts with stats, total count)
        """
        # Build subqueries for counts (executed once, not per session)
        log_counts_subquery = (
            select(
                AutomationLog.session_id,
                func.count(AutomationLog.id).label("log_count"),
            )
            .group_by(AutomationLog.session_id)
            .subquery()
        )

        screenshot_counts_subquery = (
            select(
                AutomationScreenshot.session_id,
                func.count(AutomationScreenshot.id).label("screenshot_count"),
            )
            .group_by(AutomationScreenshot.session_id)
            .subquery()
        )

        # Build main query with LEFT JOINs to include sessions with 0 logs/screenshots
        query = (
            select(
                AutomationSession,
                func.coalesce(log_counts_subquery.c.log_count, 0).label("log_count"),
                func.coalesce(screenshot_counts_subquery.c.screenshot_count, 0).label(
                    "screenshot_count"
                ),
            )
            .outerjoin(
                log_counts_subquery,
                AutomationSession.id == log_counts_subquery.c.session_id,
            )
            .outerjoin(
                screenshot_counts_subquery,
                AutomationSession.id == screenshot_counts_subquery.c.session_id,
            )
            .where(
                or_(
                    AutomationSession.project_id.in_(accessible_project_ids),
                    and_(
                        AutomationSession.project_id.is_(None),
                        AutomationSession.user_id == user_id,
                    ),
                )
            )
        )

        # Apply additional filters
        if status:
            query = query.where(AutomationSession.status == status)
        if start_date:
            query = query.where(AutomationSession.created_at >= start_date)
        if end_date:
            query = query.where(AutomationSession.created_at <= end_date)

        # Get total count (before pagination)
        count_query = select(func.count()).select_from(query.subquery())
        count_result = await db.execute(count_query)
        total = count_result.scalar_one()

        # Apply pagination and ordering
        query = query.order_by(AutomationSession.created_at.desc())
        query = query.offset(skip).limit(limit)

        # Execute query
        result = await db.execute(query)
        rows = result.all()

        # Build response from query results
        sessions_with_stats = []
        for row in rows:
            session = row[0]
            log_count = row[1]
            screenshot_count = row[2]

            sessions_with_stats.append(
                {
                    "id": session.id,
                    "project_id": session.project_id,
                    "user_id": session.user_id,
                    "runner_version": session.runner_version,
                    "runner_os": session.runner_os,
                    "runner_hostname": session.runner_hostname,
                    "status": session.status,
                    "configuration_snapshot": session.configuration_snapshot,
                    "created_at": session.created_at,
                    "ended_at": session.ended_at,
                    "log_count": log_count,
                    "screenshot_count": screenshot_count,
                }
            )

        logger.debug(
            "list_with_stats_completed",
            user_id=str(user_id),
            session_count=len(sessions_with_stats),
            total=total,
        )

        return sessions_with_stats, total

    async def get_with_stats(
        self,
        db: AsyncSession,
        session_id: UUID,
    ) -> dict[str, Any] | None:
        """
        Get a single session with log and screenshot counts.

        Args:
            db: Async database session
            session_id: UUID of the session to retrieve

        Returns:
            Session dict with stats if found, None otherwise
        """
        # Build scalar subqueries for counts
        log_count_subquery = (
            select(func.count(AutomationLog.id).label("log_count"))
            .where(AutomationLog.session_id == session_id)
            .scalar_subquery()
        )

        screenshot_count_subquery = (
            select(func.count(AutomationScreenshot.id).label("screenshot_count"))
            .where(AutomationScreenshot.session_id == session_id)
            .scalar_subquery()
        )

        # Single query to fetch session + counts
        query = select(
            AutomationSession,
            log_count_subquery.label("log_count"),
            screenshot_count_subquery.label("screenshot_count"),
        ).where(AutomationSession.id == session_id)

        result = await db.execute(query)
        row = result.one_or_none()

        if not row:
            return None

        session = row[0]
        log_count = row[1]
        screenshot_count = row[2]

        return {
            "id": session.id,
            "project_id": session.project_id,
            "user_id": session.user_id,
            "runner_version": session.runner_version,
            "runner_os": session.runner_os,
            "runner_hostname": session.runner_hostname,
            "status": session.status,
            "configuration_snapshot": session.configuration_snapshot,
            "created_at": session.created_at,
            "ended_at": session.ended_at,
            "log_count": log_count,
            "screenshot_count": screenshot_count,
        }

    async def check_session_access(
        self,
        db: AsyncSession,
        session: AutomationSession,
        user_id: UUID,
        accessible_project_ids: list[UUID],
    ) -> bool:
        """
        Check if a user can access a session.

        Access is granted if:
        - Session is linked to a project in accessible_project_ids, OR
        - Session has no project and was created by the user

        Args:
            db: Async database session (for future permission checks)
            session: The automation session to check
            user_id: ID of the user requesting access
            accessible_project_ids: List of project UUIDs the user can access

        Returns:
            True if user has access, False otherwise
        """
        if session.project_id is not None:
            # Session is linked to a project - check if user has access
            return session.project_id in accessible_project_ids
        else:
            # No project linked - check if user created the session
            return session.user_id == user_id
