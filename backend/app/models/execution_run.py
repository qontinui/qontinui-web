"""
Unified execution run model for tracking all types of execution sessions.

Replaces the fragmented SoftwareTestRun + AutomationSession models with a single
unified model supporting multiple run types: QA testing, integration testing,
live automation, recording sessions, and debug runs.
"""

from datetime import datetime
from enum import Enum as PyEnum
from uuid import UUID, uuid4

from qontinui_schemas.common import utc_now
from sqlalchemy import DateTime, Enum, ForeignKey, Integer, String, Text, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class ExecutionRunType(str, PyEnum):
    """Execution run type enumeration."""

    QA_TEST = "qa_test"
    INTEGRATION_TEST = "integration_test"
    LIVE_AUTOMATION = "live_automation"
    RECORDING = "recording"
    DEBUG = "debug"


class ExecutionRunStatus(str, PyEnum):
    """Execution run status enumeration."""

    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    TIMEOUT = "timeout"
    CANCELLED = "cancelled"
    PAUSED = "paused"


class ExecutionRun(Base):
    """
    Unified execution run tracking all types of execution sessions.

    Replaces SoftwareTestRun + AutomationSession with a single unified model.
    Supports QA testing, integration testing, live automation, recording, and debug runs.
    """

    __tablename__ = "execution_runs"

    # Primary key
    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
        server_default=text("gen_random_uuid()"),
    )

    # Foreign keys
    project_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    created_by_user_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # Run identification and type
    run_type: Mapped[str] = mapped_column(
        Enum(
            ExecutionRunType,
            name="execution_run_type",
            create_type=False,
            values_callable=lambda x: [e.value for e in x],
        ),
        nullable=False,
        index=True,
    )

    run_name: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
    )

    description: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    # Status tracking
    status: Mapped[str] = mapped_column(
        Enum(
            ExecutionRunStatus,
            name="execution_run_status",
            create_type=False,
            values_callable=lambda x: [e.value for e in x],
        ),
        nullable=False,
        default=ExecutionRunStatus.RUNNING,
        index=True,
    )

    # Timestamps
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=utc_now,
        index=True,
    )

    ended_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    duration_seconds: Mapped[int | None] = mapped_column(
        Integer,
        nullable=True,
        comment="Total run duration in seconds",
    )

    # Metadata as JSONB
    runner_metadata: Mapped[dict] = mapped_column(
        JSONB,
        nullable=False,
        default=dict,
        server_default=text("'{}'::jsonb"),
        comment="Runner info: version, os, hostname, capabilities",
    )

    workflow_metadata: Mapped[dict | None] = mapped_column(
        JSONB,
        nullable=True,
        comment="Workflow info: workflow_id, workflow_name, version",
    )

    configuration: Mapped[dict] = mapped_column(
        JSONB,
        nullable=False,
        default=dict,
        server_default=text("'{}'::jsonb"),
        comment="Run configuration: timeouts, retries, environment",
    )

    # Statistics and coverage
    stats: Mapped[dict] = mapped_column(
        JSONB,
        nullable=False,
        default=dict,
        server_default=text("'{}'::jsonb"),
        comment="Run statistics: total_actions, successful_actions, failed_actions",
    )

    coverage_data: Mapped[dict | None] = mapped_column(
        JSONB,
        nullable=True,
        comment="Coverage data: states_visited, transitions_executed, etc.",
    )

    # Configuration
    max_duration_seconds: Mapped[int | None] = mapped_column(
        Integer,
        nullable=True,
        comment="Maximum allowed duration before timeout",
    )

    # Error tracking
    error_message: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    # Audit timestamps
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=utc_now,
        server_default=text("now()"),
    )

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=utc_now,
        onupdate=utc_now,
        server_default=text("now()"),
    )

    # Relationships
    project = relationship("Project", back_populates="execution_runs")

    created_by = relationship("User", back_populates="execution_runs")

    action_executions = relationship(
        "ActionExecution",
        back_populates="run",
        cascade="all, delete-orphan",
        lazy="select",
    )

    screenshots = relationship(
        "ExecutionScreenshot",
        back_populates="run",
        cascade="all, delete-orphan",
        lazy="select",
    )

    issues = relationship(
        "ExecutionIssue",
        back_populates="run",
        cascade="all, delete-orphan",
        lazy="select",
    )

    tree_events = relationship(
        "ExecutionTreeEvent",
        back_populates="run",
        cascade="all, delete-orphan",
        lazy="select",
    )

    test_results = relationship(
        "TestResult",
        back_populates="execution_run",
        cascade="all, delete-orphan",
        lazy="select",
    )

    def __repr__(self) -> str:
        """Return string representation of ExecutionRun."""
        return f"<ExecutionRun(id={self.id}, run_type='{self.run_type}', status='{self.status}')>"
