"""
Unified action execution model for tracking individual action executions.

Replaces TransitionExecution + AutomationLog models with a single unified model
that tracks all types of actions: vision, mouse, keyboard, state transitions, etc.
"""

from datetime import UTC, datetime
from enum import StrEnum
from uuid import UUID, uuid4

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, String, Text, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class ActionExecutionType(StrEnum):
    """Action execution type enumeration."""

    # Vision actions
    FIND = "find"
    CLICK = "click"
    DOUBLE_CLICK = "double_click"
    RIGHT_CLICK = "right_click"
    TYPE = "type"
    KEY_PRESS = "key_press"
    SCROLL = "scroll"
    DRAG = "drag"
    HOVER = "hover"
    SCREENSHOT = "screenshot"
    # State actions
    GO_TO_STATE = "go_to_state"
    ASSERT_STATE = "assert_state"
    ASSERT_ELEMENT = "assert_element"
    # Custom
    CUSTOM = "custom"


class ActionExecutionStatus(StrEnum):
    """Action execution status enumeration."""

    SUCCESS = "success"
    FAILED = "failed"
    TIMEOUT = "timeout"
    SKIPPED = "skipped"
    ERROR = "error"
    PENDING = "pending"


class ActionExecution(Base):
    """
    Unified action execution tracking individual action executions within a run.

    Replaces TransitionExecution + AutomationLog with a single unified model.
    """

    __tablename__ = "action_executions"

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

    screenshot_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("execution_screenshots.id", ondelete="SET NULL"),
        nullable=True,
        comment="Primary screenshot for this action",
    )

    # Sequence and identification
    sequence_number: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        comment="Order of execution within the run",
    )

    action_type: Mapped[str] = mapped_column(
        Enum(
            ActionExecutionType,
            name="action_execution_type",
            create_type=False,
            values_callable=lambda x: [e.value for e in x],
        ),
        nullable=False,
        index=True,
    )

    action_name: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
    )

    # Status
    status: Mapped[str] = mapped_column(
        Enum(
            ActionExecutionStatus,
            name="action_execution_status",
            create_type=False,
            values_callable=lambda x: [e.value for e in x],
        ),
        nullable=False,
        index=True,
    )

    # Timestamps
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
    )

    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    duration_ms: Mapped[int | None] = mapped_column(
        Integer,
        nullable=True,
        comment="Action duration in milliseconds",
    )

    # State tracking
    from_state: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
        index=True,
        comment="Source state before action",
    )

    to_state: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
        index=True,
        comment="Expected target state after action",
    )

    actual_state: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
        comment="Actual state reached after action",
    )

    # Input/output data as JSONB
    input_data: Mapped[dict] = mapped_column(
        JSONB,
        nullable=False,
        default=dict,
        server_default=text("'{}'::jsonb"),
        comment="Action input parameters",
    )

    output_data: Mapped[dict] = mapped_column(
        JSONB,
        nullable=False,
        default=dict,
        server_default=text("'{}'::jsonb"),
        comment="Action output/results",
    )

    # Error tracking
    error_message: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    error_type: Mapped[str | None] = mapped_column(
        String(100),
        nullable=True,
        comment="Error classification: timeout, element_not_found, etc.",
    )

    # Additional metadata
    extra_metadata: Mapped[dict] = mapped_column(
        "metadata",  # DB column name stays 'metadata' for compatibility
        JSONB,
        nullable=False,
        default=dict,
        server_default=text("'{}'::jsonb"),
        comment="Additional action metadata",
    )

    # Audit timestamps
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(UTC),
        server_default=text("now()"),
    )

    # Relationships
    run = relationship("ExecutionRun", back_populates="action_executions")

    # Primary screenshot for this action (ActionExecution -> ExecutionScreenshot via screenshot_id)
    # Note: This is separate from ExecutionScreenshot.action which goes the other direction
    primary_screenshot = relationship(
        "ExecutionScreenshot",
        foreign_keys=[screenshot_id],
        uselist=False,
    )

    issues = relationship(
        "ExecutionIssue",
        back_populates="action_execution",
        lazy="select",
    )

    def __repr__(self) -> str:
        """Return string representation."""
        return f"<ActionExecution(id={self.id}, action_type='{self.action_type}', status='{self.status}')>"
