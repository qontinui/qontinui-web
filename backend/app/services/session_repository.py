"""
Repository for capture session database operations.

Handles CRUD operations for capture sessions following the repository pattern.
"""

from datetime import UTC, datetime
from pathlib import Path
from uuid import UUID

import structlog
from app.models.capture import CaptureScreenshot, CaptureSession
from app.schemas.capture import CaptureSessionCreate, CaptureSessionUpdate
from app.services.object_storage import object_storage
from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

logger = structlog.get_logger(__name__)


class SessionRepository:
    """Repository for capture session database operations."""

    @staticmethod
    async def create(
        db: AsyncSession,
        project_id: UUID,
        user_id: UUID,
        session_data: CaptureSessionCreate,
    ) -> CaptureSession:
        """
        Create a new capture session.

        Args:
            db: Database session
            project_id: ID of the project
            user_id: ID of the user creating the session
            session_data: Session creation data

        Returns:
            The created CaptureSession
        """
        session = CaptureSession(
            project_id=project_id,
            user_id=user_id,
            name=session_data.name,
            description=session_data.description,
            status="capturing",
            extra_metadata=session_data.extra_metadata,
            created_at=datetime.now(UTC),
        )

        db.add(session)
        await db.commit()
        await db.refresh(session)

        logger.info(
            "capture_session_created",
            session_id=str(session.id),
            project_id=project_id,
            user_id=str(user_id),
            name=session_data.name,
        )

        return session

    @staticmethod
    async def get_by_id(
        db: AsyncSession, session_id: UUID, user_id: UUID
    ) -> CaptureSession:
        """
        Get a capture session by ID.

        Args:
            db: Database session
            session_id: ID of the session
            user_id: ID of the user (for authorization check)

        Returns:
            The CaptureSession

        Raises:
            HTTPException: If session not found or user doesn't have access
        """
        result = await db.execute(
            select(CaptureSession)
            .options(selectinload(CaptureSession.screenshots))
            .filter(CaptureSession.id == session_id, CaptureSession.user_id == user_id)
        )
        session = result.scalar_one_or_none()

        if not session:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Capture session {session_id} not found",
            )

        return session

    @staticmethod
    async def list(
        db: AsyncSession,
        user_id: UUID,
        project_id: UUID | None = None,
        status_filter: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[CaptureSession], int]:
        """
        List capture sessions for a user.

        Args:
            db: Database session
            user_id: ID of the user
            project_id: Optional filter by project
            status_filter: Optional filter by status
            limit: Maximum number of results
            offset: Pagination offset

        Returns:
            Tuple of (sessions list, total count)
        """
        query = select(CaptureSession).filter(CaptureSession.user_id == user_id)

        if project_id:
            query = query.filter(CaptureSession.project_id == project_id)

        if status_filter:
            query = query.filter(CaptureSession.status == status_filter)

        # Get total count
        count_query = select(func.count()).select_from(query.subquery())
        total_result = await db.execute(count_query)
        total = total_result.scalar() or 0

        # Get paginated results
        query = query.order_by(CaptureSession.created_at.desc())
        query = query.limit(limit).offset(offset)

        result = await db.execute(query)
        sessions = result.scalars().all()

        return list(sessions), total

    @staticmethod
    async def update(
        db: AsyncSession,
        session_id: UUID,
        user_id: UUID,
        update_data: CaptureSessionUpdate,
    ) -> CaptureSession:
        """
        Update a capture session.

        Args:
            db: Database session
            session_id: ID of the session
            user_id: ID of the user (for authorization)
            update_data: Update data

        Returns:
            The updated CaptureSession
        """
        session = await SessionRepository.get_by_id(db, session_id, user_id)

        if update_data.name is not None:
            session.name = update_data.name
        if update_data.description is not None:
            session.description = update_data.description
        if update_data.status is not None:
            session.status = update_data.status
            if update_data.status == "completed":
                session.completed_at = datetime.now(UTC)
        if update_data.extra_metadata is not None:
            session.extra_metadata = update_data.extra_metadata

        await db.commit()
        await db.refresh(session)

        logger.info(
            "capture_session_updated",
            session_id=str(session_id),
            status=session.status,
        )

        return session

    @staticmethod
    async def delete(db: AsyncSession, session_id: UUID, user_id: UUID) -> bool:
        """
        Delete a capture session and all related data.

        Args:
            db: Database session
            session_id: ID of the session
            user_id: ID of the user (for authorization)

        Returns:
            True if deleted
        """
        session = await SessionRepository.get_by_id(db, session_id, user_id)

        # Get all screenshots to delete from storage
        result = await db.execute(
            select(CaptureScreenshot).filter(CaptureScreenshot.session_id == session_id)
        )
        screenshots = result.scalars().all()

        # Delete images from storage
        for screenshot in screenshots:
            try:
                key = Path(screenshot.image_url).name
                object_storage.delete_file(key)
                if screenshot.thumbnail_url:
                    thumbnail_key = Path(screenshot.thumbnail_url).name
                    object_storage.delete_file(thumbnail_key)
            except Exception as e:
                logger.warning(
                    "failed_to_delete_screenshot_file",
                    screenshot_id=str(screenshot.id),
                    error=str(e),
                )

        # Delete session (cascade will handle related records)
        await db.delete(session)
        await db.commit()

        logger.info(
            "capture_session_deleted",
            session_id=str(session_id),
            screenshot_count=len(screenshots),
        )

        return True
