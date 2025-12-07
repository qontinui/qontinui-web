"""
Element detection service for capture sessions.

Facade that coordinates multiple specialized services to detect UI elements
in captured screenshots. Delegates to:
- TemplateMatcherService: API-based element detection
- RegionAnalyzer: Fallback region detection (DEPRECATED - removed)
"""

import io
from uuid import UUID

import structlog
from fastapi import HTTPException, status
from PIL import Image
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.capture import CaptureDetectedElement, CaptureScreenshot, CaptureSession
from app.services.object_storage import object_storage

# DEPRECATED: CV-heavy service removed - moved to qontinui library
# from app.services.region_analyzer import RegionAnalyzer
from app.services.template_matcher_service import TemplateMatcherService

logger = structlog.get_logger(__name__)


class ElementDetectionService:
    """Service for detecting UI elements in capture screenshots."""

    @staticmethod
    async def detect_elements_in_screenshot(
        db: AsyncSession,
        screenshot_id: UUID,
        user_id: UUID,
        detection_config: dict | None = None,
    ) -> list[CaptureDetectedElement]:
        """
        Detect UI elements in a capture screenshot.

        Uses qontinui-api's analysis capabilities to identify buttons, inputs,
        text, images, and other UI elements.

        Args:
            db: Database session
            screenshot_id: ID of the capture screenshot
            user_id: ID of the user (for authorization)
            detection_config: Optional detection configuration

        Returns:
            List of detected elements

        Raises:
            HTTPException: If screenshot not found or detection fails
        """
        # Get the capture screenshot with session info
        result = await db.execute(
            select(CaptureScreenshot)
            .options(selectinload(CaptureScreenshot.session))
            .join(CaptureSession)
            .filter(
                CaptureScreenshot.id == screenshot_id,
                CaptureSession.user_id == user_id,
            )
        )
        screenshot = result.scalar_one_or_none()

        if not screenshot:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Screenshot not found or access denied",
            )

        # Download the screenshot
        try:
            # Extract key from URL
            image_key = screenshot.image_url.split("/")[-1]
            image_data = object_storage.download_file(image_key)
            image = Image.open(io.BytesIO(image_data))
        except Exception as e:
            logger.error(
                "failed_to_load_screenshot",
                screenshot_id=str(screenshot_id),
                error=str(e),
            )
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to load screenshot",
            )

        # Try API-based detection first, fallback to basic detection
        detected_elements = await ElementDetectionService._detect_elements(
            image, detection_config or {}
        )

        # Store detected elements in database
        db_elements = []
        for element in detected_elements:
            db_element = CaptureDetectedElement(
                screenshot_id=screenshot_id,
                element_type=element["element_type"],
                x=element["x"],
                y=element["y"],
                width=element["width"],
                height=element["height"],
                text_content=element.get("text_content"),
                confidence=element["confidence"],
                properties=element.get("properties"),
                visual_hash=element.get("visual_hash"),
            )
            db_elements.append(db_element)

        if db_elements:
            db.add_all(db_elements)
            await db.commit()

            # Refresh to get IDs
            for elem in db_elements:
                await db.refresh(elem)

            # Update screenshot analysis status
            screenshot.analysis_status = "completed"
            await db.commit()

            logger.info(
                "elements_detected",
                screenshot_id=str(screenshot_id),
                element_count=len(db_elements),
                element_types=list({e.element_type for e in db_elements}),
            )
        else:
            screenshot.analysis_status = "no_elements_found"
            await db.commit()

        return db_elements

    @staticmethod
    async def detect_elements_in_session(
        db: AsyncSession,
        session_id: UUID,
        user_id: UUID,
        detection_config: dict | None = None,
    ) -> dict:
        """
        Detect UI elements in all screenshots of a capture session.

        Args:
            db: Database session
            session_id: ID of the capture session
            user_id: ID of the user (for authorization)
            detection_config: Optional detection configuration

        Returns:
            Dictionary with detection statistics
        """
        from app.services.screenshot_storage_service import ScreenshotStorageService
        from app.services.session_repository import SessionRepository

        # Verify session access
        await SessionRepository.get_by_id(db, session_id, user_id)

        # Get all screenshots
        screenshots = await ScreenshotStorageService.get_session_screenshots(
            db, session_id, user_id
        )

        if not screenshots:
            return {
                "session_id": str(session_id),
                "total_screenshots": 0,
                "analyzed_screenshots": 0,
                "total_elements": 0,
                "element_types": {},
            }

        # Detect elements in each screenshot
        total_elements = 0
        analyzed_count = 0
        element_type_counts: dict[str, int] = {}

        for screenshot in screenshots:
            # Skip if already analyzed
            if screenshot.analysis_status == "completed":
                logger.info(
                    "screenshot_already_analyzed",
                    screenshot_id=str(screenshot.id),
                )
                continue

            try:
                elements = await ElementDetectionService.detect_elements_in_screenshot(
                    db=db,
                    screenshot_id=screenshot.id,
                    user_id=user_id,
                    detection_config=detection_config,
                )

                total_elements += len(elements)
                analyzed_count += 1

                # Count element types
                for element in elements:
                    element_type_counts[element.element_type] = (
                        element_type_counts.get(element.element_type, 0) + 1
                    )

            except Exception as e:
                logger.warning(
                    "element_detection_failed",
                    screenshot_id=str(screenshot.id),
                    error=str(e),
                )
                # Mark as failed
                screenshot.analysis_status = "failed"
                await db.commit()
                continue

        logger.info(
            "session_element_detection_completed",
            session_id=str(session_id),
            total_screenshots=len(screenshots),
            analyzed_screenshots=analyzed_count,
            total_elements=total_elements,
        )

        return {
            "session_id": str(session_id),
            "total_screenshots": len(screenshots),
            "analyzed_screenshots": analyzed_count,
            "total_elements": total_elements,
            "element_types": element_type_counts,
        }

    @staticmethod
    async def _detect_elements(image: Image.Image, config: dict) -> list[dict]:
        """
        Detect elements using API.

        Coordinates with TemplateMatcherService for API-based detection.

        Args:
            image: PIL Image of the screenshot
            config: Detection configuration

        Returns:
            List of detected element dictionaries
        """
        # Try API-based detection first
        elements, success = await TemplateMatcherService.detect_with_api(image, config)

        if success and elements:
            return elements

        # No fallback available - RegionAnalyzer has been removed
        logger.warning(
            "element_detection_failed",
            reason="api_detection_failed_and_no_fallback_available",
        )
        return []
