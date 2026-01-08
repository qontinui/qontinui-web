"""
Workflow test association model for linking verification tests to workflows.

Defines when tests should run during workflow execution (before, after,
on checkpoints, on specific actions, etc.).
"""

from datetime import datetime
from enum import Enum as PyEnum
from uuid import UUID, uuid4

from qontinui_schemas.common import utc_now
from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, Integer, String, text
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class TriggerPoint(str, PyEnum):
    """When tests should be triggered during workflow execution."""

    BEFORE_WORKFLOW = "before_workflow"
    AFTER_WORKFLOW = "after_workflow"
    ON_CHECKPOINT = "on_checkpoint"
    ON_ACTION = "on_action"
    ON_STATE_ENTRY = "on_state_entry"
    ON_STATE_EXIT = "on_state_exit"
    ON_ERROR = "on_error"


class WorkflowTestAssociation(Base):
    """
    Association between verification tests and workflows.

    Defines when and how a test should be executed in relation to
    workflow execution events.
    """

    __tablename__ = "workflow_test_associations"

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

    test_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("verification_tests.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Workflow identification (string ID, not FK - workflows are in project config)
    workflow_id: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        index=True,
        comment="Workflow ID from project configuration",
    )

    # Trigger configuration
    trigger_point: Mapped[str] = mapped_column(
        Enum(
            TriggerPoint,
            name="trigger_point",
            create_type=False,
            values_callable=lambda x: [e.value for e in x],
        ),
        nullable=False,
        index=True,
    )

    # Optional: specific checkpoint or action
    checkpoint_name: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
        comment="Checkpoint name for on_checkpoint trigger",
    )

    action_id: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
        comment="Action ID for on_action trigger",
    )

    # Execution order when multiple tests are triggered
    execution_order: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        comment="Order of execution when multiple tests triggered",
    )

    # Status
    enabled: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
        index=True,
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
    project = relationship("Project", back_populates="workflow_test_associations")

    test = relationship("VerificationTest", back_populates="workflow_associations")

    def __repr__(self) -> str:
        """Return string representation of WorkflowTestAssociation."""
        return f"<WorkflowTestAssociation(id={self.id}, workflow='{self.workflow_id}', trigger='{self.trigger_point}')>"
