"""
Service for matching capture sessions to known UI states.

DEPRECATED: This service depends on StateMatchingService which has been removed.
State matching functionality should be implemented in the qontinui library.

Coordinates state matching operations across all screenshots in a session,
delegating to StateMatchingService for individual screenshot matching.
"""

from uuid import UUID

import structlog
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.screenshot_storage_service import ScreenshotStorageService
from app.services.session_repository import SessionRepository

# DEPRECATED: CV-heavy service removed - moved to qontinui library
# from app.services.state_matching_service import StateMatchingService

logger = structlog.get_logger(__name__)


class SessionStateMatcher:
    """Service for matching capture sessions to UI states."""

    @staticmethod
    async def match_session_to_states(
        db: AsyncSession,
        session_id: UUID,
        user_id: UUID,
        confidence_threshold: float = 0.7,
    ) -> dict:
        """
        DEPRECATED: State matching functionality has been removed.

        Match all screenshots in a session against known states.

        Args:
            db: Database session
            session_id: ID of the capture session
            user_id: ID of the user (for authorization)
            confidence_threshold: Minimum confidence for a match

        Returns:
            Dictionary with match statistics

        Raises:
            HTTPException: If session not found or user doesn't have access
        """
        raise HTTPException(
            status_code=410,
            detail="State matching functionality has been removed. Use qontinui library for local execution.",
        )
