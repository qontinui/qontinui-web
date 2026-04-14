"""
Repository for Task Run database operations.

Handles query logic for task runs, sessions, findings, and automations,
encapsulating database access and providing reusable methods for listing,
filtering, and aggregating task data.

Migrated from ai_task.py - renamed for unified architecture.
"""

from datetime import date
from typing import Any
from uuid import UUID

import structlog
from app.models.task_run import (
    DeferredQuestion,
    FindingCategory,
    FindingSeverity,
    FindingStatus,
    TaskRun,
    TaskRunAutomation,
    TaskRunFinding,
    TaskRunSession,
    TaskRunStatus,
    TaskType,
)
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

logger = structlog.get_logger(__name__)


class TaskRunRepository:
    """Repository for task run database operations."""

    @staticmethod
    async def list_task_runs(
        db: AsyncSession,
        project_id: UUID | None = None,
        user_id: UUID | None = None,
        status: TaskRunStatus | None = None,
        task_type: TaskType | None = None,
        start_date: date | None = None,
        end_date: date | None = None,
        offset: int = 0,
        limit: int = 50,
    ) -> tuple[list[TaskRun], int]:
        """
        List task runs with optional filtering.

        Args:
            db: Database session
            project_id: Optional filter by project ID
            user_id: Optional filter by user ID
            status: Optional filter by status
            task_type: Optional filter by task type
            start_date: Optional filter by created_at (from)
            end_date: Optional filter by created_at (to)
            offset: Pagination offset
            limit: Pagination limit

        Returns:
            Tuple of (list of TaskRun, total count)
        """
        query = select(TaskRun)

        # Apply filters
        if project_id:
            query = query.where(TaskRun.project_id == project_id)
        if user_id:
            query = query.where(TaskRun.created_by_user_id == user_id)
        if status:
            query = query.where(TaskRun.status == status)
        if task_type:
            query = query.where(TaskRun.task_type == task_type)
        if start_date:
            query = query.where(func.date(TaskRun.created_at) >= start_date)
        if end_date:
            query = query.where(func.date(TaskRun.created_at) <= end_date)

        # Get total count
        count_query = select(func.count()).select_from(query.subquery())
        total_result = await db.execute(count_query)
        total = total_result.scalar() or 0

        # Apply ordering and pagination
        query = query.order_by(TaskRun.created_at.desc()).offset(offset).limit(limit)

        # Execute query
        result = await db.execute(query)
        task_runs = list(result.scalars().all())

        logger.debug(
            "list_task_runs_query_executed",
            total=total,
            returned=len(task_runs),
            project_id=str(project_id) if project_id else None,
            user_id=str(user_id) if user_id else None,
        )

        return task_runs, total

    @staticmethod
    async def get_task_run_by_id(
        db: AsyncSession,
        task_run_id: UUID,
    ) -> TaskRun | None:
        """
        Get task run by ID.

        Args:
            db: Database session
            task_run_id: ID of the task run

        Returns:
            TaskRun or None if not found
        """
        query = select(TaskRun).where(TaskRun.id == task_run_id)
        result = await db.execute(query)
        return result.scalar_one_or_none()

    @staticmethod
    async def get_task_run_with_details(
        db: AsyncSession,
        task_run_id: UUID,
    ) -> TaskRun | None:
        """
        Get task run with related data loaded.

        Loads sessions, findings, and automations relationships for detailed view.

        Args:
            db: Database session
            task_run_id: ID of the task run

        Returns:
            TaskRun with loaded relationships, or None if not found
        """
        query = (
            select(TaskRun)
            .where(TaskRun.id == task_run_id)
            .options(
                selectinload(TaskRun.sessions),
                selectinload(TaskRun.findings),
                selectinload(TaskRun.automations),
            )
        )
        result = await db.execute(query)
        task_run = result.scalar_one_or_none()

        if task_run:
            logger.debug(
                "get_task_run_with_details_executed",
                task_run_id=str(task_run_id),
                session_count=len(task_run.sessions),
                finding_count=len(task_run.findings),
                automation_count=len(task_run.automations),
            )

        return task_run

    @staticmethod
    async def create_task_run(
        db: AsyncSession,
        task_run: TaskRun,
    ) -> TaskRun:
        """
        Create a new task run.

        Args:
            db: Database session
            task_run: TaskRun instance to create

        Returns:
            Created TaskRun
        """
        db.add(task_run)
        await db.flush()
        await db.refresh(task_run)

        logger.info(
            "task_run_created",
            task_run_id=str(task_run.id),
            task_name=task_run.task_name,
            task_type=str(task_run.task_type),
            project_id=str(task_run.project_id) if task_run.project_id else None,
        )

        return task_run

    @staticmethod
    async def update_task_run(
        db: AsyncSession,
        task_run: TaskRun,
    ) -> TaskRun:
        """
        Update an existing task run.

        Args:
            db: Database session
            task_run: TaskRun instance to update

        Returns:
            Updated TaskRun
        """
        await db.flush()
        await db.refresh(task_run)

        logger.debug(
            "task_run_updated",
            task_run_id=str(task_run.id),
            status=str(task_run.status),
        )

        return task_run

    @staticmethod
    async def delete_task_run(
        db: AsyncSession,
        task_run: TaskRun,
    ) -> None:
        """
        Delete a task run.

        Args:
            db: Database session
            task_run: TaskRun instance to delete
        """
        await db.delete(task_run)
        await db.flush()

        logger.info(
            "task_run_deleted",
            task_run_id=str(task_run.id),
        )


