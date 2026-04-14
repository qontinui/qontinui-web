"""
Facade for capture session management.

Delegates to specialized services while maintaining backward compatibility.
This facade will be gradually deprecated in favor of direct service usage.
"""

from uuid import UUID

from app.models.capture import CaptureAction, CaptureScreenshot, CaptureSession
from app.schemas.capture import (
    CaptureActionCreate,
    CaptureSessionCreate,
    CaptureSessionUpdate,
)
from app.services.action_recorder import ActionRecorder
from app.services.screenshot_storage_service import ScreenshotStorageService
from app.services.session_repository import SessionRepository
from app.services.session_state_matcher import SessionStateMatcher
from fastapi import UploadFile
from sqlalchemy.ext.asyncio import AsyncSession


class CaptureSessionService:
    """
    Facade for managing capture sessions and related entities.

    This service delegates to specialized services:
    - SessionRepository: Session CRUD operations
    - ScreenshotStorageService: Screenshot upload and retrieval
    - ActionRecorder: Action recording and retrieval
    - SessionStateMatcher: State matching operations
    """

    @staticmethod
    async def create_session(
        db: AsyncSession,
        project_id: UUID,
        user_id: UUID,
        session_data: CaptureSessionCreate,
    ) -> CaptureSession:
        """Create a new capture session."""
        return await SessionRepository.create(db, project_id, user_id, session_data)

    @staticmethod
    async def get_session(
        db: AsyncSession, session_id: UUID, user_id: UUID
    ) -> CaptureSession:
        """Get a capture session by ID."""
        return await SessionRepository.get_by_id(db, session_id, user_id)

    @staticmethod
    async def list_sessions(
        db: AsyncSession,
        user_id: UUID,
        project_id: UUID | None = None,
        status_filter: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[CaptureSession], int]:
        """List capture sessions for a user."""
        return await SessionRepository.list(
            db, user_id, project_id, status_filter, limit, offset
        )

    @staticmethod
    async def update_session(
        db: AsyncSession,
        session_id: UUID,
        user_id: UUID,
        update_data: CaptureSessionUpdate,
    ) -> CaptureSession:
        """Update a capture session."""
        return await SessionRepository.update(db, session_id, user_id, update_data)

    @staticmethod
    async def delete_session(db: AsyncSession, session_id: UUID, user_id: UUID) -> bool:
        """Delete a capture session and all related data."""
        return await SessionRepository.delete(db, session_id, user_id)

    @staticmethod
    async def upload_screenshot(
        db: AsyncSession,
        session_id: UUID,
        user_id: UUID,
        sequence_number: int,
        file: UploadFile,
        subscription_tier: str,
        extra_metadata: dict | None = None,
    ) -> CaptureScreenshot:
        """Upload a screenshot to a capture session."""
        return await ScreenshotStorageService.upload_screenshot(
            db,
            session_id,
            user_id,
            sequence_number,
            file,
            subscription_tier,
            extra_metadata,
        )

    @staticmethod
    async def get_session_screenshots(
        db: AsyncSession, session_id: UUID, user_id: UUID
    ) -> list[CaptureScreenshot]:
        """Get all screenshots for a session, ordered by sequence number."""
        return await ScreenshotStorageService.get_session_screenshots(
            db, session_id, user_id
        )

    @staticmethod
    async def create_action(
        db: AsyncSession, user_id: UUID, action_data: CaptureActionCreate
    ) -> CaptureAction:
        """Create a user action within a screenshot."""
        return await ActionRecorder.create_action(db, user_id, action_data)

    @staticmethod
    async def batch_create_actions(
        db: AsyncSession, user_id: UUID, actions_data: list[CaptureActionCreate]
    ) -> list[CaptureAction]:
        """Batch create multiple actions."""
        return await ActionRecorder.batch_create_actions(db, user_id, actions_data)

    @staticmethod
    async def get_screenshot_actions(
        db: AsyncSession, screenshot_id: UUID, user_id: UUID
    ) -> list[CaptureAction]:
        """Get all actions for a screenshot, ordered by sequence number."""
        return await ActionRecorder.get_screenshot_actions(db, screenshot_id, user_id)

    @staticmethod
    async def match_session_to_states(
        db: AsyncSession,
        session_id: UUID,
        user_id: UUID,
        confidence_threshold: float = 0.7,
    ) -> dict:
        """Match all screenshots in a session against known states."""
        return await SessionStateMatcher.match_session_to_states(
            db, session_id, user_id, confidence_threshold
        )
