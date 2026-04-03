"""
Model-to-schema mapping functions for Task Run entities.

Converts SQLAlchemy models to Pydantic response schemas.
"""

from typing import Any

from app.models.task_run import (
    DeferredQuestion,
    TaskRun,
    TaskRunAutomation,
    TaskRunFinding,
    TaskRunSession,
)
from app.services.task_run.schemas import (
    DeferredQuestionResponse,
    TaskRunAutomationResponse,
    TaskRunFindingResponse,
    TaskRunResponse,
    TaskRunSessionResponse,
)


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


def model_to_deferred_question_response(
    question: DeferredQuestion,
) -> DeferredQuestionResponse:
    """Convert DeferredQuestion model to DeferredQuestionResponse schema."""
    return DeferredQuestionResponse(
        id=question.id,
        task_run_id=question.task_run_id,
        iteration=question.iteration,
        question=question.question,
        context_json=question.context_json,
        auto_decision_type=question.auto_decision_type,
        auto_decision_detail=question.auto_decision_detail,
        confidence=question.confidence,
        risk_level=question.risk_level,
        status=question.status,
        git_checkpoint=question.git_checkpoint,
        contingent_iterations=question.contingent_iterations,
        reviewer_comment=question.reviewer_comment,
        created_at=question.created_at,
        reviewed_at=question.reviewed_at,
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
