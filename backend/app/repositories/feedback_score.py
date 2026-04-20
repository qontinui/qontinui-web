"""
Repository for feedback score database operations.

Handles query logic for feedback scores, encapsulating database access
and providing reusable methods for CRUD, listing, and aggregation.
"""

from uuid import UUID

import structlog
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.feedback_score import FeedbackScore

logger = structlog.get_logger(__name__)


class FeedbackScoreRepository:
    """Repository for feedback score database operations."""

    @staticmethod
    async def create(
        db: AsyncSession,
        data: dict,
    ) -> FeedbackScore:
        """
        Create a new feedback score.

        Args:
            db: Database session
            data: Dictionary with feedback score fields including:
                - run_id or action_execution_id (based on target_type)
                - name, value, category_value, source, reason, metadata_, created_by

        Returns:
            Created FeedbackScore instance
        """
        score = FeedbackScore(**data)
        db.add(score)
        await db.commit()
        await db.refresh(score)

        logger.info(
            "feedback_score_created",
            score_id=str(score.id),
            name=score.name,
            source=score.source,
        )

        return score

    @staticmethod
    async def create_batch(
        db: AsyncSession,
        items: list[dict],
    ) -> int:
        """
        Create multiple feedback scores in a single transaction.

        Args:
            db: Database session
            items: List of dicts, each with feedback score fields

        Returns:
            Number of scores created
        """
        scores = [FeedbackScore(**data) for data in items]
        db.add_all(scores)
        await db.commit()

        logger.info(
            "feedback_scores_batch_created",
            count=len(scores),
        )

        return len(scores)

    @staticmethod
    async def get_by_id(
        db: AsyncSession,
        score_id: UUID,
    ) -> FeedbackScore | None:
        """
        Get a feedback score by ID.

        Args:
            db: Database session
            score_id: ID of the feedback score

        Returns:
            FeedbackScore or None if not found
        """
        query = select(FeedbackScore).where(FeedbackScore.id == score_id)
        result = await db.execute(query)
        return result.scalar_one_or_none()

    @staticmethod
    async def list_by_run_id(
        db: AsyncSession,
        run_id: UUID,
    ) -> tuple[list[FeedbackScore], int]:
        """
        List all feedback scores for an execution run.

        Args:
            db: Database session
            run_id: ID of the execution run

        Returns:
            Tuple of (list of FeedbackScore, total count)
        """
        query = select(FeedbackScore).where(FeedbackScore.run_id == run_id)

        # Get total count
        count_query = select(func.count()).select_from(query.subquery())
        total_result = await db.execute(count_query)
        total = total_result.scalar() or 0

        # Order by creation time
        query = query.order_by(FeedbackScore.created_at.desc())

        result = await db.execute(query)
        scores = list(result.scalars().all())

        logger.debug(
            "list_by_run_id_executed",
            run_id=str(run_id),
            total=total,
        )

        return scores, total

    @staticmethod
    async def list_by_action_id(
        db: AsyncSession,
        action_id: UUID,
    ) -> tuple[list[FeedbackScore], int]:
        """
        List all feedback scores for an action execution.

        Args:
            db: Database session
            action_id: ID of the action execution

        Returns:
            Tuple of (list of FeedbackScore, total count)
        """
        query = select(FeedbackScore).where(
            FeedbackScore.action_execution_id == action_id
        )

        # Get total count
        count_query = select(func.count()).select_from(query.subquery())
        total_result = await db.execute(count_query)
        total = total_result.scalar() or 0

        # Order by creation time
        query = query.order_by(FeedbackScore.created_at.desc())

        result = await db.execute(query)
        scores = list(result.scalars().all())

        logger.debug(
            "list_by_action_id_executed",
            action_id=str(action_id),
            total=total,
        )

        return scores, total

    @staticmethod
    async def get_summary_by_run_id(
        db: AsyncSession,
        run_id: UUID,
    ) -> list[dict]:
        """
        Get aggregated summary of feedback scores for an execution run.

        Groups scores by name and computes count, average, min, and max.

        Args:
            db: Database session
            run_id: ID of the execution run

        Returns:
            List of dicts with name, count, avg_value, min_value, max_value
        """
        query = (
            select(
                FeedbackScore.name,
                func.count().label("count"),
                func.avg(FeedbackScore.value).label("avg_value"),
                func.min(FeedbackScore.value).label("min_value"),
                func.max(FeedbackScore.value).label("max_value"),
            )
            .where(FeedbackScore.run_id == run_id)
            .group_by(FeedbackScore.name)
            .order_by(FeedbackScore.name)
        )

        result = await db.execute(query)
        rows = result.all()

        summaries = [
            {
                "name": row.name,
                "count": row.count,
                "avg_value": round(float(row.avg_value), 4),
                "min_value": float(row.min_value),
                "max_value": float(row.max_value),
            }
            for row in rows
        ]

        logger.debug(
            "get_summary_by_run_id_executed",
            run_id=str(run_id),
            summary_count=len(summaries),
        )

        return summaries

    @staticmethod
    async def delete(
        db: AsyncSession,
        score_id: UUID,
    ) -> bool:
        """
        Delete a feedback score by ID.

        Args:
            db: Database session
            score_id: ID of the feedback score to delete

        Returns:
            True if deleted, False if not found
        """
        score = await FeedbackScoreRepository.get_by_id(db, score_id)
        if score is None:
            return False

        await db.delete(score)
        await db.commit()

        logger.info(
            "feedback_score_deleted",
            score_id=str(score_id),
        )

        return True
