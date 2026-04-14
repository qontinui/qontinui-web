"""
Repository for recording database operations.

Extracts database query logic from recordings.py endpoints into reusable methods.
"""

from datetime import UTC, datetime, timedelta

import structlog
from app.models.discovered_state import DiscoveredState
from app.models.recording import (DiscoveredTransition, Recording,
                                  RecordingContext, RecordingFrame,
                                  RecordingInteraction, RecordingStatus)
from app.repositories.base import BaseRepository
from app.services.object_storage import object_storage
from pydantic import BaseModel
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

logger = structlog.get_logger(__name__)


class RecordingCreate(BaseModel):
    """Schema for creating a recording."""

    project_id: str
    created_by_id: str
    name: str
    description: str | None = None
    tags: list[str] = []
    recording_start_time: datetime
    recording_end_time: datetime
    duration_ms: int
    recorder_name: str
    recorder_version: str | None = None
    recorder_platform: str
    screen_width: int
    screen_height: int
    screen_dpi: int | None = None
    os_name: str | None = None
    os_version: str | None = None
    locale: str | None = None
    app_name: str
    app_version: str | None = None
    app_type: str
    app_url: str | None = None
    frame_rate: float
    total_frames: int
    total_interactions: int = 0
    total_context_events: int = 0
    s3_bucket: str | None = None
    s3_prefix: str
    upload_size_bytes: int
    status: RecordingStatus = RecordingStatus.UPLOADED
    validation_warnings: list[str] = []


class RecordingRepository(BaseRepository[Recording, RecordingCreate]):
    """
    Repository for recording database operations.

    Provides specialized query methods for recordings including:
    - List recordings with pagination and filtering
    - Get recording with related entities
    - Frame and interaction queries
    - State structure queries
    """

    def __init__(self) -> None:
        super().__init__(Recording)

    async def list_recordings(
        self,
        db: AsyncSession,
        project_id: str | None = None,
        status: RecordingStatus | None = None,
        skip: int = 0,
        limit: int = 100,
    ) -> tuple[list[Recording], int]:
        """
        List recordings with optional filtering.

        Args:
            db: Async database session
            project_id: Optional filter by project
            status: Optional filter by status
            skip: Pagination offset
            limit: Maximum number of results

        Returns:
            Tuple of (list of recordings, total count)
        """
        query = select(Recording).order_by(desc(Recording.created_at))

        # Apply filters
        if project_id:
            query = query.where(Recording.project_id == project_id)
        if status:
            query = query.where(Recording.status == status)  # type: ignore[arg-type]

        # Get total count
        count_query = select(func.count()).select_from(query.subquery())
        total_result = await db.execute(count_query)
        total = total_result.scalar() or 0

        # Apply pagination
        query = query.offset(skip).limit(limit)
        result = await db.execute(query)
        recordings = list(result.scalars().all())

        logger.debug(
            "list_recordings_completed",
            project_id=project_id,
            total=total,
            returned=len(recordings),
        )

        return recordings, total

    async def get_by_id(
        self,
        db: AsyncSession,
        recording_id: str,
    ) -> Recording | None:
        """
        Get a recording by ID.

        Args:
            db: Async database session
            recording_id: Recording UUID as string

        Returns:
            Recording if found, None otherwise
        """
        result = await db.execute(select(Recording).where(Recording.id == recording_id))
        return result.scalar_one_or_none()

    async def get_frames(
        self,
        db: AsyncSession,
        recording_id: str,
        skip: int = 0,
        limit: int = 100,
    ) -> list[RecordingFrame]:
        """
        Get frames for a recording with pagination.

        Args:
            db: Async database session
            recording_id: Recording UUID
            skip: Pagination offset
            limit: Maximum number of results

        Returns:
            List of RecordingFrame objects
        """
        result = await db.execute(
            select(RecordingFrame)
            .where(RecordingFrame.recording_id == recording_id)
            .order_by(RecordingFrame.frame_number)
            .offset(skip)
            .limit(limit)
        )
        return list(result.scalars().all())

    async def refresh_frame_urls(
        self,
        db: AsyncSession,
        frames: list[RecordingFrame],
    ) -> None:
        """
        Refresh presigned URLs for frames if expired.

        Args:
            db: Async database session
            frames: List of frames to check/refresh
        """
        storage = object_storage
        for frame in frames:
            if not frame.image_url or frame.url_expires_at < datetime.now(UTC):
                url = storage.generate_presigned_url(
                    str(frame.s3_key), expiration=3600 * 24 * 7
                )
                frame.image_url = url  # type: ignore[assignment]
                frame.url_expires_at = datetime.now(UTC) + timedelta(days=7)  # type: ignore[assignment]

        await db.commit()

    async def get_discovered_states(
        self,
        db: AsyncSession,
        recording_id: str,
    ) -> list[DiscoveredState]:
        """
        Get discovered states for a recording.

        Args:
            db: Async database session
            recording_id: Recording UUID

        Returns:
            List of DiscoveredState objects ordered by confidence
        """
        result = await db.execute(
            select(DiscoveredState)
            .where(DiscoveredState.recording_id == recording_id)
            .order_by(DiscoveredState.confidence.desc())
        )
        return list(result.scalars().all())

    async def get_discovered_transitions(
        self,
        db: AsyncSession,
        recording_id: str,
    ) -> list[DiscoveredTransition]:
        """
        Get discovered transitions for a recording.

        Args:
            db: Async database session
            recording_id: Recording UUID

        Returns:
            List of DiscoveredTransition objects ordered by confidence
        """
        result = await db.execute(
            select(DiscoveredTransition)
            .where(DiscoveredTransition.recording_id == recording_id)
            .order_by(DiscoveredTransition.confidence.desc())
        )
        return list(result.scalars().all())

    async def delete_recording(
        self,
        db: AsyncSession,
        recording: Recording,
    ) -> None:
        """
        Delete a recording from the database.

        Note: This cascades to all related entities (frames, interactions, etc.).
        S3 cleanup should be done separately by the service layer.

        Args:
            db: Async database session
            recording: Recording to delete
        """
        await db.delete(recording)
        await db.commit()

        logger.info("recording_deleted_from_db", recording_id=str(recording.id))

    async def create_recording_with_data(
        self,
        db: AsyncSession,
        recording: Recording,
        frames: list[RecordingFrame],
        interactions: list[RecordingInteraction],
        context_events: list[RecordingContext],
    ) -> Recording:
        """
        Create a recording with all associated data.

        Args:
            db: Async database session
            recording: Recording entity
            frames: List of frame entities
            interactions: List of interaction entities
            context_events: List of context event entities

        Returns:
            Created Recording with ID populated
        """
        db.add(recording)

        for frame in frames:
            db.add(frame)

        for interaction in interactions:
            db.add(interaction)

        for context in context_events:
            db.add(context)

        await db.commit()
        await db.refresh(recording)

        logger.info(
            "recording_created",
            recording_id=str(recording.id),
            frame_count=len(frames),
            interaction_count=len(interactions),
            context_count=len(context_events),
        )

        return recording


# Singleton instance for convenience
recording_repository = RecordingRepository()
