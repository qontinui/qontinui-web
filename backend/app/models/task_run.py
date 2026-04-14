"""
Task Run models for tracking unified task execution.

This module provides models for task runs, which unify AI-assisted workflows
and GUI automation under a single concept. A TaskRun can represent:
- Pure AI tasks (Claude analysis)
- Pure automation tasks (GUI automation)
- Mixed tasks (AI-driven automation)

Migrated from ai_task.py - renamed for unified architecture.
"""

from datetime import UTC, datetime
from enum import StrEnum
from uuid import UUID, uuid4

from app.db.base import Base
from sqlalchemy import (
    Boolean,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship


class TaskType(StrEnum):
    """Task type enumeration for unified task runs."""

    TASK = "task"  # General AI task
    AUTOMATION = "automation"  # Pure GUI automation
    SCHEDULED = "scheduled"  # Scheduled/triggered task


class TaskRunStatus(StrEnum):
    """Task run status enumeration."""

    RUNNING = "running"
    COMPLETE = "complete"
    FAILED = "failed"
    STOPPED = "stopped"


class FindingCategory(StrEnum):
    """Task run finding category enumeration."""

    CODE_BUG = "code_bug"
    SECURITY = "security"
    PERFORMANCE = "performance"
    TODO = "todo"
    ENHANCEMENT = "enhancement"
    CONFIG_ISSUE = "config_issue"
    TEST_ISSUE = "test_issue"
    DOCUMENTATION = "documentation"
    RUNTIME_ISSUE = "runtime_issue"
    ALREADY_FIXED = "already_fixed"
    EXPECTED_BEHAVIOR = "expected_behavior"


class FindingSeverity(StrEnum):
    """Task run finding severity enumeration."""

    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"
    INFO = "info"


class FindingStatus(StrEnum):
    """Task run finding status enumeration."""

    DETECTED = "detected"
    IN_PROGRESS = "in_progress"
    NEEDS_INPUT = "needs_input"
    RESOLVED = "resolved"
    WONT_FIX = "wont_fix"
    DEFERRED = "deferred"


class FindingActionType(StrEnum):
    """Task run finding action type enumeration."""

    AUTO_FIX = "auto_fix"
    NEEDS_USER_INPUT = "needs_user_input"
    INFORMATIONAL = "informational"


class TaskRun(Base):
    """
    Unified Task Run model.

    Represents any task execution - AI analysis, GUI automation, or mixed.
    This is the single source of truth for all task tracking.

    Maps from runner's TaskRun model, with optional project association.
    Stores summary data by default; full output is optional (premium feature).
    """

    __tablename__ = "task_runs"

    # Primary key - use runner's UUID to allow direct mapping
    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
        server_default=text("gen_random_uuid()"),
    )

    # Optional project association (nullable for local-only development)
    project_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # User who created the task
    created_by_user_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # Runner identification (for multi-runner setups)
    runner_id: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
        index=True,
        comment="Runner instance identifier",
    )

    # Task identification
    task_name: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
    )

    prompt: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,  # NULL for pure automation tasks
        comment="The task description/instructions (NULL for pure automation)",
    )

    # === NEW: Unified Task Type ===
    task_type: Mapped[str] = mapped_column(
        Enum(
            TaskType,
            name="task_type",
            create_type=False,
            values_callable=lambda x: [e.value for e in x],
        ),
        nullable=False,
        default=TaskType.TASK,
        index=True,
        comment="Type of task: task, automation, scheduled",
    )

    # === NEW: Config linkage for automation-enabled tasks ===
    config_id: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
        index=True,
        comment="Config ID for automation tasks (references runner's configs table)",
    )

    workflow_name: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
        comment="Workflow name for automation tasks",
    )

    # Status tracking
    status: Mapped[str] = mapped_column(
        Enum(
            TaskRunStatus,
            name="task_run_status",
            create_type=False,
            values_callable=lambda x: [e.value for e in x],
        ),
        nullable=False,
        default=TaskRunStatus.RUNNING,
        index=True,
    )

    # Session tracking (for AI-enabled tasks)
    sessions_count: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        comment="Number of Claude sessions spawned",
    )

    max_sessions: Mapped[int | None] = mapped_column(
        Integer,
        nullable=True,
        comment="Maximum sessions before giving up (null = unlimited)",
    )

    auto_continue: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
        comment="Whether to automatically spawn new sessions",
    )

    # Output/Summary (renamed from ai_summary)
    output_summary: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
        comment="Summary of task output for display",
    )

    summary: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
        comment="Post-completion summary (AI-generated analysis)",
    )

    goal_achieved: Mapped[bool | None] = mapped_column(
        Boolean,
        nullable=True,
        comment="Whether the task goal was achieved",
    )

    remaining_work: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
        comment="Description of remaining work if goal not fully achieved",
    )

    summary_generated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        comment="When the summary was generated",
    )

    # Full output (optional - may be premium feature)
    full_output_stored: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        comment="Whether full output is stored",
    )

    full_output: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
        comment="Complete Claude conversation history (premium)",
    )

    # === NEW: Execution configuration ===
    execution_steps_json: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
        comment="JSON array of execution steps configuration",
    )

    log_sources_json: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
        comment="JSON array of log sources to capture",
    )

    # Error handling
    error_message: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    # Duration tracking
    duration_seconds: Mapped[int | None] = mapped_column(
        Integer,
        nullable=True,
        comment="Total task duration in seconds",
    )

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(UTC),
        server_default=text("now()"),
    )

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
        server_default=text("now()"),
    )

    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    # Relationships
    project = relationship("Project", back_populates="task_runs")

    created_by = relationship("User", back_populates="task_runs")

    sessions = relationship(
        "TaskRunSession",
        back_populates="task_run",
        cascade="all, delete-orphan",
        lazy="select",
        order_by="TaskRunSession.session_number",
    )

    findings = relationship(
        "TaskRunFinding",
        back_populates="task_run",
        cascade="all, delete-orphan",
        lazy="select",
    )

    automations = relationship(
        "TaskRunAutomation",
        back_populates="task_run",
        cascade="all, delete-orphan",
        lazy="select",
    )

    test_results = relationship(
        "TestResult",
        back_populates="task_run",
        cascade="all, delete-orphan",
        lazy="select",
    )

    verification_results = relationship(
        "TaskRunVerificationResult",
        back_populates="task_run",
        cascade="all, delete-orphan",
        lazy="select",
        order_by="TaskRunVerificationResult.iteration",
    )

    deferred_questions = relationship(
        "DeferredQuestion",
        back_populates="task_run",
        cascade="all, delete-orphan",
        lazy="select",
        order_by="DeferredQuestion.created_at",
    )

    def __repr__(self) -> str:
        """Return string representation of TaskRun."""
        return f"<TaskRun(id={self.id}, name='{self.task_name}', type='{self.task_type}', status='{self.status}')>"


