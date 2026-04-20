"""
Coverage snapshot model for tracking coverage metrics over time.

Stores point-in-time coverage metrics enabling trend visualization
and comparative analysis across test runs.
"""

from datetime import UTC, datetime
from decimal import Decimal
from uuid import UUID, uuid4

from sqlalchemy import DateTime, ForeignKey, Integer, Numeric, String, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class CoverageSnapshot(Base):
    """
    Track coverage metrics over time for trend analysis.

    Stores point-in-time coverage metrics enabling trend visualization
    and comparative analysis across test runs.
    """

    __tablename__ = "coverage_snapshots"

    # Primary key
    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
        server_default=text("gen_random_uuid()"),
    )

    # Foreign keys
    test_run_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("software_test_runs.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )

    project_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Workflow identification
    workflow_id: Mapped[str | None] = mapped_column(
        String(255), nullable=True, index=True
    )

    # Snapshot timing
    snapshot_time: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(UTC),
        index=True,
    )

    # Transition coverage
    transitions_covered: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    transitions_total: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    coverage_percentage: Mapped[Decimal] = mapped_column(
        Numeric(5, 2), nullable=False, default=Decimal("0.00"), index=True
    )

    # State coverage
    states_covered: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    states_total: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    state_coverage_percentage: Mapped[Decimal] = mapped_column(
        Numeric(5, 2), nullable=False, default=Decimal("0.00")
    )

    # Path metrics
    paths_discovered: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    unique_paths: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Coverage map (detailed breakdown)
    coverage_map: Mapped[dict] = mapped_column(
        JSONB,
        nullable=False,
        default=dict,
        comment="{transition_id: execution_count, ...}",
    )

    state_coverage_map: Mapped[dict] = mapped_column(
        JSONB, nullable=False, default=dict, comment="{state_id: visit_count, ...}"
    )

    uncovered_transitions: Mapped[list] = mapped_column(
        JSONB, nullable=False, default=list, comment="Array of transition IDs"
    )

    uncovered_states: Mapped[list] = mapped_column(
        JSONB, nullable=False, default=list, comment="Array of state IDs"
    )

    # Metadata
    snapshot_metadata: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)

    # Audit
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(UTC)
    )

    # Relationships
    test_run = relationship("SoftwareTestRun", back_populates="coverage_snapshots")

    project = relationship("Project", back_populates="coverage_snapshots")

    def __repr__(self) -> str:
        return f"<CoverageSnapshot(id={self.id}, coverage={self.coverage_percentage}%)>"
