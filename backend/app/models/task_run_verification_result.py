"""
Task Run Verification Result model.

Stores verification phase results from unified workflow execution.
Each record captures the result of running all verification steps
in a single iteration, including summary stats and the full result JSON.
"""

from datetime import UTC, datetime
from uuid import UUID, uuid4

from app.db.base import Base
from sqlalchemy import (BigInteger, Boolean, DateTime, ForeignKey, Integer,
                        UniqueConstraint, text)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship


class TaskRunVerificationResult(Base):
    """
    Verification phase result for a task run iteration.

    Stores both summary statistics (for fast queries) and the full
    VerificationPhaseResult JSON (for detailed inspection).

    Each (task_run_id, iteration) pair is unique — upserting replaces
    the previous result for that iteration.
    """

    __tablename__ = "task_run_verification_results"

    # Primary key
    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
        server_default=text("gen_random_uuid()"),
    )

    # Foreign key to task_runs
    task_run_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("task_runs.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Iteration number (1-indexed)
    iteration: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        comment="Iteration number (1-indexed)",
    )

    # Summary statistics for fast queries
    all_passed: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        comment="Whether all verification steps passed",
    )

    total_steps: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        comment="Total number of verification steps",
    )

    passed_steps: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        comment="Number of steps that passed",
    )

    failed_steps: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        comment="Number of steps that failed",
    )

    skipped_steps: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        server_default=text("0"),
        comment="Number of steps skipped (gate stop_on_failure)",
    )

    total_duration_ms: Mapped[int] = mapped_column(
        BigInteger,
        nullable=False,
        comment="Total execution time in milliseconds",
    )

    critical_failure: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default=text("false"),
        comment="Whether a critical gate failure occurred",
    )

    # Full result JSON (stores complete VerificationPhaseResult)
    result_json: Mapped[dict] = mapped_column(
        JSONB,
        nullable=False,
        comment="Full VerificationPhaseResult JSON",
    )

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(UTC),
        server_default=text("now()"),
    )

    # Relationships
    task_run = relationship("TaskRun", back_populates="verification_results")

    # Constraints
    __table_args__ = (
        UniqueConstraint(
            "task_run_id", "iteration", name="uq_task_run_verification_iteration"
        ),
    )

    def __repr__(self) -> str:
        """Return string representation of TaskRunVerificationResult."""
        return (
            f"<TaskRunVerificationResult("
            f"id={self.id}, task_run_id={self.task_run_id}, "
            f"iteration={self.iteration}, all_passed={self.all_passed}"
            f")>"
        )
