"""
Feedback score model for tracking quality metrics on execution runs and actions.

Supports the Opik integration by storing numeric and categorical feedback
scores from manual review, automated evaluation, and LLM-as-judge pipelines.
"""

from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import DateTime, Float, ForeignKey, Index, String, Text, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class FeedbackScore(Base):
    """
    Feedback score for an execution run or action execution.

    Stores quality metrics such as accuracy, helpfulness, or custom scores
    from various sources (manual, automated, LLM judge).
    """

    __tablename__ = "feedback_scores"

    # Primary key
    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
        server_default=text("gen_random_uuid()"),
    )

    # Foreign keys (nullable — exactly one should be set based on target_type)
    run_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("project.execution_runs.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
        comment="FK to execution_runs.id when target_type is 'run'",
    )

    action_execution_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("project.action_executions.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
        comment="FK to action_executions.id when target_type is 'action'",
    )

    # Score data
    name: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        comment="Score name (e.g. 'accuracy', 'helpfulness')",
    )

    value: Mapped[float] = mapped_column(
        Float,
        nullable=False,
        comment="Numeric score value",
    )

    category_value: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
        comment="Optional categorical label",
    )

    source: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        default="manual",
        server_default=text("'manual'"),
        comment="Source: manual, automated, llm_judge",
    )

    reason: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
        comment="Optional reason for the score",
    )

    metadata_: Mapped[dict | None] = mapped_column(
        "metadata",
        JSONB,
        nullable=True,
        comment="Additional metadata",
    )

    created_by: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
        comment="User or system that created the score",
    )

    # Audit timestamps
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )

    # Composite index for common query: scores by name and source
    __table_args__ = (
        Index("ix_feedback_scores_name_source", "name", "source"),
        {"schema": "project"},
    )

    # Relationships
    run = relationship("ExecutionRun", back_populates="feedback_scores")
    action_execution = relationship("ActionExecution", back_populates="feedback_scores")

    def __repr__(self) -> str:
        """Return string representation."""
        return (
            f"<FeedbackScore(id={self.id}, name='{self.name}', "
            f"value={self.value}, source='{self.source}')>"
        )
