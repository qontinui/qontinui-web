"""
Service for matching capture sessions to known UI states.

Coordinates state matching operations across all screenshots in a session,
delegating to StateMatchingService for individual screenshot matching.
"""

from uuid import UUID

import structlog
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.screenshot_storage_service import ScreenshotStorageService
from app.services.session_repository import SessionRepository
from app.services.state_matching_service import StateMatchingService

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
        # Verify session access
        await SessionRepository.get_by_id(db, session_id, user_id)

        # Get all screenshots for the session
        screenshots = await ScreenshotStorageService.get_session_screenshots(
            db, session_id, user_id
        )

        if not screenshots:
            return {
                "session_id": str(session_id),
                "total_screenshots": 0,
                "matched_screenshots": 0,
                "total_matches": 0,
                "unique_states": [],
            }

        # Match each screenshot
        total_matches = 0
        matched_screenshot_ids: set[UUID] = set()
        all_states: set[str] = set()

        for screenshot in screenshots:
            try:
                matches = await StateMatchingService.match_screenshot_to_states(
                    db=db,
                    screenshot_id=screenshot.id,
                    user_id=user_id,
                    confidence_threshold=confidence_threshold,
                )

                if matches:
                    total_matches += len(matches)
                    matched_screenshot_ids.add(screenshot.id)
                    all_states.update(m.state_identifier for m in matches)

            except Exception as e:
                logger.warning(
                    "screenshot_matching_failed",
                    screenshot_id=str(screenshot.id),
                    session_id=str(session_id),
                    error=str(e),
                )
                continue

        logger.info(
            "session_state_matching_completed",
            session_id=str(session_id),
            total_screenshots=len(screenshots),
            matched_screenshots=len(matched_screenshot_ids),
            total_matches=total_matches,
            unique_states=len(all_states),
        )

        return {
            "session_id": str(session_id),
            "total_screenshots": len(screenshots),
            "matched_screenshots": len(matched_screenshot_ids),
            "total_matches": total_matches,
            "unique_states": list(all_states),
        }
