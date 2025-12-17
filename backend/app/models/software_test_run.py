"""
Software test run model for tracking complete test sessions.

Tracks each test execution from start to finish with aggregate
statistics for quick dashboard queries and reporting.
"""

from datetime import datetime
from decimal import Decimal
from enum import Enum as PyEnum
from uuid import UUID, uuid4

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, Numeric, String, Text, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class TestRunStatus(str, PyEnum):
    """Test run status enumeration."""

    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"
    TIMEOUT = "timeout"


class SoftwareTestRun(Base):
    """
    Software test run tracking complete test sessions.

    Tracks each test execution from start to finish with aggregate
    statistics for quick dashboard queries and reporting.
    """

    __tablename__ = "software_test_runs"

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

    runner_connection_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("runner_connections.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # Workflow identification
    workflow_id: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
        index=True,
        comment="Workflow identifier from project configuration",
    )

    # Status tracking
    status: Mapped[str] = mapped_column(
        Enum(TestRunStatus),
        nullable=False,
        default=TestRunStatus.RUNNING,
        index=True,
    )

    # Timestamps
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=datetime.utcnow,
        index=True,
    )

    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # Aggregate statistics (denormalized for performance)
    total_transitions: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    successful_transitions: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0
    )

    failed_transitions: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    skipped_transitions: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Coverage metrics
    coverage_percentage: Mapped[Decimal] = mapped_column(
        Numeric(5, 2), nullable=False, default=Decimal("0.00")
    )

    unique_paths_found: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    unique_states_visited: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0
    )

    # Configuration snapshot (for reproducibility)
    configuration_snapshot: Mapped[dict] = mapped_column(
        JSONB, nullable=False, default=dict
    )

    # Test parameters
    test_mode: Mapped[str | None] = mapped_column(
        String(50),
        nullable=True,
        comment="exploration, regression, coverage, stress",
    )

    max_duration_seconds: Mapped[int] = mapped_column(
        Integer, nullable=False, default=3600
    )

    seed_value: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
        comment="For reproducible random exploration",
    )

    # Results summary
    error_summary: Mapped[str | None] = mapped_column(Text, nullable=True)

    deficiencies_found: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Metadata
    runner_metadata: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)

    tags: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)

    # Audit timestamps
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=datetime.utcnow
    )

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
    )

    # Relationships
    project = relationship("Project", back_populates="software_test_runs")

    runner_connection = relationship(
        "RunnerConnection", back_populates="software_test_runs"
    )

    transition_executions = relationship(
        "TransitionExecution",
        back_populates="test_run",
        cascade="all, delete-orphan",
        lazy="select",
    )

    deficiencies = relationship(
        "TestDeficiency",
        back_populates="test_run",
        cascade="all, delete-orphan",
        lazy="select",
    )

    coverage_snapshots = relationship(
        "CoverageSnapshot",
        back_populates="test_run",
        cascade="all, delete-orphan",
        lazy="select",
    )

    path_discoveries = relationship(
        "PathDiscovery",
        back_populates="test_run",
        cascade="all, delete-orphan",
        lazy="select",
    )

    screenshots = relationship(
        "TestScreenshot",
        back_populates="test_run",
        cascade="all, delete-orphan",
        lazy="select",
    )

    visual_comparison_results = relationship(
        "VisualComparisonResult",
        back_populates="test_run",
        cascade="all, delete-orphan",
        lazy="select",
    )

    def __repr__(self) -> str:
        return f"<SoftwareTestRun(id={self.id}, status='{self.status}', project_id={self.project_id})>"