class TaskRunSession(Base):
    """Individual Claude session within a Task Run."""

    __tablename__ = "task_run_sessions"

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
        server_default=text("gen_random_uuid()"),
    )

    task_run_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("task_runs.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    session_number: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        comment="Session number within the task (1-indexed)",
    )

    # Timestamps
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(UTC),
        server_default=text("now()"),
    )

    ended_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    duration_seconds: Mapped[int | None] = mapped_column(
        Integer,
        nullable=True,
        comment="Session duration in seconds",
    )

    # Output summary for this session
    output_summary: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
        comment="Summary of session output",
    )

    # Relationship
    task_run = relationship("TaskRun", back_populates="sessions")

    def __repr__(self) -> str:
        """Return string representation of TaskRunSession."""
        return f"<TaskRunSession(id={self.id}, task_run_id={self.task_run_id}, session={self.session_number})>"


class TaskRunFinding(Base):
    """Finding detected during a task run."""

    __tablename__ = "task_run_findings"

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
        server_default=text("gen_random_uuid()"),
    )

    task_run_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("task_runs.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Finding classification
    category: Mapped[str] = mapped_column(
        Enum(
            FindingCategory,
            name="finding_category",
            create_type=False,
            values_callable=lambda x: [e.value for e in x],
        ),
        nullable=False,
        index=True,
    )

    severity: Mapped[str] = mapped_column(
        Enum(
            FindingSeverity,
            name="finding_severity",
            create_type=False,
            values_callable=lambda x: [e.value for e in x],
        ),
        nullable=False,
        index=True,
    )

    status: Mapped[str] = mapped_column(
        Enum(
            FindingStatus,
            name="finding_status",
            create_type=False,
            values_callable=lambda x: [e.value for e in x],
        ),
        nullable=False,
        default=FindingStatus.DETECTED,
        index=True,
    )

    action_type: Mapped[str] = mapped_column(
        Enum(
            FindingActionType,
            name="finding_action_type",
            create_type=False,
            values_callable=lambda x: [e.value for e in x],
        ),
        nullable=False,
        default=FindingActionType.AUTO_FIX,
    )

    # Deduplication
    signature_hash: Mapped[str | None] = mapped_column(
        String(64),
        nullable=True,
        index=True,
        comment="Hash for finding deduplication",
    )

    # Finding content
    title: Mapped[str] = mapped_column(
        String(500),
        nullable=False,
    )

    description: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )

    resolution: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
        comment="How the finding was resolved",
    )

    # Code context
    file_path: Mapped[str | None] = mapped_column(
        String(1000),
        nullable=True,
        comment="File path where finding was detected",
    )

    line_number: Mapped[int | None] = mapped_column(
        Integer,
        nullable=True,
    )

    column_number: Mapped[int | None] = mapped_column(
        Integer,
        nullable=True,
    )

    code_snippet: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
        comment="Code snippet showing the issue",
    )

    # Session tracking
    detected_in_session: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        comment="Session number where finding was detected",
    )

    resolved_in_session: Mapped[int | None] = mapped_column(
        Integer,
        nullable=True,
        comment="Session number where finding was resolved",
    )

    # User input handling
    needs_input: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        comment="Whether user input is required",
    )

    question: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
        comment="Question to ask user if input needed",
    )

    input_options: Mapped[list | None] = mapped_column(
        JSONB,
        nullable=True,
        comment="Array of options for user selection",
    )

    user_response: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
        comment="User's response to the question",
    )

    # Timestamps
    detected_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(UTC),
        server_default=text("now()"),
    )

    resolved_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
        server_default=text("now()"),
    )

    # Relationship
    task_run = relationship("TaskRun", back_populates="findings")

    def __repr__(self) -> str:
        """Return string representation of TaskRunFinding."""
        return f"<TaskRunFinding(id={self.id}, category='{self.category}', severity='{self.severity}')>"


