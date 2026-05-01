"""
Test deficiency model for tracking bugs, issues, and anomalies discovered during testing.

Catalogs all deficiencies found with reproduction steps, visual evidence,
and lifecycle tracking for issue management.
"""

from datetime import UTC, datetime
from decimal import Decimal
from enum import StrEnum
from uuid import UUID, uuid4

from sqlalchemy import (
    Boolean,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class DeficiencySeverity(StrEnum):
    """Deficiency severity levels."""

    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"
    INFO = "info"


class DeficiencyType(StrEnum):
    """Deficiency type classification."""

    CRASH = "crash"
    TIMEOUT = "timeout"
    VISUAL = "visual"
    FUNCTIONAL = "functional"
    PERFORMANCE = "performance"
    DATA = "data"
    ACCESSIBILITY = "accessibility"
    SECURITY = "security"


class DeficiencyStatus(StrEnum):
    """Deficiency lifecycle status."""

    NEW = "new"
    TRIAGED = "triaged"
    ASSIGNED = "assigned"
    IN_PROGRESS = "in_progress"
    RESOLVED = "resolved"
    CLOSED = "closed"
    WONT_FIX = "wont_fix"


class TestDeficiency(Base):
    """
    Track bugs, issues, and anomalies discovered during testing.

    Catalogs all deficiencies found with reproduction steps, visual evidence,
    and lifecycle tracking for issue management.
    """

    __tablename__ = "test_deficiencies"
    __table_args__ = {"schema": "project"}

    # Primary key
    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
        server_default=text("gen_random_uuid()"),
    )

    # Foreign keys
    test_run_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("project.software_test_runs.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    transition_execution_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("project.transition_executions.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    assigned_to_user_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("auth.users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # Classification
    severity: Mapped[str] = mapped_column(
        Enum(DeficiencySeverity), nullable=False, index=True
    )

    deficiency_type: Mapped[str] = mapped_column(
        Enum(DeficiencyType), nullable=False, index=True
    )

    category: Mapped[str | None] = mapped_column(
        String(100), nullable=True, comment="Custom categorization"
    )

    # Description
    title: Mapped[str] = mapped_column(String(500), nullable=False)

    description: Mapped[str] = mapped_column(Text, nullable=False)

    # Visual evidence
    screenshot_urls: Mapped[list] = mapped_column(
        JSONB, nullable=False, default=list, comment="Array of S3 URLs"
    )

    video_url: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # Reproduction
    reproduction_steps: Mapped[list] = mapped_column(
        JSONB, nullable=False, default=list, comment="Array of step descriptions"
    )

    reproduction_rate: Mapped[Decimal | None] = mapped_column(
        Numeric(5, 2), nullable=True, comment="Percentage (0-100)"
    )

    reproducible: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    # Context
    environment_info: Mapped[dict] = mapped_column(
        JSONB, nullable=False, default=dict, comment="OS, browser, screen res, etc."
    )

    preconditions: Mapped[dict] = mapped_column(
        JSONB, nullable=False, default=dict, comment="Required setup"
    )

    # Lifecycle tracking
    status: Mapped[str] = mapped_column(
        Enum(DeficiencyStatus), nullable=False, default=DeficiencyStatus.NEW, index=True
    )

    resolution: Mapped[str | None] = mapped_column(
        String(100),
        nullable=True,
        comment="fixed, duplicate, wont_fix, cannot_reproduce",
    )

    # Assignment
    assigned_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # Tracking
    first_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(UTC),
        index=True,
    )

    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(UTC)
    )

    occurrence_count: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    # Links to external systems
    external_ticket_id: Mapped[str | None] = mapped_column(
        String(255), nullable=True, comment="JIRA, GitHub, etc."
    )

    external_ticket_url: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # Metadata
    tags: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)

    custom_fields: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)

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

    resolved_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # Relationships
    test_run = relationship("SoftwareTestRun", back_populates="deficiencies")

    transition_execution = relationship(
        "TransitionExecution", back_populates="deficiencies"
    )

    assigned_to = relationship("User", back_populates="assigned_deficiencies")

    screenshots = relationship(
        "TestScreenshot",
        back_populates="deficiency",
        cascade="all, delete-orphan",
        lazy="select",
    )

    def __repr__(self) -> str:
        return f"<TestDeficiency(id={self.id}, severity='{self.severity}', status='{self.status}')>"
