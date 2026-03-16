"""
Service for Task Run Session operations.

Handles creation, updating, and retrieval of task run sessions
(individual Claude sessions within a task run).
"""

from datetime import UTC, datetime
from uuid import UUID

import structlog
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.task_run import TaskRunSession
from app.repositories.task_run import (
    TaskRunRepository,
    TaskRunSessionRepository,
)
from app.services.task_run.mappers import model_to_session_response
from app.services.task_run.schemas import (
    TaskRunSessionCreate,
    TaskRunSessionResponse,
    TaskRunSessionUpdate,
)

logger = structlog.get_logger(__name__)


class TaskRunSessionService:
    """Service for task run session operations."""

    def __init__(
        self,
        task_run_repo: TaskRunRepository | None = None,
        session_repo: TaskRunSessionRepository | None = None,
    ) -> None:
        """Initialize with repositories."""
        self.task_run_repo = task_run_repo or TaskRunRepository()
        self.session_repo = session_repo or TaskRunSessionRepository()

    async def create_session(
        self,
        db: AsyncSession,
        task_run_id: UUID,
        session_data: TaskRunSessionCreate,
    ) -> TaskRunSessionResponse | None:
        """
        Record a session start.

        Args:
            db: Database session
            task_run_id: ID of the task run
            session_data: Session creation data

        Returns:
            Created TaskRunSessionResponse or None if task not found
        """
        task_run = await self.task_run_repo.get_task_run_by_id(db, task_run_id)
        if not task_run:
            return None

        session = TaskRunSession(
            task_run_id=task_run_id,
            session_number=session_data.session_number,
            started_at=session_data.started_at or datetime.now(UTC),
        )

        created = await self.session_repo.create_session(db, session)

        # Update task sessions_count
        task_run.sessions_count = session_data.session_number
        await self.task_run_repo.update_task_run(db, task_run)

        await db.commit()
        await db.refresh(created)

        logger.debug(
            "Created task run session",
            task_run_id=str(task_run_id),
            session_number=session_data.session_number,
        )

        return model_to_session_response(created)

    async def update_session(
        self,
        db: AsyncSession,
        task_run_id: UUID,
        session_number: int,
        update_data: TaskRunSessionUpdate,
    ) -> TaskRunSessionResponse | None:
        """
        Record a session end.

        Args:
            db: Database session
            task_run_id: ID of the task run
            session_number: Session number
            update_data: Session update data

        Returns:
            Updated TaskRunSessionResponse or None if not found
        """
        session = await self.session_repo.get_session_by_number(
            db, task_run_id, session_number
        )
        if not session:
            return None

        session.ended_at = update_data.ended_at
        if update_data.duration_seconds is not None:
            session.duration_seconds = update_data.duration_seconds
        else:
            # Calculate duration
            session.duration_seconds = int(
                (update_data.ended_at - session.started_at).total_seconds()
            )
        if update_data.output_summary is not None:
            session.output_summary = update_data.output_summary

        await self.session_repo.update_session(db, session)
        await db.commit()
        await db.refresh(session)

        logger.debug(
            "Updated task run session",
            task_run_id=str(task_run_id),
            session_number=session_number,
            duration_seconds=session.duration_seconds,
        )

        return model_to_session_response(session)

    async def get_sessions(
        self,
        db: AsyncSession,
        task_run_id: UUID,
    ) -> list[TaskRunSessionResponse]:
        """
        Get all sessions for a task run.

        Args:
            db: Database session
            task_run_id: ID of the task run

        Returns:
            List of TaskRunSessionResponse
        """
        sessions = await self.session_repo.get_sessions_for_task_run(db, task_run_id)
        return [model_to_session_response(s) for s in sessions]
