"""
Element detection service for capture sessions.

Uses qontinui-api's computer vision capabilities to detect UI elements
in captured screenshots.
"""

import io
from uuid import UUID

import httpx
import structlog
from fastapi import HTTPException, status
from PIL import Image
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.models.capture import CaptureDetectedElement, CaptureScreenshot, CaptureSession
from app.services.object_storage import object_storage

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

        # Call qontinui-api for element detection
        detected_elements = await ElementDetectionService._detect_with_api(
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
        from app.services.capture_session_service import CaptureSessionService

        # Verify session access
        await CaptureSessionService.get_session(db, session_id, user_id)

        # Get all screenshots
        screenshots = await CaptureSessionService.get_session_screenshots(
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
    async def _detect_with_api(image: Image.Image, config: dict) -> list[dict]:
        """
        Detect elements using qontinui-api.

        Args:
            image: PIL Image of the screenshot
            config: Detection configuration

        Returns:
            List of detected element dictionaries
        """
        try:
            # Save image to bytes
            image_buffer = io.BytesIO()
            image.save(image_buffer, format="PNG")
            image_buffer.seek(0)

            # Call qontinui-api semantic analysis endpoint
            async with httpx.AsyncClient(timeout=60.0) as client:
                response = await client.post(
                    f"{settings.QONTINUI_API_URL}/api/semantic/analyze",
                    files={"image": ("screenshot.png", image_buffer, "image/png")},
                    data={
                        "extract_text": config.get("extract_text", True),
                        "detect_elements": config.get("detect_elements", True),
                        "segment_regions": config.get("segment_regions", False),
                    },
                )

                if response.status_code == 200:
                    result = response.json()
                    return ElementDetectionService._parse_api_response(result)
                else:
                    logger.warning(
                        "qontinui_api_detection_failed",
                        status=response.status_code,
                        response=response.text[:500],
                    )
                    # Fallback to basic detection
                    return ElementDetectionService._basic_detection(image)

        except httpx.TimeoutException:
            logger.error("api_detection_timeout")
            return ElementDetectionService._basic_detection(image)
        except Exception as e:
            logger.error("api_detection_error", error=str(e))
            return ElementDetectionService._basic_detection(image)

    @staticmethod
    def _parse_api_response(api_result: dict) -> list[dict]:
        """
        Parse qontinui-api response into element format.

        Args:
            api_result: Response from qontinui-api

        Returns:
            List of element dictionaries
        """
        elements = []

        # Parse detected regions
        if "regions" in api_result:
            for region in api_result["regions"]:
                element = {
                    "element_type": region.get("type", "unknown"),
                    "x": region.get("x", 0),
                    "y": region.get("y", 0),
                    "width": region.get("width", 0),
                    "height": region.get("height", 0),
                    "text_content": region.get("text"),
                    "confidence": region.get("confidence", 0.5),
                    "properties": {
                        "color": region.get("color"),
                        "background": region.get("background"),
                        "semantic_label": region.get("label"),
                    },
                    "visual_hash": region.get("hash"),
                }
                elements.append(element)

        # Parse text detections
        if "text_regions" in api_result:
            for text_region in api_result["text_regions"]:
                element = {
                    "element_type": "text",
                    "x": text_region.get("bbox", [0, 0, 0, 0])[0],
                    "y": text_region.get("bbox", [0, 0, 0, 0])[1],
                    "width": text_region.get("bbox", [0, 0, 0, 0])[2],
                    "height": text_region.get("bbox", [0, 0, 0, 0])[3],
                    "text_content": text_region.get("text"),
                    "confidence": text_region.get("confidence", 0.8),
                    "properties": {"font_size": text_region.get("font_size")},
                }
                elements.append(element)

        return elements

    @staticmethod
    def _basic_detection(image: Image.Image) -> list[dict]:
        """
        Basic fallback element detection without API.

        Performs simple image analysis to detect potential UI elements.

        Args:
            image: PIL Image of the screenshot

        Returns:
            List of basic detected elements
        """
        import numpy as np

        try:
            # Convert to numpy array
            img_array = np.array(image.convert("RGB"))
            height, width = img_array.shape[:2]

            # Simple edge detection to find UI boundaries
            # This is a very basic placeholder - real detection would be more sophisticated
            elements = []

            # Detect uniform regions that might be buttons/inputs
            # Split image into grid and check for color uniformity
            grid_size = 50
            for y in range(0, height - grid_size, grid_size):
                for x in range(0, width - grid_size, grid_size):
                    region = img_array[y : y + grid_size, x : x + grid_size]

                    # Check if region has low variance (uniform color)
                    variance = np.var(region)
                    if variance < 100:  # Threshold for "uniform" region
                        element = {
                            "element_type": "region",
                            "x": x,
                            "y": y,
                            "width": grid_size,
                            "height": grid_size,
                            "text_content": None,
                            "confidence": 0.3,  # Low confidence for basic detection
                            "properties": {
                                "detection_method": "basic_grid",
                                "color_variance": float(variance),
                            },
                        }
                        elements.append(element)

            logger.info(
                "basic_detection_completed",
                element_count=len(elements),
            )

            return elements[:50]  # Limit to 50 elements

        except Exception as e:
            logger.error("basic_detection_failed", error=str(e))
            return []
