"""
Workflow Execution History Model

Extends AutomationSession with workflow-specific metadata for execution tracking.
Optional table for detailed workflow execution history.
"""

from datetime import datetime
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import DateTime, ForeignKey, Integer, String, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.automation_session import AutomationSession


class WorkflowExecutionHistory(Base):
    """
    Workflow-specific execution history.

    Extends AutomationSession with workflow metadata like workflow_id,
    execution results, state transitions, and statistics.

    Note: This table is optional. Most execution data can be stored in
    AutomationSession.configuration_snapshot. Use this table only if you
    need structured query support for workflow-specific fields.
    """

    __tablename__ = "workflow_execution_history"
    __table_args__ = {'schema': "project"}

    id: Mapped[UUID] = mapped_column(
        primary_key=True, server_default=text("gen_random_uuid()")
    )

    # Link to automation session (one-to-one)
    session_id: Mapped[UUID] = mapped_column(
        ForeignKey("project.automation_sessions.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
    )

    # Workflow identification
    workflow_id: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    workflow_name: Mapped[str] = mapped_column(String(255), nullable=False)

    # Execution metadata
    monitor_index: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    execution_status: Mapped[str] = mapped_column(
        String(50), nullable=False, index=True
    )
    # Values: running, completed, failed, stopped, timeout

    # Execution results (JSONB)
    results: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    # Stores: final state, output data, error details, etc.

    # Statistics
    total_states_visited: Mapped[int | None] = mapped_column(Integer, nullable=True)
    total_transitions: Mapped[int | None] = mapped_column(Integer, nullable=True)
    error_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Timestamps
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # Relationships
    session: Mapped["AutomationSession"] = relationship(
        "AutomationSession", back_populates="execution_history"
    )

    def calculate_duration_seconds(self) -> float | None:
        """
        Calculate execution duration in seconds.

        Returns:
            Duration in seconds, or None if not completed
        """
        if self.completed_at is None:
            return None
        return (self.completed_at - self.started_at).total_seconds()

    def __repr__(self) -> str:
        return f"<WorkflowExecutionHistory(id={self.id}, workflow='{self.workflow_name}', status='{self.execution_status}')>"
