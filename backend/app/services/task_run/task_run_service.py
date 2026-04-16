"""
Core CRUD service for Task Run operations.

Handles creation, listing, retrieval, updating, and deletion
of task runs. Also serves as a facade that delegates session,
finding, and automation operations to their respective sub-services.
"""

from datetime import UTC, date, datetime
from uuid import UUID

import structlog
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.task_run import TaskRun, TaskRunStatus, TaskType
from app.repositories.task_run import (
    DeferredQuestionRepository,
    TaskRunAutomationRepository,
    TaskRunFindingRepository,
    TaskRunRepository,
    TaskRunSessionRepository,
)
from app.services.task_run.mappers import (
    _get_enum_value,
    model_to_automation_response,
    model_to_finding_response,
    model_to_session_response,
    model_to_task_run_response,
)
from app.services.task_run.schemas import (
    DeferredQuestionBatch,
    DeferredQuestionResponse,
    DeferredQuestionUpdate,
    Pagination,
    StepProgressResponse,
    TaskRunAutomationCreate,
    TaskRunAutomationResponse,
    TaskRunAutomationUpdate,
    TaskRunCreate,
    TaskRunDetail,
    TaskRunFindingResponse,
    TaskRunFindingsBatch,
    TaskRunFindingsListResponse,
    TaskRunFindingUpdate,
    TaskRunListResponse,
    TaskRunResponse,
    TaskRunSessionCreate,
    TaskRunSessionResponse,
    TaskRunSessionUpdate,
    TaskRunUpdate,
)

logger = structlog.get_logger(__name__)