class TaskRunSessionRepository:
    """Repository for task run session database operations."""

    @staticmethod
    async def get_sessions_for_task_run(
        db: AsyncSession,
        task_run_id: UUID,
    ) -> list[TaskRunSession]:
        """
        Get all sessions for a task run.

        Args:
            db: Database session
            task_run_id: ID of the task run

        Returns:
            List of TaskRunSession ordered by session_number
        """
        query = (
            select(TaskRunSession)
            .where(TaskRunSession.task_run_id == task_run_id)
            .order_by(TaskRunSession.session_number)
        )
        result = await db.execute(query)
        return list(result.scalars().all())

    @staticmethod
    async def get_session_by_number(
        db: AsyncSession,
        task_run_id: UUID,
        session_number: int,
    ) -> TaskRunSession | None:
        """
        Get a specific session by task run ID and session number.

        Args:
            db: Database session
            task_run_id: ID of the task run
            session_number: Session number

        Returns:
            TaskRunSession or None if not found
        """
        query = select(TaskRunSession).where(
            TaskRunSession.task_run_id == task_run_id,
            TaskRunSession.session_number == session_number,
        )
        result = await db.execute(query)
        return result.scalar_one_or_none()

    @staticmethod
    async def create_session(
        db: AsyncSession,
        session: TaskRunSession,
    ) -> TaskRunSession:
        """
        Create a new task run session.

        Args:
            db: Database session
            session: TaskRunSession instance to create

        Returns:
            Created TaskRunSession
        """
        db.add(session)
        await db.flush()
        await db.refresh(session)

        logger.debug(
            "task_run_session_created",
            session_id=str(session.id),
            task_run_id=str(session.task_run_id),
            session_number=session.session_number,
        )

        return session

    @staticmethod
    async def update_session(
        db: AsyncSession,
        session: TaskRunSession,
    ) -> TaskRunSession:
        """
        Update an existing task run session.

        Args:
            db: Database session
            session: TaskRunSession instance to update

        Returns:
            Updated TaskRunSession
        """
        await db.flush()
        await db.refresh(session)

        logger.debug(
            "task_run_session_updated",
            session_id=str(session.id),
            duration_seconds=session.duration_seconds,
        )

        return session


