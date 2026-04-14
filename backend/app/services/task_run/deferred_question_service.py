"""
Service for Deferred Question operations.

Handles syncing, listing, and reviewing deferred questions
that were raised during autonomous workflow execution.
"""

from datetime import UTC, datetime
from uuid import UUID, uuid4

import structlog
from app.models.task_run import DeferredQuestion
from app.repositories.task_run import DeferredQuestionRepository
from app.services.task_run.mappers import model_to_deferred_question_response
from app.services.task_run.schemas import (DeferredQuestionBatch,
                                           DeferredQuestionResponse,
                                           DeferredQuestionUpdate)
from sqlalchemy.ext.asyncio import AsyncSession

logger = structlog.get_logger(__name__)


class DeferredQuestionService:
    """Service for deferred question operations."""

    def __init__(
        self,
        question_repo: DeferredQuestionRepository | None = None,
    ) -> None:
        """Initialize with repository."""
        self.question_repo = question_repo or DeferredQuestionRepository()

    async def sync_deferred_questions(
        self,
        db: AsyncSession,
        task_run_id: UUID,
        batch: DeferredQuestionBatch,
    ) -> list[DeferredQuestionResponse]:
        """
        Sync a batch of deferred questions (create or update by ID).

        Args:
            db: Database session
            task_run_id: ID of the task run
            batch: Batch of deferred questions to sync

        Returns:
            List of created/updated DeferredQuestionResponse
        """
        results: list[DeferredQuestionResponse] = []

        for q_data in batch.questions:
            # Check for existing question by ID
            existing = None
            if q_data.id:
                existing = await self.question_repo.get_question_by_id(
                    db, UUID(q_data.id)
                )

            if existing:
                # Update mutable fields
                if q_data.status:
                    existing.status = q_data.status
                if q_data.reviewer_comment is not None:
                    existing.reviewer_comment = q_data.reviewer_comment
                if q_data.reviewed_at:
                    existing.reviewed_at = q_data.reviewed_at
                if q_data.contingent_iterations != "[]":
                    existing.contingent_iterations = q_data.contingent_iterations
                await self.question_repo.update_question(db, existing)
                results.append(model_to_deferred_question_response(existing))
            else:
                # Create new deferred question
                dq = DeferredQuestion(
                    id=UUID(q_data.id) if q_data.id else uuid4(),
                    task_run_id=task_run_id,
                    iteration=q_data.iteration,
                    question=q_data.question,
                    context_json=q_data.context_json,
                    auto_decision_type=q_data.auto_decision_type,
                    auto_decision_detail=q_data.auto_decision_detail,
                    confidence=q_data.confidence,
                    risk_level=q_data.risk_level,
                    status=q_data.status,
                    git_checkpoint=q_data.git_checkpoint,
                    contingent_iterations=q_data.contingent_iterations,
                    reviewer_comment=q_data.reviewer_comment,
                    created_at=q_data.created_at or datetime.now(UTC),
                    reviewed_at=q_data.reviewed_at,
                )
                created = await self.question_repo.create_question(db, dq)
                results.append(model_to_deferred_question_response(created))

        await db.commit()

        logger.info(
            "Synced deferred questions",
            task_run_id=str(task_run_id),
            count=len(results),
        )

        return results

    async def list_deferred_questions(
        self,
        db: AsyncSession,
        task_run_id: UUID,
        status_filter: str | None = None,
    ) -> list[DeferredQuestionResponse]:
        """
        List deferred questions for a task run.

        Args:
            db: Database session
            task_run_id: ID of the task run
            status_filter: Optional filter by status

        Returns:
            List of DeferredQuestionResponse
        """
        questions = await self.question_repo.get_questions_for_task_run(
            db, task_run_id, status_filter=status_filter
        )
        return [model_to_deferred_question_response(q) for q in questions]

    async def review_deferred_question(
        self,
        db: AsyncSession,
        task_run_id: UUID,
        question_id: UUID,
        update_data: DeferredQuestionUpdate,
    ) -> DeferredQuestionResponse | None:
        """
        Review a deferred question (update status and comment).

        Args:
            db: Database session
            task_run_id: ID of the task run
            question_id: ID of the deferred question
            update_data: Update data

        Returns:
            Updated DeferredQuestionResponse or None if not found
        """
        question = await self.question_repo.get_question_by_id(db, question_id)
        if not question or question.task_run_id != task_run_id:
            return None

        if update_data.status:
            question.status = update_data.status
        if update_data.reviewer_comment is not None:
            question.reviewer_comment = update_data.reviewer_comment
        question.reviewed_at = datetime.now(UTC)

        await self.question_repo.update_question(db, question)
        await db.commit()
        await db.refresh(question)

        logger.info(
            "Reviewed deferred question",
            task_run_id=str(task_run_id),
            question_id=str(question_id),
            status=question.status,
        )

        return model_to_deferred_question_response(question)
