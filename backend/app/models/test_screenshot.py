"""
Test screenshot model for storing screenshots captured during test execution.

Tracks screenshots with metadata, storage location, and associations to
test runs, transitions, and deficiencies.
"""

from datetime import UTC, datetime
from enum import StrEnum
from uuid import UUID, uuid4

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, String, Text, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class TestScreenshotType(StrEnum):
    """Screenshot type enumeration."""

    STATE_VERIFICATION = "state_verification"  # Screenshot after state detection
    ACTION_RESULT = "action_result"  # Screenshot after action execution
    FAILURE = "failure"  # Screenshot when something fails
    BEFORE_ACTION = "before_action"  # Screenshot before action
    AFTER_ACTION = "after_action"  # Screenshot after action


class TestScreenshot(Base):
    """
    Test screenshot tracking for test execution.

    Stores screenshots captured during test runs with metadata about when,
    why, and what was captured. Associates screenshots with test runs,
    transitions, and deficiencies.
    """

    __tablename__ = "test_screenshots"
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
        ForeignKey("project.transition_executions.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )

    deficiency_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("project.test_deficiencies.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )

    # Screenshot metadata
    screenshot_type: Mapped[str] = mapped_column(
        Enum(TestScreenshotType),
        nullable=False,
        index=True,
        comment="Type of screenshot (state_verification, action_result, etc.)",
    )

    # Storage information
    storage_path: Mapped[str] = mapped_column(
        String(1000),
        nullable=False,
        comment="S3/MinIO storage key",
    )

    # Image metadata
    width: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        comment="Image width in pixels",
    )

    height: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        comment="Image height in pixels",
    )

    # Capture timing
    captured_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(UTC),
        index=True,
        comment="When the screenshot was captured",
    )

    # Additional metadata
    screenshot_metadata: Mapped[dict] = mapped_column(
        JSONB,
        nullable=False,
        default=dict,
        comment="Additional metadata (confidence scores, match locations, etc.)",
    )

    # Optional description
    description: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
        comment="Optional description of what the screenshot shows",
    )

    # State identification for visual regression baseline matching
    state_name: Mapped[str | None] = mapped_column(
        String(500),
        nullable=True,
        index=True,
        comment="State name for matching against visual baselines",
    )

    # Perceptual hash for quick comparison filtering
    perceptual_hash: Mapped[str | None] = mapped_column(
        String(256),
        nullable=True,
        index=True,
        comment="Perceptual hash for quick visual comparison filtering",
    )

    # Audit timestamps
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(UTC)
    )

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
    )

    # Relationships
    test_run = relationship(
        "SoftwareTestRun",
        back_populates="screenshots",
    )

    transition_execution = relationship(
        "TransitionExecution",
        back_populates="screenshots",
    )

    deficiency = relationship(
        "TestDeficiency",
        back_populates="screenshots",
    )

    visual_comparisons = relationship(
        "VisualComparisonResult",
        back_populates="screenshot",
        cascade="all, delete-orphan",
    )

    def __repr__(self) -> str:
        return f"<TestScreenshot(id={self.id}, type='{self.screenshot_type}', test_run_id={self.test_run_id})>"
