"""
State matching service for capture sessions.

Matches captured screenshots against reference screenshots from snapshot runs
to identify which UI states are present in the captured images.
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
from app.models.capture import CaptureScreenshot, CaptureSession, ScreenshotStateMatch
from app.models.snapshot import Screenshot
from app.schemas.capture import ScreenshotStateMatchCreate
from app.services.object_storage import object_storage

logger = structlog.get_logger(__name__)


class StateMatchingService:
    """Service for matching capture screenshots to known states."""

    @staticmethod
    async def match_screenshot_to_states(
        db: AsyncSession,
        screenshot_id: UUID,
        user_id: UUID,
        confidence_threshold: float = 0.7,
    ) -> list[ScreenshotStateMatch]:
        """
        Match a capture screenshot against reference screenshots to identify states.

        Args:
            db: Database session
            screenshot_id: ID of the capture screenshot to match
            user_id: ID of the user (for authorization)
            confidence_threshold: Minimum confidence to consider a match (0.0-1.0)

        Returns:
            List of created ScreenshotStateMatch records

        Raises:
            HTTPException: If screenshot not found or user doesn't have access
        """
        # Get the capture screenshot with session and project info
        result = await db.execute(
            select(CaptureScreenshot)
            .options(selectinload(CaptureScreenshot.session))
            .join(CaptureSession)
            .filter(
                CaptureScreenshot.id == screenshot_id,
                CaptureSession.user_id == user_id,
            )
        )
        capture_screenshot = result.scalar_one_or_none()

        if not capture_screenshot:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Screenshot not found or access denied",
            )

        project_id = capture_screenshot.session.project_id

        # Get reference screenshots from snapshot runs for this project
        ref_screenshots_result = await db.execute(
            select(Screenshot)
            .join(Screenshot.snapshot_run)
            .filter(Screenshot.snapshot_run.has(project_id=project_id))
            .options(selectinload(Screenshot.snapshot_run))
        )
        reference_screenshots = list(ref_screenshots_result.scalars().all())

        if not reference_screenshots:
            logger.info(
                "no_reference_screenshots_found",
                project_id=project_id,
                screenshot_id=str(screenshot_id),
            )
            return []

        # Download the captured screenshot
        try:
            capture_image_data = object_storage.download_file(
                capture_screenshot.image_url.split("/")[-1]
            )
            capture_image = Image.open(io.BytesIO(capture_image_data))
        except Exception as e:
            logger.error(
                "failed_to_load_capture_image",
                screenshot_id=str(screenshot_id),
                error=str(e),
            )
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to load capture screenshot",
            )

        # Compare against each reference screenshot
        matches = []
        for ref_screenshot in reference_screenshots:
            if not ref_screenshot.active_states:
                continue  # Skip if no states defined

            try:
                # Calculate similarity using template matching
                similarity = await StateMatchingService._calculate_similarity(
                    capture_image, ref_screenshot.screenshot_path
                )

                if similarity >= confidence_threshold:
                    # Create match for each active state in the reference screenshot
                    for state_name in ref_screenshot.active_states:
                        match_data = ScreenshotStateMatchCreate(
                            screenshot_id=screenshot_id,
                            state_identifier=state_name,
                            state_metadata={
                                "reference_screenshot_id": ref_screenshot.id,
                                "snapshot_run_id": ref_screenshot.snapshot_run.id,
                                "reference_path": ref_screenshot.screenshot_path,
                            },
                            confidence=similarity,
                            matched_elements={
                                "similarity_score": similarity,
                                "match_type": "template_matching",
                                "reference_screenshot": {
                                    "id": ref_screenshot.id,
                                    "path": ref_screenshot.screenshot_path,
                                    "state_hash": ref_screenshot.state_hash,
                                },
                            },
                            is_confirmed=None,  # User hasn't reviewed yet
                            review_notes=None,
                        )

                        # Create database record
                        state_match = ScreenshotStateMatch(
                            screenshot_id=match_data.screenshot_id,
                            state_identifier=match_data.state_identifier,
                            state_metadata=match_data.state_metadata,
                            confidence=match_data.confidence,
                            matched_elements=match_data.matched_elements,
                            is_confirmed=match_data.is_confirmed,
                            review_notes=match_data.review_notes,
                        )
                        matches.append(state_match)

            except Exception as e:
                logger.warning(
                    "failed_to_compare_screenshot",
                    ref_screenshot_id=ref_screenshot.id,
                    error=str(e),
                )
                continue

        # Save matches to database
        if matches:
            db.add_all(matches)
            await db.commit()

            # Refresh to get created_at timestamps
            for match in matches:
                await db.refresh(match)

            logger.info(
                "state_matches_created",
                screenshot_id=str(screenshot_id),
                match_count=len(matches),
                unique_states=len({m.state_identifier for m in matches}),
            )

        return matches

    @staticmethod
    async def _calculate_similarity(
        capture_image: Image.Image, reference_path: str
    ) -> float:
        """
        Calculate similarity between capture image and reference screenshot.

        Uses simple pixel-based comparison. Can be enhanced with qontinui-api
        template matching for better accuracy.

        Args:
            capture_image: PIL Image of the captured screenshot
            reference_path: Path to the reference screenshot

        Returns:
            Similarity score between 0.0 and 1.0
        """
        try:
            # Load reference image from storage
            ref_key = reference_path.split("/")[-1]
            ref_image_data = object_storage.download_file(ref_key)
            ref_image = Image.open(io.BytesIO(ref_image_data))

            # Ensure both images are same size
            if capture_image.size != ref_image.size:
                # Resize capture to match reference
                capture_image = capture_image.resize(
                    ref_image.size, Image.Resampling.LANCZOS
                )

            # Convert to RGB
            capture_rgb = capture_image.convert("RGB")
            ref_rgb = ref_image.convert("RGB")

            # Simple pixel comparison
            # Calculate percentage of similar pixels
            import numpy as np

            capture_array = np.array(capture_rgb)
            ref_array = np.array(ref_rgb)

            # Calculate absolute difference
            diff = np.abs(
                capture_array.astype(np.float32) - ref_array.astype(np.float32)
            )

            # Threshold for "similar" pixel (allow some variance)
            threshold = 30  # Max RGB difference per channel

            # Count similar pixels
            similar_pixels = np.all(diff <= threshold, axis=2).sum()
            total_pixels = capture_array.shape[0] * capture_array.shape[1]

            similarity = similar_pixels / total_pixels

            return float(similarity)

        except Exception as e:
            logger.error(
                "similarity_calculation_failed",
                reference_path=reference_path,
                error=str(e),
            )
            return 0.0

    @staticmethod
    async def _calculate_similarity_with_api(
        capture_image: Image.Image, reference_path: str
    ) -> float:
        """
        Calculate similarity using qontinui-api template matching.

        This is more accurate than pixel comparison but requires the API.

        Args:
            capture_image: PIL Image of the captured screenshot
            reference_path: Path to the reference screenshot

        Returns:
            Similarity score between 0.0 and 1.0
        """
        try:
            # Save capture image to bytes
            capture_buffer = io.BytesIO()
            capture_image.save(capture_buffer, format="PNG")
            capture_buffer.seek(0)

            # Load reference image
            ref_key = reference_path.split("/")[-1]
            ref_image_data = object_storage.download_file(ref_key)

            # Call qontinui-api for template matching
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(
                    f"{settings.QONTINUI_API_URL}/find",
                    files={
                        "screenshot": ("screenshot.png", capture_buffer, "image/png"),
                        "template": ("template.png", ref_image_data, "image/png"),
                    },
                    data={"threshold": 0.0},  # Get score even if below threshold
                )

                if response.status_code == 200:
                    result = response.json()
                    # Extract confidence from API response
                    if result.get("found"):
                        confidence = result.get("confidence", 0.0)
                        return float(confidence)
                    return 0.0
                else:
                    logger.warning(
                        "qontinui_api_match_failed",
                        status=response.status_code,
                        reference_path=reference_path,
                    )
                    return 0.0

        except Exception as e:
            logger.error(
                "api_similarity_calculation_failed",
                reference_path=reference_path,
                error=str(e),
            )
            # Fall back to simple pixel comparison
            return await StateMatchingService._calculate_similarity(
                capture_image, reference_path
            )
