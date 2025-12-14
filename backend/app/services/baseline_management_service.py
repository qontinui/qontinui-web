"""
Baseline management service for visual regression testing.

Provides operations for creating, updating, and managing visual baselines:
- Create baselines from test screenshots or uploaded images
- Get active baseline for a state
- Update baselines with version history
- List and filter baselines
- Rollback to previous versions
"""

import io
from datetime import datetime
from typing import Any
from uuid import UUID

import structlog
from PIL import Image
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.test_screenshot import TestScreenshot
from app.models.visual_baseline import VisualBaseline
from app.services.object_storage import object_storage

logger = structlog.get_logger(__name__)


# Storage paths for baselines
BASELINE_STORAGE_PREFIX = "visual-baselines"
THUMBNAIL_SIZE = (200, 200)


class BaselineManagementService:
    """Service for managing visual regression baselines."""

    def __init__(self):
        """Initialize the baseline management service."""
        self.storage = object_storage

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

    async def get_baseline_for_state(
        self,
        db: AsyncSession,
        project_id: UUID,
        state_name: str,
        workflow_id: str | None = None,
    ) -> VisualBaseline | None:
        """
        Get the active baseline for a state.

        Args:
            db: Database session
            project_id: Project ID
            state_name: State name to look up
            workflow_id: Optional workflow ID for scoped lookup

        Returns:
            Active VisualBaseline or None if no baseline exists
        """
        conditions = [
            VisualBaseline.project_id == project_id,
            VisualBaseline.state_name == state_name,
            VisualBaseline.is_active == True,
        ]

        # If workflow_id provided, try to find workflow-specific baseline first
        if workflow_id:
            result = await db.execute(
                select(VisualBaseline).where(
                    and_(
                        *conditions,
                        VisualBaseline.workflow_id == workflow_id,
                    )
                )
            )
            baseline = result.scalar_one_or_none()
            if baseline:
                return baseline

        # Fall back to project-wide baseline (workflow_id is NULL)
        result = await db.execute(
            select(VisualBaseline).where(
                and_(
                    *conditions,
                    VisualBaseline.workflow_id.is_(None),
                )
            )
        )
        return result.scalar_one_or_none()

    async def get_baseline_by_id(
        self,
        db: AsyncSession,
        baseline_id: UUID,
    ) -> VisualBaseline | None:
        """
        Get a baseline by ID.

        Args:
            db: Database session
            baseline_id: Baseline ID

        Returns:
            VisualBaseline or None if not found
        """
        result = await db.execute(
            select(VisualBaseline).where(VisualBaseline.id == baseline_id)
        )
        return result.scalar_one_or_none()

    async def update_baseline_settings(
        self,
        db: AsyncSession,
        baseline_id: UUID,
        comparison_settings: dict | None = None,
        approval_notes: str | None = None,
    ) -> VisualBaseline:
        """
        Update baseline comparison settings.

        Args:
            db: Database session
            baseline_id: Baseline ID
            comparison_settings: New comparison settings
            approval_notes: New approval notes

        Returns:
            Updated VisualBaseline

        Raises:
            ValueError: If baseline not found
        """
        baseline = await self.get_baseline_by_id(db, baseline_id)
        if not baseline:
            raise ValueError(f"Baseline not found: {baseline_id}")

        if comparison_settings is not None:
            baseline.comparison_settings = comparison_settings

        if approval_notes is not None:
            baseline.approval_notes = approval_notes

        baseline.updated_at = datetime.utcnow()

        await db.flush()
        await db.refresh(baseline)

        logger.info(
            "baseline_settings_updated",
            baseline_id=str(baseline_id),
        )

        return baseline

    async def list_baselines(
        self,
        db: AsyncSession,
        project_id: UUID,
        state_name: str | None = None,
        workflow_id: str | None = None,
        is_active: bool | None = True,
        skip: int = 0,
        limit: int = 100,
    ) -> list[VisualBaseline]:
        """
        List baselines with optional filters.

        Args:
            db: Database session
            project_id: Project ID
            state_name: Optional state name filter
            workflow_id: Optional workflow ID filter
            is_active: Optional active status filter (default: True)
            skip: Pagination offset
            limit: Maximum results

        Returns:
            List of VisualBaseline records
        """
        conditions = [VisualBaseline.project_id == project_id]

        if state_name:
            conditions.append(VisualBaseline.state_name == state_name)
        if workflow_id:
            conditions.append(VisualBaseline.workflow_id == workflow_id)
        if is_active is not None:
            conditions.append(VisualBaseline.is_active == is_active)

        result = await db.execute(
            select(VisualBaseline)
            .where(and_(*conditions))
            .order_by(VisualBaseline.state_name, VisualBaseline.version.desc())
            .offset(skip)
            .limit(limit)
        )

        return list(result.scalars().all())

    async def get_baseline_history(
        self,
        db: AsyncSession,
        project_id: UUID,
        state_name: str,
        workflow_id: str | None = None,
    ) -> list[VisualBaseline]:
        """
        Get version history for a state's baselines.

        Args:
            db: Database session
            project_id: Project ID
            state_name: State name
            workflow_id: Optional workflow ID

        Returns:
            List of all baseline versions, newest first
        """
        conditions = [
            VisualBaseline.project_id == project_id,
            VisualBaseline.state_name == state_name,
        ]

        if workflow_id:
            conditions.append(VisualBaseline.workflow_id == workflow_id)

        result = await db.execute(
            select(VisualBaseline)
            .where(and_(*conditions))
            .order_by(VisualBaseline.version.desc())
        )

        return list(result.scalars().all())

    async def rollback_baseline(
        self,
        db: AsyncSession,
        baseline_id: UUID,
        target_version: int,
        user_id: UUID,
    ) -> VisualBaseline:
        """
        Rollback a baseline to a previous version.

        This deactivates the current version and activates the target version.

        Args:
            db: Database session
            baseline_id: Current baseline ID (to identify state)
            target_version: Version number to rollback to
            user_id: User performing the rollback

        Returns:
            The activated baseline version

        Raises:
            ValueError: If baseline or target version not found
        """
        # Get the current baseline to identify the state
        current = await self.get_baseline_by_id(db, baseline_id)
        if not current:
            raise ValueError(f"Baseline not found: {baseline_id}")

        # Find the target version
        result = await db.execute(
            select(VisualBaseline).where(
                and_(
                    VisualBaseline.project_id == current.project_id,
                    VisualBaseline.state_name == current.state_name,
                    VisualBaseline.workflow_id == current.workflow_id
                    if current.workflow_id
                    else VisualBaseline.workflow_id.is_(None),
                    VisualBaseline.version == target_version,
                )
            )
        )
        target = result.scalar_one_or_none()

        if not target:
            raise ValueError(
                f"Target version {target_version} not found for state {current.state_name}"
            )

        # Deactivate all versions for this state
        await self._deactivate_existing_baselines(
            db, current.project_id, current.state_name, current.workflow_id
        )

        # Activate the target version
        target.is_active = True
        target.updated_at = datetime.utcnow()

        await db.flush()
        await db.refresh(target)

        logger.info(
            "baseline_rolled_back",
            baseline_id=str(baseline_id),
            state_name=current.state_name,
            from_version=current.version,
            to_version=target_version,
            user_id=str(user_id),
        )

        return target

    async def delete_baseline(
        self,
        db: AsyncSession,
        baseline_id: UUID,
        hard_delete: bool = False,
    ) -> bool:
        """
        Delete a baseline (soft delete by default).

        Args:
            db: Database session
            baseline_id: Baseline ID
            hard_delete: If True, permanently delete; otherwise soft delete

        Returns:
            True if deleted successfully
        """
        baseline = await self.get_baseline_by_id(db, baseline_id)
        if not baseline:
            return False

        if hard_delete:
            # Delete storage files
            try:
                self.storage.delete_file(baseline.storage_path)
                if baseline.thumbnail_path:
                    self.storage.delete_file(baseline.thumbnail_path)
            except Exception as e:
                logger.warning(
                    "baseline_storage_cleanup_failed",
                    baseline_id=str(baseline_id),
                    error=str(e),
                )

            await db.delete(baseline)
        else:
            # Soft delete - just deactivate
            baseline.is_active = False
            baseline.updated_at = datetime.utcnow()

        await db.flush()

        logger.info(
            "baseline_deleted",
            baseline_id=str(baseline_id),
            hard_delete=hard_delete,
        )

        return True

    async def get_baseline_url(
        self, baseline: VisualBaseline, expiration: int = 3600
    ) -> str:
        """
        Get a presigned URL for accessing baseline image.

        Args:
            baseline: VisualBaseline record
            expiration: URL expiration in seconds

        Returns:
            Presigned URL
        """
        return self.storage.generate_presigned_url(baseline.storage_path, expiration)

    async def get_thumbnail_url(
        self, baseline: VisualBaseline, expiration: int = 3600
    ) -> str | None:
        """
        Get a presigned URL for accessing baseline thumbnail.

        Args:
            baseline: VisualBaseline record
            expiration: URL expiration in seconds

        Returns:
            Presigned URL or None if no thumbnail
        """
        if not baseline.thumbnail_path:
            return None
        return self.storage.generate_presigned_url(baseline.thumbnail_path, expiration)

    # Helper methods

    async def _deactivate_existing_baselines(
        self,
        db: AsyncSession,
        project_id: UUID,
        state_name: str,
        workflow_id: str | None,
    ) -> None:
        """Deactivate all existing baselines for a state."""
        conditions = [
            VisualBaseline.project_id == project_id,
            VisualBaseline.state_name == state_name,
            VisualBaseline.is_active == True,
        ]

        if workflow_id:
            conditions.append(VisualBaseline.workflow_id == workflow_id)
        else:
            conditions.append(VisualBaseline.workflow_id.is_(None))

        result = await db.execute(
            select(VisualBaseline).where(and_(*conditions))
        )

        for baseline in result.scalars().all():
            baseline.is_active = False
            baseline.updated_at = datetime.utcnow()

        await db.flush()

    async def _get_next_version(
        self,
        db: AsyncSession,
        project_id: UUID,
        state_name: str,
        workflow_id: str | None,
    ) -> int:
        """Get the next version number for a state's baseline."""
        from sqlalchemy import func

        conditions = [
            VisualBaseline.project_id == project_id,
            VisualBaseline.state_name == state_name,
        ]

        if workflow_id:
            conditions.append(VisualBaseline.workflow_id == workflow_id)
        else:
            conditions.append(VisualBaseline.workflow_id.is_(None))

        result = await db.execute(
            select(func.max(VisualBaseline.version)).where(and_(*conditions))
        )
        max_version = result.scalar()

        return (max_version or 0) + 1

    async def _download_image(self, storage_path: str) -> bytes:
        """Download image bytes from storage."""
        # Use the storage backend to download
        return self.storage.download_file(storage_path)

    async def _compute_perceptual_hash(self, image_bytes: bytes) -> str | None:
        """Compute perceptual hash for an image."""
        try:
            # Lazy import to handle optional dependency
            from qontinui.vision.comparison import VisualComparator

            comparator = VisualComparator()
            image_file = io.BytesIO(image_bytes)
            with Image.open(image_file) as img:
                import numpy as np
                img_array = np.array(img.convert("RGB"))
                return comparator.compute_perceptual_hash(img_array)
        except ImportError:
            logger.warning("qontinui library not available for perceptual hash")
            return None
        except Exception as e:
            logger.warning("perceptual_hash_computation_failed", error=str(e))
            return None

    async def _create_thumbnail(self, image_bytes: bytes) -> bytes:
        """Create a thumbnail from image bytes."""
        image_file = io.BytesIO(image_bytes)
        with Image.open(image_file) as img:
            img.thumbnail(THUMBNAIL_SIZE, Image.Resampling.LANCZOS)
            thumb_buffer = io.BytesIO()
            img.save(thumb_buffer, format="PNG")
            return thumb_buffer.getvalue()

    async def _upload_baseline_image(
        self,
        project_id: UUID,
        state_name: str,
        version: int,
        image_bytes: bytes,
        is_thumbnail: bool,
    ) -> str:
        """Upload a baseline image to storage."""
        # Sanitize state_name for filename
        safe_state_name = "".join(
            c if c.isalnum() or c in "-_" else "_" for c in state_name
        )

        timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
        suffix = "_thumb" if is_thumbnail else ""
        filename = f"v{version}_{timestamp}{suffix}.png"

        prefix = f"{BASELINE_STORAGE_PREFIX}/{project_id}/{safe_state_name}"

        image_file = io.BytesIO(image_bytes)
        storage_key, storage_url = self.storage.upload_file(
            file_obj=image_file,
            prefix=prefix,
            filename=filename,
            content_type="image/png",
            metadata={
                "project_id": str(project_id),
                "state_name": state_name,
                "version": str(version),
                "is_thumbnail": str(is_thumbnail),
            },
            generate_unique_name=False,
        )

        return storage_key


# Singleton instance
baseline_management_service = BaselineManagementService()