class TaskRunService:
    """Service for task run operations.

    Provides core CRUD plus delegation to sub-services for
    session, finding, and automation operations.
    """

    def __init__(
        self,
        task_run_repo: TaskRunRepository | None = None,
        session_repo: TaskRunSessionRepository | None = None,
        finding_repo: TaskRunFindingRepository | None = None,
        automation_repo: TaskRunAutomationRepository | None = None,
        deferred_question_repo: DeferredQuestionRepository | None = None,
    ) -> None:
        """Initialize with repositories (uses static methods if not provided)."""
        self.task_run_repo = task_run_repo or TaskRunRepository()
        self.session_repo = session_repo or TaskRunSessionRepository()
        self.finding_repo = finding_repo or TaskRunFindingRepository()
        self.automation_repo = automation_repo or TaskRunAutomationRepository()
        self.deferred_question_repo = (
            deferred_question_repo or DeferredQuestionRepository()
        )

    # =========================================================================
    # Core Task Run CRUD
    # =========================================================================

    async def create_task_run(
        self,
        db: AsyncSession,
        task_data: TaskRunCreate,
        user_id: UUID,
    ) -> TaskRunResponse:
        """
        Create a new task run.

        Args:
            db: Database session
            task_data: Task creation data
            user_id: ID of the user creating the task

        Returns:
            Created TaskRunResponse
        """
        task_run = TaskRun(
            id=task_data.id,  # Allow runner to specify ID
            project_id=task_data.project_id,
            created_by_user_id=user_id,
            runner_id=task_data.runner_id,
            task_name=task_data.task_name,
            prompt=task_data.prompt,
            task_type=TaskType(task_data.task_type),
            config_id=task_data.config_id,
            workflow_name=task_data.workflow_name,
            status=TaskRunStatus.RUNNING,
            max_sessions=task_data.max_sessions,
            auto_continue=task_data.auto_continue,
            execution_steps_json=task_data.execution_steps_json,
            log_sources_json=task_data.log_sources_json,
        )

        created = await self.task_run_repo.create_task_run(db, task_run)
        await db.commit()

        logger.info(
            "Created task run",
            task_run_id=str(created.id),
            task_name=task_data.task_name,
            task_type=task_data.task_type,
            project_id=str(task_data.project_id) if task_data.project_id else None,
            user_id=str(user_id),
        )

        return model_to_task_run_response(created)

    async def list_task_runs(
        self,
        db: AsyncSession,
        project_id: UUID | None = None,
        user_id: UUID | None = None,
        status: str | None = None,
        task_type: str | None = None,
        start_date: date | None = None,
        end_date: date | None = None,
        offset: int = 0,
        limit: int = 50,
    ) -> TaskRunListResponse:
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
            TaskRunListResponse with task runs and pagination
        """
        status_enum = TaskRunStatus(status) if status else None
        type_enum = TaskType(task_type) if task_type else None

        task_runs, total = await self.task_run_repo.list_task_runs(
            db,
            project_id=project_id,
            user_id=user_id,
            status=status_enum,
            task_type=type_enum,
            start_date=start_date,
            end_date=end_date,
            offset=offset,
            limit=limit,
        )

        return TaskRunListResponse(
            task_runs=[model_to_task_run_response(t) for t in task_runs],
            pagination=Pagination(
                total=total,
                limit=limit,
                offset=offset,
                has_more=offset + limit < total,
            ),
        )

    async def get_task_run(
        self,
        db: AsyncSession,
        task_run_id: UUID,
    ) -> TaskRunResponse | None:
        """
        Get a task run by ID.

        Args:
            db: Database session
            task_run_id: ID of the task run

        Returns:
            TaskRunResponse or None if not found
        """
        task_run = await self.task_run_repo.get_task_run_by_id(db, task_run_id)
        if not task_run:
            return None
        return model_to_task_run_response(task_run)

    async def get_task_run_detail(
        self,
        db: AsyncSession,
        task_run_id: UUID,
    ) -> TaskRunDetail | None:
        """
        Get detailed task run information with sessions, findings, and automations.

        Args:
            db: Database session
            task_run_id: ID of the task run

        Returns:
            TaskRunDetail or None if not found
        """
        task_run = await self.task_run_repo.get_task_run_with_details(db, task_run_id)
        if not task_run:
            return None

        # Get finding summary
        finding_summary = await self.finding_repo.get_finding_summary(db, task_run_id)

        return TaskRunDetail(
            id=task_run.id,
            project_id=task_run.project_id,
            created_by_user_id=task_run.created_by_user_id,
            runner_id=task_run.runner_id,
            task_name=task_run.task_name,
            prompt=task_run.prompt,
            task_type=_get_enum_value(task_run.task_type),  # type: ignore[arg-type]
            config_id=task_run.config_id,
            workflow_name=task_run.workflow_name,
            status=_get_enum_value(task_run.status),  # type: ignore[arg-type]
            sessions_count=task_run.sessions_count,
            max_sessions=task_run.max_sessions,
            auto_continue=task_run.auto_continue,
            output_summary=task_run.output_summary,
            summary=task_run.summary,
            goal_achieved=task_run.goal_achieved,
            remaining_work=task_run.remaining_work,
            full_output_stored=task_run.full_output_stored,
            error_message=task_run.error_message,
            duration_seconds=task_run.duration_seconds,
            created_at=task_run.created_at,
            updated_at=task_run.updated_at,
            completed_at=task_run.completed_at,
            sessions=[model_to_session_response(s) for s in task_run.sessions],
            findings=[model_to_finding_response(f) for f in task_run.findings],
            automations=[model_to_automation_response(a) for a in task_run.automations],
            finding_summary=finding_summary,
        )

    async def update_task_run(
        self,
        db: AsyncSession,
        task_run_id: UUID,
        update_data: TaskRunUpdate,
    ) -> TaskRunResponse | None:
        """
        Update a task run.

        Args:
            db: Database session
            task_run_id: ID of the task run
            update_data: Update data

        Returns:
            Updated TaskRunResponse or None if not found
        """
        task_run = await self.task_run_repo.get_task_run_by_id(db, task_run_id)
        if not task_run:
            return None

        if update_data.status:
            task_run.status = TaskRunStatus(update_data.status)
        if update_data.sessions_count is not None:
            task_run.sessions_count = update_data.sessions_count
        if update_data.output_summary is not None:
            task_run.output_summary = update_data.output_summary
        if update_data.summary is not None:
            task_run.summary = update_data.summary
            task_run.summary_generated_at = datetime.now(UTC)
        if update_data.goal_achieved is not None:
            task_run.goal_achieved = update_data.goal_achieved
        if update_data.remaining_work is not None:
            task_run.remaining_work = update_data.remaining_work
        if update_data.full_output is not None:
            task_run.full_output = update_data.full_output
            task_run.full_output_stored = True
        if update_data.full_output_stored is not None:
            task_run.full_output_stored = update_data.full_output_stored
        if update_data.error_message is not None:
            task_run.error_message = update_data.error_message
        if update_data.duration_seconds is not None:
            task_run.duration_seconds = update_data.duration_seconds
        if update_data.completed_at is not None:
            task_run.completed_at = update_data.completed_at

        await self.task_run_repo.update_task_run(db, task_run)
        await db.commit()
        await db.refresh(task_run)

        logger.info(
            "Updated task run",
            task_run_id=str(task_run_id),
            status=_get_enum_value(task_run.status),
        )

        return model_to_task_run_response(task_run)

    async def delete_task_run(
        self,
        db: AsyncSession,
        task_run_id: UUID,
    ) -> bool:
        """
        Delete a task run.

        Args:
            db: Database session
            task_run_id: ID of the task run

        Returns:
            True if deleted, False if not found
        """
        task_run = await self.task_run_repo.get_task_run_by_id(db, task_run_id)
        if not task_run:
            return False

        await self.task_run_repo.delete_task_run(db, task_run)
        await db.commit()

        logger.info("Deleted task run", task_run_id=str(task_run_id))
        return True

    # =========================================================================
    # Aggregated Queries
    # =========================================================================

    async def get_findings_summary(
        self,
        db: AsyncSession,
        user_id: UUID,
    ) -> dict:
        """Get aggregated findings summary across all task runs for a user.

        Args:
            db: Database session
            user_id: ID of the user

        Returns:
            Dictionary with total count, breakdowns by severity/category/status,
            and recent findings.
        """
        from sqlalchemy import func, select

        from app.models.task_run import TaskRunFinding

        # Get all task run IDs for this user
        task_run_ids_query = select(TaskRun.id).where(
            TaskRun.created_by_user_id == user_id
        )

        # Count by severity
        severity_query = (
            select(TaskRunFinding.severity, func.count())
            .where(TaskRunFinding.task_run_id.in_(task_run_ids_query))
            .group_by(TaskRunFinding.severity)
        )
        severity_result = await db.execute(severity_query)
        by_severity = {
            str(row[0].value if hasattr(row[0], "value") else row[0]): row[1]
            for row in severity_result
        }

        # Count by category
        category_query = (
            select(TaskRunFinding.category, func.count())
            .where(TaskRunFinding.task_run_id.in_(task_run_ids_query))
            .group_by(TaskRunFinding.category)
        )
        category_result = await db.execute(category_query)
        by_category = {
            str(row[0].value if hasattr(row[0], "value") else row[0]): row[1]
            for row in category_result
        }

        # Count by status
        status_query = (
            select(TaskRunFinding.status, func.count())
            .where(TaskRunFinding.task_run_id.in_(task_run_ids_query))
            .group_by(TaskRunFinding.status)
        )
        status_result = await db.execute(status_query)
        by_status = {
            str(row[0].value if hasattr(row[0], "value") else row[0]): row[1]
            for row in status_result
        }

        # Total count
        total = sum(by_severity.values())

        # Recent findings (last 20)
        recent_query = (
            select(TaskRunFinding)
            .where(TaskRunFinding.task_run_id.in_(task_run_ids_query))
            .order_by(TaskRunFinding.detected_at.desc())
            .limit(20)
        )
        recent_result = await db.execute(recent_query)
        recent_findings = [
            model_to_finding_response(f) for f in recent_result.scalars()
        ]

        return {
            "total": total,
            "by_severity": by_severity,
            "by_category": by_category,
            "by_status": by_status,
            "recent": [f.model_dump() for f in recent_findings],
        }

    # =========================================================================
    # Session Operations (delegates to TaskRunSessionService)
    # =========================================================================

    async def create_session(
        self,
        db: AsyncSession,
        task_run_id: UUID,
        session_data: TaskRunSessionCreate,
    ) -> TaskRunSessionResponse | None:
        """Record a session start. Delegates to TaskRunSessionService."""
        from app.services.task_run.session_service import TaskRunSessionService

        svc = TaskRunSessionService(
            task_run_repo=self.task_run_repo,
            session_repo=self.session_repo,
        )
        return await svc.create_session(db, task_run_id, session_data)

    async def update_session(
        self,
        db: AsyncSession,
        task_run_id: UUID,
        session_number: int,
        update_data: TaskRunSessionUpdate,
    ) -> TaskRunSessionResponse | None:
        """Record a session end. Delegates to TaskRunSessionService."""
        from app.services.task_run.session_service import TaskRunSessionService

        svc = TaskRunSessionService(
            task_run_repo=self.task_run_repo,
            session_repo=self.session_repo,
        )
        return await svc.update_session(db, task_run_id, session_number, update_data)

    async def get_sessions(
        self,
        db: AsyncSession,
        task_run_id: UUID,
    ) -> list[TaskRunSessionResponse]:
        """Get all sessions for a task run. Delegates to TaskRunSessionService."""
        from app.services.task_run.session_service import TaskRunSessionService

        svc = TaskRunSessionService(
            task_run_repo=self.task_run_repo,
            session_repo=self.session_repo,
        )
        return await svc.get_sessions(db, task_run_id)

    # =========================================================================
    # Finding Operations (delegates to TaskRunFindingService)
    # =========================================================================

    async def sync_findings(
        self,
        db: AsyncSession,
        task_run_id: UUID,
        batch: TaskRunFindingsBatch,
    ) -> list[TaskRunFindingResponse]:
        """Sync a batch of findings. Delegates to TaskRunFindingService."""
        from app.services.task_run.finding_service import TaskRunFindingService

        svc = TaskRunFindingService(finding_repo=self.finding_repo)
        return await svc.sync_findings(db, task_run_id, batch)

    async def get_findings(
        self,
        db: AsyncSession,
        task_run_id: UUID,
        category: str | None = None,
        severity: str | None = None,
        status: str | None = None,
    ) -> TaskRunFindingsListResponse:
        """Get findings for a task run. Delegates to TaskRunFindingService."""
        from app.services.task_run.finding_service import TaskRunFindingService

        svc = TaskRunFindingService(finding_repo=self.finding_repo)
        return await svc.get_findings(db, task_run_id, category, severity, status)

    async def update_finding(
        self,
        db: AsyncSession,
        task_run_id: UUID,
        finding_id: UUID,
        update_data: TaskRunFindingUpdate,
    ) -> TaskRunFindingResponse | None:
        """Update a finding. Delegates to TaskRunFindingService."""
        from app.services.task_run.finding_service import TaskRunFindingService

        svc = TaskRunFindingService(finding_repo=self.finding_repo)
        return await svc.update_finding(db, task_run_id, finding_id, update_data)

    async def submit_finding_response(
        self,
        db: AsyncSession,
        task_run_id: UUID,
        finding_id: UUID,
        response: str,
    ) -> TaskRunFindingResponse | None:
        """Submit a user response to a finding. Delegates to TaskRunFindingService."""
        from app.services.task_run.finding_service import TaskRunFindingService

        svc = TaskRunFindingService(finding_repo=self.finding_repo)
        return await svc.submit_finding_response(db, task_run_id, finding_id, response)

    # =========================================================================
    # Automation Operations (delegates to TaskRunAutomationService)
    # =========================================================================

    async def create_automation(
        self,
        db: AsyncSession,
        task_run_id: UUID,
        automation_data: TaskRunAutomationCreate,
    ) -> TaskRunAutomationResponse | None:
        """Create an automation record. Delegates to TaskRunAutomationService."""
        from app.services.task_run.automation_service import TaskRunAutomationService

        svc = TaskRunAutomationService(
            task_run_repo=self.task_run_repo,
            automation_repo=self.automation_repo,
        )
        return await svc.create_automation(db, task_run_id, automation_data)

    async def update_automation(
        self,
        db: AsyncSession,
        task_run_id: UUID,
        automation_id: UUID,
        update_data: TaskRunAutomationUpdate,
    ) -> TaskRunAutomationResponse | None:
        """Update an automation record. Delegates to TaskRunAutomationService."""
        from app.services.task_run.automation_service import TaskRunAutomationService

        svc = TaskRunAutomationService(
            task_run_repo=self.task_run_repo,
            automation_repo=self.automation_repo,
        )
        return await svc.update_automation(db, task_run_id, automation_id, update_data)

    async def get_automations(
        self,
        db: AsyncSession,
        task_run_id: UUID,
    ) -> list[TaskRunAutomationResponse]:
        """Get all automation records. Delegates to TaskRunAutomationService."""
        from app.services.task_run.automation_service import TaskRunAutomationService

        svc = TaskRunAutomationService(
            task_run_repo=self.task_run_repo,
            automation_repo=self.automation_repo,
        )
        return await svc.get_automations(db, task_run_id)

    async def get_step_progress(
        self,
        db: AsyncSession,
        task_run_id: UUID,
        checkpoint_id: str,
    ) -> StepProgressResponse | None:
        """Get step execution progress. Delegates to TaskRunAutomationService."""
        from app.services.task_run.automation_service import TaskRunAutomationService

        svc = TaskRunAutomationService(
            task_run_repo=self.task_run_repo,
            automation_repo=self.automation_repo,
        )
        return await svc.get_step_progress(db, task_run_id, checkpoint_id)

    # =========================================================================
    # Deferred Question Operations (delegates to DeferredQuestionService)
    # =========================================================================

    async def sync_deferred_questions(
        self,
        db: AsyncSession,
        task_run_id: UUID,
        batch: DeferredQuestionBatch,
    ) -> list[DeferredQuestionResponse]:
        """Sync a batch of deferred questions. Delegates to DeferredQuestionService."""
        from app.services.task_run.deferred_question_service import (
            DeferredQuestionService,
        )

        svc = DeferredQuestionService(question_repo=self.deferred_question_repo)
        return await svc.sync_deferred_questions(db, task_run_id, batch)

    async def list_deferred_questions(
        self,
        db: AsyncSession,
        task_run_id: UUID,
        status_filter: str | None = None,
    ) -> list[DeferredQuestionResponse]:
        """List deferred questions. Delegates to DeferredQuestionService."""
        from app.services.task_run.deferred_question_service import (
            DeferredQuestionService,
        )

        svc = DeferredQuestionService(question_repo=self.deferred_question_repo)
        return await svc.list_deferred_questions(db, task_run_id, status_filter)

    async def review_deferred_question(
        self,
        db: AsyncSession,
        task_run_id: UUID,
        question_id: UUID,
        update_data: DeferredQuestionUpdate,
    ) -> DeferredQuestionResponse | None:
        """Review a deferred question. Delegates to DeferredQuestionService."""
        from app.services.task_run.deferred_question_service import (
            DeferredQuestionService,
        )

        svc = DeferredQuestionService(question_repo=self.deferred_question_repo)
        return await svc.review_deferred_question(
            db, task_run_id, question_id, update_data
        )
