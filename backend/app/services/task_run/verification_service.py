"""
Service for Task Run Verification Result operations.

Handles upserting, batch upserting, and listing verification phase
results for task runs. Uses shared Pydantic schemas from qontinui-schemas.
"""

from uuid import UUID

import structlog
from qontinui_schemas.execution.verification_result import (
    VerificationResultCreate,
    VerificationResultResponse,
    VerificationResultsBatchRequest,
    VerificationResultsListResponse,
)
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.task_run_verification_result import TaskRunVerificationResult
from app.repositories.task_run_verification_result import (
    TaskRunVerificationResultRepository,
)

logger = structlog.get_logger(__name__)


def model_to_verification_result_response(
    model: TaskRunVerificationResult,
) -> VerificationResultResponse:
    """Map a TaskRunVerificationResult model to a VerificationResultResponse."""
    return VerificationResultResponse(
        id=model.id,
        task_run_id=model.task_run_id,
        iteration=model.iteration,
        all_passed=model.all_passed,
        total_steps=model.total_steps,
        passed_steps=model.passed_steps,
        failed_steps=model.failed_steps,
        skipped_steps=model.skipped_steps,
        total_duration_ms=model.total_duration_ms,
        critical_failure=model.critical_failure,
        result_json=model.result_json,
        created_at=model.created_at,
    )


class TaskRunVerificationService:
    """Service for task run verification result operations."""

    def __init__(
        self,
        repo: TaskRunVerificationResultRepository | None = None,
    ) -> None:
        """Initialize with repository."""
        self.repo = repo or TaskRunVerificationResultRepository()

    async def upsert_verification_result(
        self,
        db: AsyncSession,
        task_run_id: UUID,
        data: VerificationResultCreate,
    ) -> VerificationResultResponse:
        """
        Upsert a single verification result.

        Args:
            db: Database session
            task_run_id: ID of the task run
            data: Verification result data to upsert

        Returns:
            VerificationResultResponse for the created/updated record
        """
        result = data.result
        model = await self.repo.upsert_result(
            db=db,
            task_run_id=task_run_id,
            iteration=data.iteration,
            all_passed=result.all_passed,
            total_steps=result.total_steps,
            passed_steps=result.passed_steps,
            failed_steps=result.failed_steps,
            skipped_steps=result.skipped_steps,
            total_duration_ms=result.total_duration_ms,
            critical_failure=result.critical_failure,
            result_json=result.model_dump(),
        )
        return model_to_verification_result_response(model)

    async def batch_upsert_verification_results(
        self,
        db: AsyncSession,
        task_run_id: UUID,
        batch: VerificationResultsBatchRequest,
    ) -> list[VerificationResultResponse]:
        """
        Batch upsert verification results for a task run.

        Upserts each result in the batch and commits once at the end.

        Args:
            db: Database session
            task_run_id: ID of the task run
            batch: Batch of verification results to upsert

        Returns:
            List of VerificationResultResponse for created/updated records
        """
        responses: list[VerificationResultResponse] = []

        for item in batch.results:
            result = item.result
            model = await self.repo.upsert_result(
                db=db,
                task_run_id=task_run_id,
                iteration=item.iteration,
                all_passed=result.all_passed,
                total_steps=result.total_steps,
                passed_steps=result.passed_steps,
                failed_steps=result.failed_steps,
                skipped_steps=result.skipped_steps,
                total_duration_ms=result.total_duration_ms,
                critical_failure=result.critical_failure,
                result_json=result.model_dump(),
            )
            responses.append(model_to_verification_result_response(model))

        await db.commit()

        logger.info(
            "batch_upsert_verification_results",
            task_run_id=str(task_run_id),
            count=len(responses),
        )

        return responses

    async def list_verification_results(
        self,
        db: AsyncSession,
        task_run_id: UUID,
    ) -> VerificationResultsListResponse:
        """
        List all verification results for a task run.

        Returns results ordered by iteration, with summary statistics.

        Args:
            db: Database session
            task_run_id: ID of the task run

        Returns:
            VerificationResultsListResponse with results and summary stats
        """
        models = await self.repo.get_results_for_task_run(db, task_run_id)

        results = [model_to_verification_result_response(m) for m in models]
        passed_iterations = sum(1 for m in models if m.all_passed)
        failed_iterations = sum(1 for m in models if not m.all_passed)

        return VerificationResultsListResponse(
            task_run_id=task_run_id,
            results=results,
            count=len(results),
            passed_iterations=passed_iterations,
            failed_iterations=failed_iterations,
        )