class DeferredQuestion(Base):
    """Deferred question from autonomous workflow execution.

    Questions that were deferred during autonomous execution for later
    human review. Synced from runner to enable cross-computer viewing.
    """

    __tablename__ = "deferred_questions"

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
        server_default=text("gen_random_uuid()"),
    )

    task_run_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("task_runs.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    iteration: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        comment="Iteration number when question was raised",
    )

    question: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        comment="The deferred question text",
    )

    context_json: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        default="{}",
        server_default=text("'{}'"),
        comment="JSON context for the question",
    )

    auto_decision_type: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
        comment="Type of automatic decision made (e.g., proceed, skip, defer)",
    )

    auto_decision_detail: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
        comment="Detail of the automatic decision",
    )

    confidence: Mapped[float] = mapped_column(
        Float,
        nullable=False,
        comment="Confidence level of the auto-decision (0.0-1.0)",
    )

    risk_level: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        comment="Risk level: low, medium, high, critical",
    )

    status: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        default="pending",
        server_default=text("'pending'"),
        index=True,
        comment="Review status: pending, approved, rejected, revisit",
    )

    git_checkpoint: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
        comment="Git commit/ref at the time of the question",
    )

    contingent_iterations: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        default="[]",
        server_default=text("'[]'"),
        comment="JSON array of iteration numbers contingent on this question",
    )

    reviewer_comment: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
        comment="Reviewer's comment when reviewing the question",
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(UTC),
        server_default=text("now()"),
    )

    reviewed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    # Relationship
    task_run = relationship("TaskRun", back_populates="deferred_questions")

    def __repr__(self) -> str:
        """Return string representation of DeferredQuestion."""
        return f"<DeferredQuestion(id={self.id}, iteration={self.iteration}, status='{self.status}')>"


class TaskRunAutomation(Base):
    """
    Automation execution record within a Task Run.

    Records details of GUI automation execution as a child of TaskRun.
    Replaces the old run_details concept from the runner.
    """

    __tablename__ = "task_run_automations"

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
        server_default=text("gen_random_uuid()"),
    )

    task_run_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("task_runs.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Workflow details
    workflow_name: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
    )

    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(UTC),
        server_default=text("now()"),
    )

    ended_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    duration_ms: Mapped[int | None] = mapped_column(
        Integer,
        nullable=True,
    )

    # Status
    automation_status: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        default="running",
        comment="Automation status: running, completed, failed, timeout",
    )

    success: Mapped[bool | None] = mapped_column(
        Boolean,
        nullable=True,
    )

    error_type: Mapped[str | None] = mapped_column(
        String(100),
        nullable=True,
    )

    error_message: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    # Metrics (stored as JSON)
    actions_summary: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
        comment="JSON summary of actions executed",
    )

    states_visited: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
        comment="JSON list of states visited",
    )

    transitions_executed: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
        comment="JSON list of transitions executed",
    )

    template_matches: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
        comment="JSON list of template match results",
    )

    anomalies: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
        comment="JSON list of detected anomalies",
    )

    screenshots: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
        comment="JSON list of screenshot records",
    )

    # Iteration tracking
    iteration_number: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=1,
        comment="Iteration number within the task run",
    )

    # Relationship
    task_run = relationship("TaskRun", back_populates="automations")

    def __repr__(self) -> str:
        """Return string representation of TaskRunAutomation."""
        return f"<TaskRunAutomation(id={self.id}, task_run_id={self.task_run_id}, status='{self.automation_status}')>"


# =============================================================================
# Backward compatibility aliases (deprecated, will be removed)
# =============================================================================

# These aliases allow existing code to continue working during migration
AITask = TaskRun
AITaskSession = TaskRunSession
AITaskFinding = TaskRunFinding
AITaskStatus = TaskRunStatus
AITaskFindingCategory = FindingCategory
AITaskFindingSeverity = FindingSeverity
AITaskFindingStatus = FindingStatus
AITaskFindingActionType = FindingActionType