class TaskRunFindingRepository:
    """Repository for task run finding database operations."""

    @staticmethod
    async def get_findings_for_task_run(
        db: AsyncSession,
        task_run_id: UUID,
        category: FindingCategory | None = None,
        severity: FindingSeverity | None = None,
        status: FindingStatus | None = None,
    ) -> list[TaskRunFinding]:
        """
        Get findings for a task run with optional filtering.

        Args:
            db: Database session
            task_run_id: ID of the task run
            category: Optional filter by category
            severity: Optional filter by severity
            status: Optional filter by status

        Returns:
            List of TaskRunFinding
        """
        query = select(TaskRunFinding).where(TaskRunFinding.task_run_id == task_run_id)

        if category:
            query = query.where(TaskRunFinding.category == category)
        if severity:
            query = query.where(TaskRunFinding.severity == severity)
        if status:
            query = query.where(TaskRunFinding.status == status)

        query = query.order_by(
            TaskRunFinding.severity.desc(),
            TaskRunFinding.detected_at.desc(),
        )

        result = await db.execute(query)
        return list(result.scalars().all())

    @staticmethod
    async def get_finding_by_id(
        db: AsyncSession,
        finding_id: UUID,
    ) -> TaskRunFinding | None:
        """
        Get finding by ID.

        Args:
            db: Database session
            finding_id: ID of the finding

        Returns:
            TaskRunFinding or None if not found
        """
        query = select(TaskRunFinding).where(TaskRunFinding.id == finding_id)
        result = await db.execute(query)
        return result.scalar_one_or_none()

    @staticmethod
    async def get_finding_by_signature(
        db: AsyncSession,
        task_run_id: UUID,
        signature_hash: str,
    ) -> TaskRunFinding | None:
        """
        Get finding by signature hash for deduplication.

        Args:
            db: Database session
            task_run_id: ID of the task run
            signature_hash: Signature hash to lookup

        Returns:
            TaskRunFinding or None if not found
        """
        query = select(TaskRunFinding).where(
            TaskRunFinding.task_run_id == task_run_id,
            TaskRunFinding.signature_hash == signature_hash,
        )
        result = await db.execute(query)
        return result.scalar_one_or_none()

    @staticmethod
    async def create_finding(
        db: AsyncSession,
        finding: TaskRunFinding,
    ) -> TaskRunFinding:
        """
        Create a new task run finding.

        Args:
            db: Database session
            finding: TaskRunFinding instance to create

        Returns:
            Created TaskRunFinding
        """
        db.add(finding)
        await db.flush()
        await db.refresh(finding)

        logger.debug(
            "task_run_finding_created",
            finding_id=str(finding.id),
            task_run_id=str(finding.task_run_id),
            category=str(finding.category),
            severity=str(finding.severity),
        )

        return finding

    @staticmethod
    async def create_findings_batch(
        db: AsyncSession,
        findings: list[TaskRunFinding],
    ) -> list[TaskRunFinding]:
        """
        Create multiple task run findings.

        Args:
            db: Database session
            findings: List of TaskRunFinding instances to create

        Returns:
            List of created TaskRunFinding
        """
        for finding in findings:
            db.add(finding)
        await db.flush()

        for finding in findings:
            await db.refresh(finding)

        logger.debug(
            "task_run_findings_batch_created",
            count=len(findings),
        )

        return findings

    @staticmethod
    async def update_finding(
        db: AsyncSession,
        finding: TaskRunFinding,
    ) -> TaskRunFinding:
        """
        Update an existing task run finding.

        Args:
            db: Database session
            finding: TaskRunFinding instance to update

        Returns:
            Updated TaskRunFinding
        """
        await db.flush()
        await db.refresh(finding)

        logger.debug(
            "task_run_finding_updated",
            finding_id=str(finding.id),
            status=str(finding.status),
        )

        return finding

    @staticmethod
    async def get_finding_summary(
        db: AsyncSession,
        task_run_id: UUID,
    ) -> dict[str, Any]:
        """
        Get summary statistics for findings in a task run.

        Args:
            db: Database session
            task_run_id: ID of the task run

        Returns:
            Dictionary with finding summary statistics
        """
        findings = await TaskRunFindingRepository.get_findings_for_task_run(
            db, task_run_id
        )

        by_category: dict[str, int] = {}
        by_severity: dict[str, int] = {}
        by_status: dict[str, int] = {}
        needs_input_count = 0
        resolved_count = 0

        for finding in findings:
            # Category counts
            cat = finding.category
            if hasattr(cat, "value"):
                cat = cat.value
            by_category[cat] = by_category.get(cat, 0) + 1

            # Severity counts
            sev = finding.severity
            if hasattr(sev, "value"):
                sev = sev.value
            by_severity[sev] = by_severity.get(sev, 0) + 1

            # Status counts
            stat = finding.status
            if hasattr(stat, "value"):
                stat = stat.value
            by_status[stat] = by_status.get(stat, 0) + 1

            if finding.needs_input:
                needs_input_count += 1
            if stat in ["resolved", "wont_fix", "deferred"]:
                resolved_count += 1

        return {
            "total": len(findings),
            "by_category": by_category,
            "by_severity": by_severity,
            "by_status": by_status,
            "needs_input_count": needs_input_count,
            "resolved_count": resolved_count,
            "outstanding_count": len(findings) - resolved_count,
        }


