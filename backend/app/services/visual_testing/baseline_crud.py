"""
Baseline CRUD operations.

Handles get, list, update settings, delete, and URL generation for baselines.
"""

from datetime import UTC, datetime
from uuid import UUID

import structlog
from app.models.visual_baseline import VisualBaseline
from app.services.object_storage import object_storage
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

logger = structlog.get_logger(__name__)


class BaselineCrud:
    """CRUD operations for visual baselines."""

    def __init__(self):
        self.storage = object_storage

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
            VisualBaseline.is_active.is_(True),
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

        baseline.updated_at = datetime.now(UTC)

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
            baseline.updated_at = datetime.now(UTC)

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
