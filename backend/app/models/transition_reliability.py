"""
Transition reliability model for aggregate reliability statistics per transition.

Tracks historical reliability, calculates success rates,
and identifies flaky or unreliable transitions.
"""

from datetime import UTC, datetime
from decimal import Decimal
from uuid import UUID, uuid4

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, Numeric, String, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class TransitionReliability(Base):
    """
    Aggregate reliability statistics per transition.

    Tracks historical reliability, calculates success rates,
    and identifies flaky or unreliable transitions.
    """

    __tablename__ = "transition_reliability"

    # Primary key
    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
        server_default=text("gen_random_uuid()"),
    )

    # Foreign key
    project_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Workflow and transition identification
    workflow_id: Mapped[str | None] = mapped_column(
        String(255), nullable=True, index=True
    )

    transition_id: Mapped[str] = mapped_column(String(255), nullable=False, index=True)

    # Execution counts
    total_executions: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    successful_executions: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0
    )

    failed_executions: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    timeout_executions: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Success rate
    success_rate: Mapped[Decimal] = mapped_column(
        Numeric(5, 2),
        nullable=False,
        default=Decimal("0.00"),
        index=True,
        comment="Percentage",
    )

    # Performance metrics
    avg_execution_time_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)

    min_execution_time_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)

    max_execution_time_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)

    stddev_execution_time_ms: Mapped[Decimal | None] = mapped_column(
        Numeric(10, 2), nullable=True
    )

    # Timing
    first_executed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    last_executed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )

    last_success_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    last_failure_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # Failure analysis
    failure_patterns: Mapped[dict] = mapped_column(
        JSONB, nullable=False, default=dict, comment="{error_type: count, ...}"
    )

    common_errors: Mapped[list] = mapped_column(
        JSONB, nullable=False, default=list, comment='Array of {error: "", count: N}'
    )

    # Flakiness detection
    consecutive_successes: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0
    )

    consecutive_failures: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0
    )

    is_flaky: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, index=True, comment="Auto-calculated"
    )

    flakiness_score: Mapped[Decimal | None] = mapped_column(
        Numeric(5, 2), nullable=True, comment="0-100, higher = more flaky"
    )

    # Metadata
    reliability_metadata: Mapped[dict] = mapped_column(
        JSONB, nullable=False, default=dict
    )

    # Audit
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(UTC)
    )

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
    )

    last_calculated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(UTC)
    )

    # Relationships
    project = relationship("Project", back_populates="transition_reliability_stats")

    def __repr__(self) -> str:
        return f"<TransitionReliability(transition_id='{self.transition_id}', success_rate={self.success_rate}%)>"