class TaskRunAutomationRepository:
    """Repository for task run automation database operations."""

    @staticmethod
    async def get_automations_for_task_run(
        db: AsyncSession,
        task_run_id: UUID,
    ) -> list[TaskRunAutomation]:
        """
        Get all automation records for a task run.

        Args:
            db: Database session
            task_run_id: ID of the task run

        Returns:
            List of TaskRunAutomation ordered by iteration_number
        """
        query = (
            select(TaskRunAutomation)
            .where(TaskRunAutomation.task_run_id == task_run_id)
            .order_by(TaskRunAutomation.iteration_number)
        )
        result = await db.execute(query)
        return list(result.scalars().all())

    @staticmethod
    async def create_automation(
        db: AsyncSession,
        automation: TaskRunAutomation,
    ) -> TaskRunAutomation:
        """
        Create a new task run automation record.

        Args:
            db: Database session
            automation: TaskRunAutomation instance to create

        Returns:
            Created TaskRunAutomation
        """
        db.add(automation)
        await db.flush()
        await db.refresh(automation)

        logger.debug(
            "task_run_automation_created",
            automation_id=str(automation.id),
            task_run_id=str(automation.task_run_id),
            iteration=automation.iteration_number,
        )

        return automation

    @staticmethod
    async def update_automation(
        db: AsyncSession,
        automation: TaskRunAutomation,
    ) -> TaskRunAutomation:
        """
        Update an existing task run automation record.

        Args:
            db: Database session
            automation: TaskRunAutomation instance to update

        Returns:
            Updated TaskRunAutomation
        """
        await db.flush()
        await db.refresh(automation)

        logger.debug(
            "task_run_automation_updated",
            automation_id=str(automation.id),
            status=automation.automation_status,
        )

        return automation


class DeferredQuestionRepository:
    """Repository for deferred question database operations."""

    @staticmethod
    async def get_questions_for_task_run(
        db: AsyncSession,
        task_run_id: UUID,
        status_filter: str | None = None,
    ) -> list[DeferredQuestion]:
        """Get deferred questions for a task run with optional status filter."""
        query = select(DeferredQuestion).where(
            DeferredQuestion.task_run_id == task_run_id
        )
        if status_filter:
            query = query.where(DeferredQuestion.status == status_filter)
        query = query.order_by(DeferredQuestion.created_at.asc())
        result = await db.execute(query)
        return list(result.scalars().all())

    @staticmethod
    async def get_question_by_id(
        db: AsyncSession,
        question_id: UUID,
    ) -> DeferredQuestion | None:
        """Get a deferred question by ID."""
        query = select(DeferredQuestion).where(DeferredQuestion.id == question_id)
        result = await db.execute(query)
        return result.scalar_one_or_none()

    @staticmethod
    async def create_question(
        db: AsyncSession,
        question: DeferredQuestion,
    ) -> DeferredQuestion:
        """Create a new deferred question."""
        db.add(question)
        await db.flush()
        await db.refresh(question)

        logger.debug(
            "deferred_question_created",
            question_id=str(question.id),
            task_run_id=str(question.task_run_id),
            iteration=question.iteration,
        )

        return question

    @staticmethod
    async def update_question(
        db: AsyncSession,
        question: DeferredQuestion,
    ) -> DeferredQuestion:
        """Update an existing deferred question."""
        await db.flush()
        await db.refresh(question)

        logger.debug(
            "deferred_question_updated",
            question_id=str(question.id),
            status=question.status,
        )

        return question


# =============================================================================
# Backward compatibility aliases (deprecated, will be removed)
# =============================================================================

AITaskRepository = TaskRunRepository
AITaskSessionRepository = TaskRunSessionRepository
AITaskFindingRepository = TaskRunFindingRepository
