"""
Baseline creation operations.

Handles creating baselines from screenshots and uploaded images.
"""

import io
from datetime import datetime
from uuid import UUID

import structlog
from PIL import Image
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.test_screenshot import TestScreenshot
from app.models.visual_baseline import VisualBaseline
from app.services.visual_testing.baseline_image_processing import (
    BaselineImageProcessing,
)

logger = structlog.get_logger(__name__)


class BaselineCreation(BaselineImageProcessing):
    """Operations for creating visual baselines."""

    async def create_from_screenshot(
        self,
        db: AsyncSession,
        project_id: UUID,
        state_name: str,
        screenshot_id: UUID,
        user_id: UUID,
        workflow_id: str | None = None,
        comparison_settings: dict | None = None,
        approval_notes: str | None = None,
    ) -> VisualBaseline:
        """
        Create a new baseline from an existing test screenshot.

        Args:
            db: Database session
            project_id: Project ID
            state_name: State name for the baseline
            screenshot_id: Source screenshot ID
            user_id: User creating/approving the baseline
            workflow_id: Optional workflow ID to scope baseline
            comparison_settings: Comparison configuration
            approval_notes: Optional notes

        Returns:
            Created VisualBaseline

        Raises:
            ValueError: If screenshot not found
        """
        logger.info(
            "creating_baseline_from_screenshot",
            project_id=str(project_id),
            state_name=state_name,
            screenshot_id=str(screenshot_id),
        )

        # Get the source screenshot
        result = await db.execute(
            select(TestScreenshot).where(TestScreenshot.id == screenshot_id)
        )
        screenshot = result.scalar_one_or_none()

        if not screenshot:
            raise ValueError(f"Screenshot not found: {screenshot_id}")

        # Deactivate any existing active baselines for this state
        await self._deactivate_existing_baselines(
            db, project_id, state_name, workflow_id
        )

        # Get next version number
        version = await self._get_next_version(db, project_id, state_name, workflow_id)

        # Download screenshot, compute hash, and create thumbnail
        try:
            # Get image bytes from storage
            image_bytes = await self._download_image(screenshot.storage_path)

            # Compute perceptual hash
            perceptual_hash = await self._compute_perceptual_hash(image_bytes)

            # Create thumbnail and upload
            thumbnail_bytes = await self._create_thumbnail(image_bytes)
            thumbnail_path = await self._upload_baseline_image(
                project_id, state_name, version, thumbnail_bytes, is_thumbnail=True
            )

            # Copy screenshot to baseline storage
            storage_path = await self._upload_baseline_image(
                project_id, state_name, version, image_bytes, is_thumbnail=False
            )

        except Exception as e:
            logger.error(
                "baseline_image_processing_failed",
                screenshot_id=str(screenshot_id),
                error=str(e),
            )
            # Fallback: use screenshot's storage path directly
            storage_path = screenshot.storage_path
            thumbnail_path = None
            perceptual_hash = screenshot.perceptual_hash

        # Default comparison settings
        if comparison_settings is None:
            comparison_settings = {
                "algorithm": "ssim",
                "threshold": 0.95,
                "ignore_regions": [],
            }

        # Create the baseline
        baseline = VisualBaseline(
            project_id=project_id,
            state_name=state_name,
            workflow_id=workflow_id,
            storage_path=storage_path,
            thumbnail_path=thumbnail_path,
            width=screenshot.width,
            height=screenshot.height,
            perceptual_hash=perceptual_hash,
            version=version,
            is_active=True,
            approved_by_user_id=user_id,
            approved_at=datetime.utcnow(),
            approval_notes=approval_notes,
            comparison_settings=comparison_settings,
            source_test_run_id=screenshot.test_run_id,
            source_screenshot_id=screenshot_id,
        )

        db.add(baseline)
        await db.flush()
        await db.refresh(baseline)

        logger.info(
            "baseline_created_from_screenshot",
            baseline_id=str(baseline.id),
            state_name=state_name,
            version=version,
        )

        return baseline

    async def create_from_upload(
        self,
        db: AsyncSession,
        project_id: UUID,
        state_name: str,
        image_bytes: bytes,
        user_id: UUID,
        workflow_id: str | None = None,
        comparison_settings: dict | None = None,
        approval_notes: str | None = None,
    ) -> VisualBaseline:
        """
        Create a new baseline from an uploaded image.

        Args:
            db: Database session
            project_id: Project ID
            state_name: State name for the baseline
            image_bytes: Raw image bytes (PNG/JPEG)
            user_id: User creating/approving the baseline
            workflow_id: Optional workflow ID to scope baseline
            comparison_settings: Comparison configuration
            approval_notes: Optional notes

        Returns:
            Created VisualBaseline

        Raises:
            ValueError: If image data is invalid
        """
        logger.info(
            "creating_baseline_from_upload",
            project_id=str(project_id),
            state_name=state_name,
            image_size=len(image_bytes),
        )

        # Validate and extract image dimensions
        try:
            image_file = io.BytesIO(image_bytes)
            with Image.open(image_file) as img:
                width, height = img.size
                # Ensure PNG format for storage
                if img.format != "PNG":
                    png_buffer = io.BytesIO()
                    img.save(png_buffer, format="PNG")
                    image_bytes = png_buffer.getvalue()
        except Exception as e:
            raise ValueError(f"Invalid image data: {str(e)}")

        # Deactivate existing baselines
        await self._deactivate_existing_baselines(
            db, project_id, state_name, workflow_id
        )

        # Get next version
        version = await self._get_next_version(db, project_id, state_name, workflow_id)

        # Compute perceptual hash
        perceptual_hash = await self._compute_perceptual_hash(image_bytes)

        # Create thumbnail
        thumbnail_bytes = await self._create_thumbnail(image_bytes)

        # Upload images
        storage_path = await self._upload_baseline_image(
            project_id, state_name, version, image_bytes, is_thumbnail=False
        )
        thumbnail_path = await self._upload_baseline_image(
            project_id, state_name, version, thumbnail_bytes, is_thumbnail=True
        )

        # Default comparison settings
        if comparison_settings is None:
            comparison_settings = {
                "algorithm": "ssim",
                "threshold": 0.95,
                "ignore_regions": [],
            }

        # Create the baseline
        baseline = VisualBaseline(
            project_id=project_id,
            state_name=state_name,
            workflow_id=workflow_id,
            storage_path=storage_path,
            thumbnail_path=thumbnail_path,
            width=width,
            height=height,
            file_size_bytes=len(image_bytes),
            perceptual_hash=perceptual_hash,
            version=version,
            is_active=True,
            approved_by_user_id=user_id,
            approved_at=datetime.utcnow(),
            approval_notes=approval_notes,
            comparison_settings=comparison_settings,
        )

        db.add(baseline)
        await db.flush()
        await db.refresh(baseline)

        logger.info(
            "baseline_created_from_upload",
            baseline_id=str(baseline.id),
            state_name=state_name,
            version=version,
        )

        return baseline
