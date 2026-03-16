"""
Baseline version history and rollback operations.

Handles viewing version history and rolling back to previous versions.
"""

from datetime import UTC, datetime
from uuid import UUID

import structlog
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.visual_baseline import VisualBaseline
from app.services.visual_testing.baseline_crud import BaselineCrud
from app.services.visual_testing.baseline_image_processing import (
    BaselineImageProcessing,
)

logger = structlog.get_logger(__name__)


class BaselineHistory(BaselineCrud, BaselineImageProcessing):
    """Version history and rollback operations for visual baselines."""

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
                    (
                        VisualBaseline.workflow_id == current.workflow_id
                        if current.workflow_id
                        else VisualBaseline.workflow_id.is_(None)
                    ),
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
        target.updated_at = datetime.now(UTC)

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
