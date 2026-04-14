"""
Repository for Task Run Verification Result database operations.

Handles query logic for verification phase results,
encapsulating database access and providing reusable methods
for listing and upserting verification data.
"""

from typing import Any
from uuid import UUID

import structlog
from app.models.task_run_verification_result import TaskRunVerificationResult
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

logger = structlog.get_logger(__name__)


class TaskRunVerificationResultRepository:
    """Repository for task run verification result database operations."""

    @staticmethod
    async def get_results_for_task_run(
        db: AsyncSession,
        task_run_id: UUID,
    ) -> list[TaskRunVerificationResult]:
        """
        Get all verification results for a task run, ordered by iteration.

        Args:
            db: Database session
            task_run_id: ID of the task run

        Returns:
            List of TaskRunVerificationResult ordered by iteration
        """
        query = (
            select(TaskRunVerificationResult)
            .where(TaskRunVerificationResult.task_run_id == task_run_id)
            .order_by(TaskRunVerificationResult.iteration)
        )
        result = await db.execute(query)
        results = list(result.scalars().all())

        logger.debug(
            "get_verification_results_for_task_run",
            task_run_id=str(task_run_id),
            count=len(results),
        )

        return results

    @staticmethod
    async def upsert_result(
        db: AsyncSession,
        task_run_id: UUID,
        iteration: int,
        all_passed: bool,
        total_steps: int,
        passed_steps: int,
        failed_steps: int,
        skipped_steps: int,
        total_duration_ms: int,
        critical_failure: bool,
        result_json: dict[str, Any],
    ) -> TaskRunVerificationResult:
        """
        Upsert a verification result for a (task_run_id, iteration) pair.

        If a result already exists for the given task_run_id and iteration,
        it is updated. Otherwise, a new record is created.

        Does NOT call db.commit() — caller is responsible for committing.

        Args:
            db: Database session
            task_run_id: ID of the task run
            iteration: Iteration number (1-indexed)
            all_passed: Whether all steps passed
            total_steps: Total number of steps
            passed_steps: Number of steps that passed
            failed_steps: Number of steps that failed
            skipped_steps: Number of steps skipped
            total_duration_ms: Total execution time in ms
            critical_failure: Whether a critical gate failure occurred
            result_json: Full VerificationPhaseResult as dict

        Returns:
            Created or updated TaskRunVerificationResult
        """
        # Check if result already exists for this (task_run_id, iteration)
        query = select(TaskRunVerificationResult).where(
            TaskRunVerificationResult.task_run_id == task_run_id,
            TaskRunVerificationResult.iteration == iteration,
        )
        result = await db.execute(query)
        existing = result.scalar_one_or_none()

        if existing:
            # Update existing record
            existing.all_passed = all_passed
            existing.total_steps = total_steps
            existing.passed_steps = passed_steps
            existing.failed_steps = failed_steps
            existing.skipped_steps = skipped_steps
            existing.total_duration_ms = total_duration_ms
            existing.critical_failure = critical_failure
            existing.result_json = result_json

            await db.flush()
            await db.refresh(existing)

            logger.debug(
                "verification_result_updated",
                task_run_id=str(task_run_id),
                iteration=iteration,
                all_passed=all_passed,
            )

            return existing
        else:
            # Create new record
            new_result = TaskRunVerificationResult(
                task_run_id=task_run_id,
                iteration=iteration,
                all_passed=all_passed,
                total_steps=total_steps,
                passed_steps=passed_steps,
                failed_steps=failed_steps,
                skipped_steps=skipped_steps,
                total_duration_ms=total_duration_ms,
                critical_failure=critical_failure,
                result_json=result_json,
            )

            db.add(new_result)
            await db.flush()
            await db.refresh(new_result)

            logger.debug(
                "verification_result_created",
                task_run_id=str(task_run_id),
                iteration=iteration,
                all_passed=all_passed,
            )

            return new_result
