"""
Service for Task Run business logic.

Handles task creation, updates, session management, finding sync,
automation tracking, and response mapping. Separates business logic
from HTTP handling.

Migrated from ai_task_service.py - renamed for unified architecture.
"""

from datetime import date, datetime
from typing import Any
from uuid import UUID

import structlog
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.task_run import (
    FindingActionType,
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
from app.repositories.task_run import (
    TaskRunAutomationRepository,
    TaskRunFindingRepository,
    TaskRunRepository,
    TaskRunSessionRepository,
)

logger = structlog.get_logger(__name__)


# =============================================================================
# Request/Response Schemas
# =============================================================================


class TaskRunCreate(BaseModel):
    """Request to create a new task run."""

    id: UUID | None = None  # Allow runner to specify ID for direct mapping
    project_id: UUID | None = None
    runner_id: str | None = None
    task_name: str
    prompt: str | None = None  # NULL for pure automation tasks
    task_type: str = "task"  # task, automation, scheduled
    config_id: str | None = None
    workflow_name: str | None = None
    max_sessions: int | None = None
    auto_continue: bool = True
    execution_steps_json: str | None = None
    log_sources_json: str | None = None


class TaskRunUpdate(BaseModel):
    """Request to update a task run."""

    status: str | None = None
    sessions_count: int | None = None
    output_summary: str | None = None
    summary: str | None = None
    goal_achieved: bool | None = None
    remaining_work: str | None = None
    full_output: str | None = None
    full_output_stored: bool | None = None
    error_message: str | None = None
    duration_seconds: int | None = None
    completed_at: datetime | None = None


class TaskRunSessionCreate(BaseModel):
    """Request to create/record a session start."""

    session_number: int
    started_at: datetime | None = None


class TaskRunSessionUpdate(BaseModel):
    """Request to update a session (on end)."""

    ended_at: datetime
    duration_seconds: int | None = None
    output_summary: str | None = None


class TaskRunFindingCreate(BaseModel):
    """Request to create a finding."""

    id: UUID | None = None  # Allow runner to specify ID
    category: str
    severity: str
    status: str = "detected"
    action_type: str = "auto_fix"
    signature_hash: str | None = None
    title: str
    description: str
    resolution: str | None = None
    file_path: str | None = None
    line_number: int | None = None
    column_number: int | None = None
    code_snippet: str | None = None
    detected_in_session: int
    needs_input: bool = False
    question: str | None = None
    input_options: list[str] | None = None


class TaskRunFindingUpdate(BaseModel):
    """Request to update a finding."""

    status: str | None = None
    resolution: str | None = None
    resolved_in_session: int | None = None
    resolved_at: datetime | None = None
    user_response: str | None = None


class TaskRunFindingsBatch(BaseModel):
    """Batch of findings to sync."""

    findings: list[TaskRunFindingCreate]


class TaskRunAutomationCreate(BaseModel):
    """Request to create an automation record."""

    workflow_name: str | None = None
    iteration_number: int = 1
    started_at: datetime | None = None


class TaskRunAutomationUpdate(BaseModel):
    """Request to update an automation record."""

    ended_at: datetime | None = None
    duration_ms: int | None = None
    automation_status: str | None = None
    success: bool | None = None
    error_type: str | None = None
    error_message: str | None = None
    actions_summary: str | None = None
    states_visited: str | None = None
    transitions_executed: str | None = None
    template_matches: str | None = None
    anomalies: str | None = None
    screenshots: str | None = None


class Pagination(BaseModel):
    """Pagination info."""

    total: int
    limit: int
    offset: int
    has_more: bool


class TaskRunResponse(BaseModel):
    """Response for a task run."""

    id: UUID
    project_id: UUID | None
    created_by_user_id: UUID | None
    runner_id: str | None
    task_name: str
    prompt: str | None
    task_type: str
    config_id: str | None
    workflow_name: str | None
    status: str
    sessions_count: int
    max_sessions: int | None
    auto_continue: bool
    output_summary: str | None
    summary: str | None
    goal_achieved: bool | None
    remaining_work: str | None
    full_output_stored: bool
    error_message: str | None
    duration_seconds: int | None
    created_at: datetime
    updated_at: datetime
    completed_at: datetime | None


class TaskRunSessionResponse(BaseModel):
    """Response for a task run session."""

    id: UUID
    task_run_id: UUID
    session_number: int
    started_at: datetime
    ended_at: datetime | None
    duration_seconds: int | None
    output_summary: str | None


class TaskRunFindingResponse(BaseModel):
    """Response for a task run finding."""

    id: UUID
    task_run_id: UUID
    category: str
    severity: str
    status: str
    action_type: str
    signature_hash: str | None
    title: str
    description: str
    resolution: str | None
    file_path: str | None
    line_number: int | None
    column_number: int | None
    code_snippet: str | None
    detected_in_session: int
    resolved_in_session: int | None
    needs_input: bool
    question: str | None
    input_options: list[str] | None
    user_response: str | None
    detected_at: datetime
    resolved_at: datetime | None
    updated_at: datetime


class TaskRunAutomationResponse(BaseModel):
    """Response for a task run automation record."""

    id: UUID
    task_run_id: UUID
    workflow_name: str | None
    started_at: datetime
    ended_at: datetime | None
    duration_ms: int | None
    automation_status: str
    success: bool | None
    error_type: str | None
    error_message: str | None
    iteration_number: int


class TaskRunDetail(TaskRunResponse):
    """Detailed response for a task run with sessions, findings, and automations."""

    sessions: list[TaskRunSessionResponse] = Field(default_factory=list)
    findings: list[TaskRunFindingResponse] = Field(default_factory=list)
    automations: list[TaskRunAutomationResponse] = Field(default_factory=list)
    finding_summary: dict[str, Any] = Field(default_factory=dict)


class TaskRunListResponse(BaseModel):
    """Response for listing task runs."""

    task_runs: list[TaskRunResponse]
    pagination: Pagination


class TaskRunFindingsListResponse(BaseModel):
    """Response for listing findings."""

    findings: list[TaskRunFindingResponse]
    summary: dict[str, Any]


class StepProgressResponse(BaseModel):
    """Response for step execution progress.

    Provides real-time progress information for a running or completed step.
    Used by the frontend to show progress indicators during execution.
    """

    phase: str
    phase_description: str | None = None
    substep: str | None = None
    progress: float | None = None  # 0-100, null if indeterminate
    message: str | None = None
    elapsed_ms: int
    is_running: bool
    error: str | None = None
    metadata: dict[str, Any] | None = None


# =============================================================================
# Response Mapping Functions
# =============================================================================


def _get_enum_value(val: Any) -> str:
    """Get string value from enum or string."""
    if hasattr(val, "value"):
        return str(val.value)
    return str(val)


def model_to_task_run_response(task_run: TaskRun) -> TaskRunResponse:
    """Convert TaskRun model to TaskRunResponse schema."""
    return TaskRunResponse(
        id=task_run.id,
        project_id=task_run.project_id,
        created_by_user_id=task_run.created_by_user_id,
        runner_id=task_run.runner_id,
        task_name=task_run.task_name,
        prompt=task_run.prompt,
        task_type=_get_enum_value(task_run.task_type),
        config_id=task_run.config_id,
        workflow_name=task_run.workflow_name,
        status=_get_enum_value(task_run.status),
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
    )


def model_to_session_response(session: TaskRunSession) -> TaskRunSessionResponse:
    """Convert TaskRunSession model to TaskRunSessionResponse schema."""
    return TaskRunSessionResponse(
        id=session.id,
        task_run_id=session.task_run_id,
        session_number=session.session_number,
        started_at=session.started_at,
        ended_at=session.ended_at,
        duration_seconds=session.duration_seconds,
        output_summary=session.output_summary,
    )


def model_to_finding_response(finding: TaskRunFinding) -> TaskRunFindingResponse:
    """Convert TaskRunFinding model to TaskRunFindingResponse schema."""
    return TaskRunFindingResponse(
        id=finding.id,
        task_run_id=finding.task_run_id,
        category=_get_enum_value(finding.category),
        severity=_get_enum_value(finding.severity),
        status=_get_enum_value(finding.status),
        action_type=_get_enum_value(finding.action_type),
        signature_hash=finding.signature_hash,
        title=finding.title,
        description=finding.description,
        resolution=finding.resolution,
        file_path=finding.file_path,
        line_number=finding.line_number,
        column_number=finding.column_number,
        code_snippet=finding.code_snippet,
        detected_in_session=finding.detected_in_session,
        resolved_in_session=finding.resolved_in_session,
        needs_input=finding.needs_input,
        question=finding.question,
        input_options=finding.input_options,
        user_response=finding.user_response,
        detected_at=finding.detected_at,
        resolved_at=finding.resolved_at,
        updated_at=finding.updated_at,
    )


def model_to_automation_response(
    automation: TaskRunAutomation,
) -> TaskRunAutomationResponse:
    """Convert TaskRunAutomation model to TaskRunAutomationResponse schema."""
    return TaskRunAutomationResponse(
        id=automation.id,
        task_run_id=automation.task_run_id,
        workflow_name=automation.workflow_name,
        started_at=automation.started_at,
        ended_at=automation.ended_at,
        duration_ms=automation.duration_ms,
        automation_status=automation.automation_status,
        success=automation.success,
        error_type=automation.error_type,
        error_message=automation.error_message,
        iteration_number=automation.iteration_number,
    )


# =============================================================================
# Service Class
# =============================================================================


class TaskRunService:
    """Service for task run operations."""

    def __init__(
        self,
        task_run_repo: TaskRunRepository | None = None,
        session_repo: TaskRunSessionRepository | None = None,
        finding_repo: TaskRunFindingRepository | None = None,
        automation_repo: TaskRunAutomationRepository | None = None,
    ) -> None:
        """Initialize with repositories (uses static methods if not provided)."""
        self.task_run_repo = task_run_repo or TaskRunRepository()
        self.session_repo = session_repo or TaskRunSessionRepository()
        self.finding_repo = finding_repo or TaskRunFindingRepository()
        self.automation_repo = automation_repo or TaskRunAutomationRepository()

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
            task_type=_get_enum_value(task_run.task_type),
            config_id=task_run.config_id,
            workflow_name=task_run.workflow_name,
            status=_get_enum_value(task_run.status),
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
            task_run.summary_generated_at = datetime.utcnow()
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
    # Session Operations
    # =========================================================================

    async def create_session(
        self,
        db: AsyncSession,
        task_run_id: UUID,
        session_data: TaskRunSessionCreate,
    ) -> TaskRunSessionResponse | None:
        """
        Record a session start.

        Args:
            db: Database session
            task_run_id: ID of the task run
            session_data: Session creation data

        Returns:
            Created TaskRunSessionResponse or None if task not found
        """
        task_run = await self.task_run_repo.get_task_run_by_id(db, task_run_id)
        if not task_run:
            return None

        session = TaskRunSession(
            task_run_id=task_run_id,
            session_number=session_data.session_number,
            started_at=session_data.started_at or datetime.utcnow(),
        )

        created = await self.session_repo.create_session(db, session)

        # Update task sessions_count
        task_run.sessions_count = session_data.session_number
        await self.task_run_repo.update_task_run(db, task_run)

        await db.commit()
        await db.refresh(created)

        logger.debug(
            "Created task run session",
            task_run_id=str(task_run_id),
            session_number=session_data.session_number,
        )

        return model_to_session_response(created)

    async def update_session(
        self,
        db: AsyncSession,
        task_run_id: UUID,
        session_number: int,
        update_data: TaskRunSessionUpdate,
    ) -> TaskRunSessionResponse | None:
        """
        Record a session end.

        Args:
            db: Database session
            task_run_id: ID of the task run
            session_number: Session number
            update_data: Session update data

        Returns:
            Updated TaskRunSessionResponse or None if not found
        """
        session = await self.session_repo.get_session_by_number(
            db, task_run_id, session_number
        )
        if not session:
            return None

        session.ended_at = update_data.ended_at
        if update_data.duration_seconds is not None:
            session.duration_seconds = update_data.duration_seconds
        else:
            # Calculate duration
            session.duration_seconds = int(
                (update_data.ended_at - session.started_at).total_seconds()
            )
        if update_data.output_summary is not None:
            session.output_summary = update_data.output_summary

        await self.session_repo.update_session(db, session)
        await db.commit()
        await db.refresh(session)

        logger.debug(
            "Updated task run session",
            task_run_id=str(task_run_id),
            session_number=session_number,
            duration_seconds=session.duration_seconds,
        )

        return model_to_session_response(session)

    async def get_sessions(
        self,
        db: AsyncSession,
        task_run_id: UUID,
    ) -> list[TaskRunSessionResponse]:
        """
        Get all sessions for a task run.

        Args:
            db: Database session
            task_run_id: ID of the task run

        Returns:
            List of TaskRunSessionResponse
        """
        sessions = await self.session_repo.get_sessions_for_task_run(db, task_run_id)
        return [model_to_session_response(s) for s in sessions]

    # =========================================================================
    # Finding Operations
    # =========================================================================

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

    # =========================================================================
    # Automation Operations
    # =========================================================================

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
            started_at=automation_data.started_at or datetime.utcnow(),
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
                elapsed = datetime.utcnow() - latest_automation.started_at
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
            elapsed = datetime.utcnow() - task_run.created_at
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


# =============================================================================
# Backward compatibility aliases (deprecated, will be removed)
# =============================================================================

AITaskService = TaskRunService
AITaskCreate = TaskRunCreate
AITaskUpdate = TaskRunUpdate
AITaskSessionCreate = TaskRunSessionCreate
AITaskSessionUpdate = TaskRunSessionUpdate
AITaskFindingCreate = TaskRunFindingCreate
AITaskFindingUpdate = TaskRunFindingUpdate
AITaskFindingsBatch = TaskRunFindingsBatch
AITaskResponse = TaskRunResponse
AITaskSessionResponse = TaskRunSessionResponse
AITaskFindingResponse = TaskRunFindingResponse
AITaskDetail = TaskRunDetail
AITaskListResponse = TaskRunListResponse
AITaskFindingsListResponse = TaskRunFindingsListResponse
