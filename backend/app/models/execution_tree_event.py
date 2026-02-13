"""
Execution tree event database model.

Stores tree events from the qontinui execution engine for historical
analysis and playback. Tree events represent the hierarchical execution
of workflows, actions, and transitions.
"""

from datetime import datetime
from enum import StrEnum
from uuid import UUID, uuid4

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class TreeNodeType(StrEnum):
    """Types of nodes in the execution tree."""

    WORKFLOW = "workflow"
    ACTION = "action"
    TRANSITION = "transition"


class TreeEventType(StrEnum):
    """Types of tree events."""

    WORKFLOW_STARTED = "workflow_started"
    WORKFLOW_COMPLETED = "workflow_completed"
    WORKFLOW_FAILED = "workflow_failed"
    ACTION_STARTED = "action_started"
    ACTION_COMPLETED = "action_completed"
    ACTION_FAILED = "action_failed"
    TRANSITION_STARTED = "transition_started"
    TRANSITION_COMPLETED = "transition_completed"
    TRANSITION_FAILED = "transition_failed"


class TreeNodeStatus(StrEnum):
    """Status of a tree node."""

    PENDING = "pending"
    RUNNING = "running"
    SUCCESS = "success"
    FAILED = "failed"


class ExecutionTreeEvent(Base):
    """
    Stored tree event from execution.

    Captures individual tree events emitted during workflow execution.
    Each event represents a state change in the execution tree (workflow
    started, action completed, etc.).
    """

    __tablename__ = "execution_tree_events"

    # Primary key
    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
        server_default=text("gen_random_uuid()"),
    )

    # Foreign key to execution run
    run_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("execution_runs.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Event identification
    event_type: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        index=True,
        comment="Type of tree event (workflow_started, action_completed, etc.)",
    )

    # Node identification
    node_id: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
        comment="Unique identifier of the node within this execution",
    )

    node_type: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        comment="Type of node (workflow, action, transition)",
    )

    node_name: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        comment="Display name of the node",
    )

    # Hierarchy
    parent_node_id: Mapped[str | None] = mapped_column(
        String(100),
        nullable=True,
        comment="Parent node ID, null for root nodes",
    )

    path: Mapped[list | None] = mapped_column(
        JSONB,
        nullable=True,
        comment="Path from root to this node (list of PathElement objects)",
    )

    # Ordering
    sequence: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        comment="Sequence number for event ordering within a run",
    )

    # Timing
    event_timestamp: Mapped[float] = mapped_column(
        Float,
        nullable=False,
        comment="When this event was emitted (Unix epoch in seconds)",
    )

    node_start_timestamp: Mapped[float | None] = mapped_column(
        Float,
        nullable=True,
        comment="When the node started (Unix epoch)",
    )

    node_end_timestamp: Mapped[float | None] = mapped_column(
        Float,
        nullable=True,
        comment="When the node completed (Unix epoch)",
    )

    duration_ms: Mapped[float | None] = mapped_column(
        Float,
        nullable=True,
        comment="Node duration in milliseconds",
    )

    # Status
    status: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        comment="Node status (pending, running, success, failed)",
    )

    error_message: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
        comment="Error message if the node failed",
    )

    # State context (for state machine tracking)
    active_states_before: Mapped[list | None] = mapped_column(
        JSONB,
        nullable=True,
        comment="Active states before this event",
    )

    active_states_after: Mapped[list | None] = mapped_column(
        JSONB,
        nullable=True,
        comment="Active states after this event",
    )

    states_changed: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        nullable=False,
        comment="Whether the active states changed",
    )

    # Full metadata (flexible storage for all node metadata)
    # Note: 'metadata' is reserved in SQLAlchemy, so we use 'node_metadata'
    node_metadata: Mapped[dict | None] = mapped_column(
        JSONB,
        nullable=True,
        comment="Full node metadata including runtime data, timing, outcome, etc.",
    )

    # Audit timestamp
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=datetime.utcnow,
        server_default=text("now()"),
    )

    # Relationships
    run = relationship("ExecutionRun", back_populates="tree_events")

    # Composite indexes for common query patterns
    __table_args__ = (
        Index("ix_tree_events_run_sequence", "run_id", "sequence"),
        Index("ix_tree_events_run_node_type", "run_id", "node_type"),
        Index("ix_tree_events_run_event_type", "run_id", "event_type"),
        Index("ix_tree_events_run_node_id", "run_id", "node_id"),
    )

    def __repr__(self) -> str:
        """Return string representation of ExecutionTreeEvent."""
        return f"<ExecutionTreeEvent(id={self.id}, event_type='{self.event_type}', node_name='{self.node_name}')>"
