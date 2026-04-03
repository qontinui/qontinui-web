"""
Pydantic request/response schemas for Task Run operations.

Defines all data transfer objects used by task run services
and API endpoints.
"""

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

# =============================================================================
# Request Schemas
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


class DeferredQuestionCreate(BaseModel):
    """Request to create/sync a deferred question."""

    id: str | None = None
    iteration: int
    question: str
    context_json: str = "{}"
    auto_decision_type: str
    auto_decision_detail: str | None = None
    confidence: float
    risk_level: str
    status: str = "pending"
    git_checkpoint: str | None = None
    contingent_iterations: str = "[]"
    reviewer_comment: str | None = None
    created_at: datetime | None = None
    reviewed_at: datetime | None = None


class DeferredQuestionBatch(BaseModel):
    """Batch of deferred questions to sync."""

    questions: list[DeferredQuestionCreate]


class DeferredQuestionUpdate(BaseModel):
    """Request to update/review a deferred question."""

    status: str | None = None
    reviewer_comment: str | None = None


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


# =============================================================================
# Response Schemas
# =============================================================================


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


class DeferredQuestionResponse(BaseModel):
    """Response for a deferred question."""

    id: UUID
    task_run_id: UUID
    iteration: int
    question: str
    context_json: str
    auto_decision_type: str
    auto_decision_detail: str | None
    confidence: float
    risk_level: str
    status: str
    git_checkpoint: str | None
    contingent_iterations: str
    reviewer_comment: str | None
    created_at: datetime
    reviewed_at: datetime | None

    model_config = ConfigDict(from_attributes=True)


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
