"""
Service for Task Run Automation operations.

Handles creation, updating, retrieval, and step progress
for automation records within task runs.
"""

from datetime import UTC, datetime
from uuid import UUID

import structlog
from app.models.task_run import TaskRunAutomation, TaskRunStatus
from app.repositories.task_run import TaskRunAutomationRepository, TaskRunRepository
from app.services.task_run.mappers import model_to_automation_response
from app.services.task_run.schemas import (
    StepProgressResponse,
    TaskRunAutomationCreate,
    TaskRunAutomationResponse,
    TaskRunAutomationUpdate,
)
from sqlalchemy.ext.asyncio import AsyncSession

logger = structlog.get_logger(__name__)


class TaskRunAutomationService:
    """Service for task run automation operations."""

    def __init__(
        self,
        task_run_repo: TaskRunRepository | None = None,
        automation_repo: TaskRunAutomationRepository | None = None,
    ) -> None:
        """Initialize with repositories."""
        self.task_run_repo = task_run_repo or TaskRunRepository()
        self.automation_repo = automation_repo or TaskRunAutomationRepository()

    async def create_automation(
        self,
        db: AsyncSession,
        task_run_id: UUID,
        automation_data: TaskRunAutomationCreate,
    ) -> TaskRunAutomationResponse | None:
        """
        Create an automation record for a task run.

        Args:
            db: Database session
            task_run_id: ID of the task run
            automation_data: Automation creation data

        Returns:
            Created TaskRunAutomationResponse or None if task not found
        """
        task_run = await self.task_run_repo.get_task_run_by_id(db, task_run_id)
        if not task_run:
            return None

        automation = TaskRunAutomation(
            task_run_id=task_run_id,
            workflow_name=automation_data.workflow_name,
            iteration_number=automation_data.iteration_number,
            started_at=automation_data.started_at or datetime.now(UTC),
        )

        created = await self.automation_repo.create_automation(db, automation)
        await db.commit()
        await db.refresh(created)

        logger.debug(
            "Created task run automation",
            task_run_id=str(task_run_id),
            iteration=automation_data.iteration_number,
        )

        return model_to_automation_response(created)

    async def update_automation(
        self,
        db: AsyncSession,
        task_run_id: UUID,
        automation_id: UUID,
        update_data: TaskRunAutomationUpdate,
    ) -> TaskRunAutomationResponse | None:
        """
        Update an automation record.

        Args:
            db: Database session
            task_run_id: ID of the task run
            automation_id: ID of the automation
            update_data: Update data

        Returns:
            Updated TaskRunAutomationResponse or None if not found
        """
        automations = await self.automation_repo.get_automations_for_task_run(
            db, task_run_id
        )
        automation = next((a for a in automations if a.id == automation_id), None)
        if not automation:
            return None

        if update_data.ended_at is not None:
            automation.ended_at = update_data.ended_at
        if update_data.duration_ms is not None:
            automation.duration_ms = update_data.duration_ms
        if update_data.automation_status is not None:
            automation.automation_status = update_data.automation_status
        if update_data.success is not None:
            automation.success = update_data.success
        if update_data.error_type is not None:
            automation.error_type = update_data.error_type
        if update_data.error_message is not None:
            automation.error_message = update_data.error_message
        if update_data.actions_summary is not None:
            automation.actions_summary = update_data.actions_summary
        if update_data.states_visited is not None:
            automation.states_visited = update_data.states_visited
        if update_data.transitions_executed is not None:
            automation.transitions_executed = update_data.transitions_executed
        if update_data.template_matches is not None:
            automation.template_matches = update_data.template_matches
        if update_data.anomalies is not None:
            automation.anomalies = update_data.anomalies
        if update_data.screenshots is not None:
            automation.screenshots = update_data.screenshots

        await self.automation_repo.update_automation(db, automation)
        await db.commit()
        await db.refresh(automation)

        logger.debug(
            "Updated task run automation",
            task_run_id=str(task_run_id),
            automation_id=str(automation_id),
            status=automation.automation_status,
        )

        return model_to_automation_response(automation)

    async def get_automations(
        self,
        db: AsyncSession,
        task_run_id: UUID,
    ) -> list[TaskRunAutomationResponse]:
        """
        Get all automation records for a task run.

        Args:
            db: Database session
            task_run_id: ID of the task run

        Returns:
            List of TaskRunAutomationResponse
        """
        automations = await self.automation_repo.get_automations_for_task_run(
            db, task_run_id
        )
        return [model_to_automation_response(a) for a in automations]

    async def get_step_progress(
        self,
        db: AsyncSession,
        task_run_id: UUID,
        checkpoint_id: str,
    ) -> StepProgressResponse | None:
        """
        Get real-time progress for a specific execution step.

        This endpoint provides progress information for steps that are currently
        running or have completed. It's used by the frontend to show progress
        indicators during execution.

        Args:
            db: Database session
            task_run_id: ID of the task run
            checkpoint_id: ID of the checkpoint/step

        Returns:
            StepProgressResponse if found, None otherwise

        Note:
            Progress information may come from:
            - Live execution events (via WebSocket or polling)
            - Cached execution state from the runner
            - Historical data from completed executions
        """
        # First verify the task run exists
        task_run = await self.task_run_repo.get_task_run_by_id(db, task_run_id)
        if not task_run:
            logger.warning(
                "Task run not found for step progress",
                task_run_id=str(task_run_id),
                checkpoint_id=checkpoint_id,
            )
            return None

        # Check if task is currently running
        is_running = task_run.status == TaskRunStatus.RUNNING

        # Try to get progress from the latest automation record
        automations = await self.automation_repo.get_automations_for_task_run(
            db, task_run_id
        )

        # Find the most recent automation that matches
        latest_automation = None
        for automation in sorted(
            automations,
            key=lambda a: a.started_at,
            reverse=True,
        ):
            latest_automation = automation
            break

        if latest_automation:
            # Calculate elapsed time from automation start
            elapsed_ms = 0
            if latest_automation.started_at:
                elapsed = datetime.now(UTC) - latest_automation.started_at
                elapsed_ms = int(elapsed.total_seconds() * 1000)
            if latest_automation.duration_ms:
                elapsed_ms = latest_automation.duration_ms

            # Determine phase from automation status
            phase = "executing"
            phase_description = None
            if latest_automation.automation_status:
                phase = latest_automation.automation_status.lower()
                if phase == "running":
                    phase_description = "Executing automation workflow"
                elif phase == "completed":
                    phase_description = "Automation completed successfully"
                elif phase == "failed":
                    phase_description = "Automation failed"

            return StepProgressResponse(
                phase=phase,
                phase_description=phase_description,
                substep=latest_automation.workflow_name,
                progress=None,  # Indeterminate progress for now
                message=latest_automation.actions_summary,
                elapsed_ms=elapsed_ms,
                is_running=is_running
                and latest_automation.automation_status == "running",
                error=latest_automation.error_message,
                metadata={
                    "automation_id": str(latest_automation.id),
                    "iteration": latest_automation.iteration_number,
                    "success": latest_automation.success,
                },
            )

        # No automation found, return basic progress based on task status
        elapsed_ms = 0
        if task_run.created_at:
            elapsed = datetime.now(UTC) - task_run.created_at
            elapsed_ms = int(elapsed.total_seconds() * 1000)
        if task_run.duration_seconds:
            elapsed_ms = task_run.duration_seconds * 1000

        phase = "pending"
        phase_description = None
        if task_run.status == TaskRunStatus.RUNNING:
            phase = "running"
            phase_description = "Task is running"
        elif task_run.status == TaskRunStatus.COMPLETE:
            phase = "completed"
            phase_description = "Task completed"
        elif task_run.status == TaskRunStatus.FAILED:
            phase = "failed"
            phase_description = "Task failed"

        return StepProgressResponse(
            phase=phase,
            phase_description=phase_description,
            substep=task_run.task_name,
            progress=None,
            message=task_run.output_summary,
            elapsed_ms=elapsed_ms,
            is_running=is_running,
            error=task_run.error_message,
            metadata={
                "task_run_id": str(task_run.id),
                "sessions_count": task_run.sessions_count,
            },
        )
