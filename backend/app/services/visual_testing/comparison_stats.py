"""
Comparison statistics.

Provides run-level and project-level comparison statistics.
"""

from uuid import UUID

import structlog
from app.models.software_test_run import SoftwareTestRun
from app.models.visual_baseline import VisualBaseline
from app.models.visual_comparison_result import (
    VisualComparisonResult,
    VisualComparisonStatus,
)
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

logger = structlog.get_logger(__name__)


class ComparisonStats:
    """Statistics for visual comparison results."""

    async def get_run_comparison_stats(
        self,
        db: AsyncSession,
        test_run_id: UUID,
    ) -> dict:
        """
        Get comparison statistics for a test run.

        Args:
            db: Database session
            test_run_id: Test run ID

        Returns:
            Dictionary with statistics
        """
        from sqlalchemy import func

        result = await db.execute(
            select(
                VisualComparisonResult.status,
                func.count(VisualComparisonResult.id),
            )
            .where(VisualComparisonResult.test_run_id == test_run_id)
            .group_by(VisualComparisonResult.status)
        )

        stats: dict[str, int | float] = {
            status.value: 0 for status in VisualComparisonStatus
        }
        for status, count in result.all():
            stats[status.value] = count

        stats["total"] = sum(stats.values())
        stats["pass_rate"] = (
            stats[VisualComparisonStatus.PASSED.value] / stats["total"]
            if stats["total"] > 0
            else 0.0
        )

        return stats

    async def get_project_comparison_stats(
        self,
        db: AsyncSession,
        project_id: UUID,
    ) -> dict:
        """
        Get comparison statistics for a project.

        Args:
            db: Database session
            project_id: Project ID

        Returns:
            Dictionary with statistics
        """
        from sqlalchemy import func

        result = await db.execute(
            select(
                VisualComparisonResult.status,
                func.count(VisualComparisonResult.id),
            )
            .join(SoftwareTestRun)
            .where(SoftwareTestRun.project_id == project_id)
            .group_by(VisualComparisonResult.status)
        )

        stats = {status.value: 0 for status in VisualComparisonStatus}
        for status, count in result.all():
            stats[status.value] = count

        stats["total"] = sum(stats.values())
        stats["pending_review_count"] = stats[
            VisualComparisonStatus.PENDING_REVIEW.value
        ]

        # Get baseline count
        baseline_result = await db.execute(
            select(func.count(VisualBaseline.id)).where(
                and_(
                    VisualBaseline.project_id == project_id,
                    VisualBaseline.is_active.is_(True),
                )
            )
        )
        stats["active_baselines"] = baseline_result.scalar() or 0

        return stats
