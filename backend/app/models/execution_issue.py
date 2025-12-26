"""
Unified execution issue model for tracking issues detected during execution.

Replaces TestDeficiency + DetectedIssue models with a single unified model
that tracks all types of issues: visual regression, element not found,
state mismatch, timeouts, assertions, etc.
"""

from datetime import datetime
from enum import Enum as PyEnum
from uuid import UUID, uuid4

from sqlalchemy import DateTime, Enum, ForeignKey, String, Text, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class ExecutionIssueType(str, PyEnum):
    """Execution issue type enumeration."""

    VISUAL_REGRESSION = "visual_regression"
    ELEMENT_NOT_FOUND = "element_not_found"
    STATE_MISMATCH = "state_mismatch"
    TIMEOUT = "timeout"
    ASSERTION_FAILED = "assertion_failed"
    NAVIGATION_ERROR = "navigation_error"
    SCRIPT_ERROR = "script_error"
    PERFORMANCE = "performance"
    ACCESSIBILITY = "accessibility"
    OTHER = "other"


class ExecutionIssueSeverity(str, PyEnum):
    """Execution issue severity enumeration."""

    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"
    INFO = "info"


class ExecutionIssueStatus(str, PyEnum):
    """Execution issue status enumeration."""

    OPEN = "open"
    IN_PROGRESS = "in_progress"
    RESOLVED = "resolved"
    WONT_FIX = "wont_fix"
    DUPLICATE = "duplicate"
    CANNOT_REPRODUCE = "cannot_reproduce"


class ExecutionIssueSource(str, PyEnum):
    """Execution issue detection source enumeration."""

    AUTOMATION = "automation"
    AI_ANALYSIS = "ai_analysis"
    VISUAL_REGRESSION = "visual_regression"
    USER_REPORTED = "user_reported"


class ExecutionIssue(Base):
    """
    Unified execution issue tracking issues detected during execution.

    Replaces TestDeficiency + DetectedIssue with a single unified model.
    """

    __tablename__ = "execution_issues"

    # Primary key
    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
        server_default=text("gen_random_uuid()"),
    )

    # Foreign keys
    run_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("execution_runs.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    action_execution_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("action_executions.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    assigned_to_user_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # Issue classification
    issue_type: Mapped[str] = mapped_column(
        Enum(
            ExecutionIssueType,
            name="execution_issue_type",
            create_type=False,
            values_callable=lambda x: [e.value for e in x],
        ),
        nullable=False,
        index=True,
    )

    severity: Mapped[str] = mapped_column(
        Enum(
            ExecutionIssueSeverity,
            name="execution_issue_severity",
            create_type=False,
            values_callable=lambda x: [e.value for e in x],
        ),
        nullable=False,
        index=True,
    )

    status: Mapped[str] = mapped_column(
        Enum(
            ExecutionIssueStatus,
            name="execution_issue_status",
            create_type=False,
            values_callable=lambda x: [e.value for e in x],
        ),
        nullable=False,
        default=ExecutionIssueStatus.OPEN,
        index=True,
    )

    source: Mapped[str] = mapped_column(
        Enum(
            ExecutionIssueSource,
            name="execution_issue_source",
            create_type=False,
            values_callable=lambda x: [e.value for e in x],
        ),
        nullable=False,
        index=True,
    )

    # Issue details
    title: Mapped[str] = mapped_column(
        String(500),
        nullable=False,
    )

    description: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )

    # State context
    state_name: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
        index=True,
        comment="State where issue was detected",
    )

    # Related screenshots (array of UUIDs)
    screenshot_ids: Mapped[list] = mapped_column(
        JSONB,
        nullable=False,
        default=list,
        server_default=text("'[]'::jsonb"),
        comment="Array of screenshot UUIDs related to this issue",
    )

    # Reproduction information
    reproduction_steps: Mapped[list] = mapped_column(
        JSONB,
        nullable=False,
        default=list,
        server_default=text("'[]'::jsonb"),
        comment="Array of steps to reproduce the issue",
    )

    # Error details
    error_details: Mapped[dict] = mapped_column(
        JSONB,
        nullable=False,
        default=dict,
        server_default=text("'{}'::jsonb"),
        comment="Detailed error information: stack trace, logs, etc.",
    )

    # Additional metadata
    extra_metadata: Mapped[dict] = mapped_column(
        "metadata",  # DB column name stays 'metadata' for compatibility
        JSONB,
        nullable=False,
        default=dict,
        server_default=text("'{}'::jsonb"),
        comment="Additional issue metadata",
    )

    # Resolution
    resolution_notes: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    # Audit timestamps
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=datetime.utcnow,
        server_default=text("now()"),
    )

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        server_default=text("now()"),
    )

    # Relationships
    run = relationship("ExecutionRun", back_populates="issues")

    action_execution = relationship("ActionExecution", back_populates="issues")

    assigned_to = relationship("User", back_populates="assigned_execution_issues")

    def __repr__(self) -> str:
        """Return string representation of ExecutionIssue."""
        return f"<ExecutionIssue(id={self.id}, type='{self.issue_type}', severity='{self.severity}')>"
