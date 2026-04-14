"""
Service for Task Run Finding operations.

Handles syncing, querying, updating, and user responses
for findings detected during task runs.
"""

from uuid import UUID

import structlog
from app.models.task_run import (FindingActionType, FindingCategory,
                                 FindingSeverity, FindingStatus,
                                 TaskRunFinding)
from app.repositories.task_run import TaskRunFindingRepository
from app.services.task_run.mappers import (_get_enum_value,
                                           model_to_finding_response)
from app.services.task_run.schemas import (TaskRunFindingResponse,
                                           TaskRunFindingsBatch,
                                           TaskRunFindingsListResponse,
                                           TaskRunFindingUpdate)
from sqlalchemy.ext.asyncio import AsyncSession

logger = structlog.get_logger(__name__)


class TaskRunFindingService:
    """Service for task run finding operations."""

    def __init__(
        self,
        finding_repo: TaskRunFindingRepository | None = None,
    ) -> None:
        """Initialize with repository."""
        self.finding_repo = finding_repo or TaskRunFindingRepository()

    async def sync_findings(
        self,
        db: AsyncSession,
        task_run_id: UUID,
        batch: TaskRunFindingsBatch,
    ) -> list[TaskRunFindingResponse]:
        """
        Sync a batch of findings (create or update based on signature_hash).

        Args:
            db: Database session
            task_run_id: ID of the task run
            batch: Batch of findings to sync

        Returns:
            List of created/updated TaskRunFindingResponse
        """
        results: list[TaskRunFindingResponse] = []

        for finding_data in batch.findings:
            # Check for existing finding by signature
            existing = None
            if finding_data.signature_hash:
                existing = await self.finding_repo.get_finding_by_signature(
                    db, task_run_id, finding_data.signature_hash
                )

            if existing:
                # Update existing finding
                if finding_data.status:
                    existing.status = FindingStatus(finding_data.status)
                if finding_data.resolution:
                    existing.resolution = finding_data.resolution
                await self.finding_repo.update_finding(db, existing)
                results.append(model_to_finding_response(existing))
            else:
                # Create new finding
                finding = TaskRunFinding(
                    id=finding_data.id,
                    task_run_id=task_run_id,
                    category=FindingCategory(finding_data.category),
                    severity=FindingSeverity(finding_data.severity),
                    status=FindingStatus(finding_data.status),
                    action_type=FindingActionType(finding_data.action_type),
                    signature_hash=finding_data.signature_hash,
                    title=finding_data.title,
                    description=finding_data.description,
                    resolution=finding_data.resolution,
                    file_path=finding_data.file_path,
                    line_number=finding_data.line_number,
                    column_number=finding_data.column_number,
                    code_snippet=finding_data.code_snippet,
                    detected_in_session=finding_data.detected_in_session,
                    needs_input=finding_data.needs_input,
                    question=finding_data.question,
                    input_options=finding_data.input_options,
                )
                created = await self.finding_repo.create_finding(db, finding)
                results.append(model_to_finding_response(created))

        await db.commit()

        logger.info(
            "Synced task run findings",
            task_run_id=str(task_run_id),
            count=len(results),
        )

        return results

    async def get_findings(
        self,
        db: AsyncSession,
        task_run_id: UUID,
        category: str | None = None,
        severity: str | None = None,
        status: str | None = None,
    ) -> TaskRunFindingsListResponse:
        """
        Get findings for a task run with optional filtering.

        Args:
            db: Database session
            task_run_id: ID of the task run
            category: Optional filter by category
            severity: Optional filter by severity
            status: Optional filter by status

        Returns:
            TaskRunFindingsListResponse with findings and summary
        """
        category_enum = FindingCategory(category) if category else None
        severity_enum = FindingSeverity(severity) if severity else None
        status_enum = FindingStatus(status) if status else None

        findings = await self.finding_repo.get_findings_for_task_run(
            db,
            task_run_id=task_run_id,
            category=category_enum,
            severity=severity_enum,
            status=status_enum,
        )

        summary = await self.finding_repo.get_finding_summary(db, task_run_id)

        return TaskRunFindingsListResponse(
            findings=[model_to_finding_response(f) for f in findings],
            summary=summary,
        )

    async def update_finding(
        self,
        db: AsyncSession,
        task_run_id: UUID,
        finding_id: UUID,
        update_data: TaskRunFindingUpdate,
    ) -> TaskRunFindingResponse | None:
        """
        Update a finding.

        Args:
            db: Database session
            task_run_id: ID of the task run
            finding_id: ID of the finding
            update_data: Update data

        Returns:
            Updated TaskRunFindingResponse or None if not found
        """
        finding = await self.finding_repo.get_finding_by_id(db, finding_id)
        if not finding or finding.task_run_id != task_run_id:
            return None

        if update_data.status:
            finding.status = FindingStatus(update_data.status)
        if update_data.resolution is not None:
            finding.resolution = update_data.resolution
        if update_data.resolved_in_session is not None:
            finding.resolved_in_session = update_data.resolved_in_session
        if update_data.resolved_at is not None:
            finding.resolved_at = update_data.resolved_at
        if update_data.user_response is not None:
            finding.user_response = update_data.user_response

        await self.finding_repo.update_finding(db, finding)
        await db.commit()
        await db.refresh(finding)

        logger.info(
            "Updated task run finding",
            task_run_id=str(task_run_id),
            finding_id=str(finding_id),
            status=_get_enum_value(finding.status),
        )

        return model_to_finding_response(finding)

    async def submit_finding_response(
        self,
        db: AsyncSession,
        task_run_id: UUID,
        finding_id: UUID,
        response: str,
    ) -> TaskRunFindingResponse | None:
        """
        Submit a user response to a finding that needs input.

        Args:
            db: Database session
            task_run_id: ID of the task run
            finding_id: ID of the finding
            response: User's response

        Returns:
            Updated TaskRunFindingResponse or None if not found
        """
        finding = await self.finding_repo.get_finding_by_id(db, finding_id)
        if not finding or finding.task_run_id != task_run_id:
            return None

        finding.user_response = response
        finding.needs_input = False  # Mark as no longer needing input

        await self.finding_repo.update_finding(db, finding)
        await db.commit()
        await db.refresh(finding)

        logger.info(
            "Submitted finding response",
            task_run_id=str(task_run_id),
            finding_id=str(finding_id),
        )

        return model_to_finding_response(finding)
