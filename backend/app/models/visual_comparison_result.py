"""
Visual comparison result model for storing results of comparing screenshots against baselines.

Each comparison result tracks whether a screenshot matched its baseline,
the similarity score, and any diff regions detected.
"""

from datetime import datetime
from enum import Enum as PyEnum
from uuid import UUID, uuid4

from sqlalchemy import DateTime, Enum, Float, ForeignKey, String, Text, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class VisualComparisonStatus(str, PyEnum):
    """Status of a visual comparison."""

    PASSED = "passed"  # Screenshot matches baseline within threshold
    FAILED = "failed"  # Screenshot differs from baseline beyond threshold
    PENDING_REVIEW = "pending_review"  # Awaiting human review
    APPROVED_AS_NEW = "approved_as_new"  # Difference approved, baseline updated
    NO_BASELINE = "no_baseline"  # No baseline exists for this state


class ReviewDecision(str, PyEnum):
    """Decision made during review of a comparison result."""

    APPROVED = "approved"  # Difference is acceptable, no action needed
    REJECTED = "rejected"  # Difference is a bug, deficiency created
    NEW_BASELINE = "new_baseline"  # Difference is intentional, update baseline


class VisualComparisonResult(Base):
    """
    Result of comparing a test screenshot against a visual baseline.

    Each result records:
    - Which screenshot was compared to which baseline
    - The algorithm and threshold used
    - The similarity score achieved
    - Whether the comparison passed or failed
    - Any diff regions detected
    - Review status and decision (if reviewed)

    Failed comparisons can automatically create deficiencies, or be
    flagged for human review before determining if they're actual bugs.
    """

    __tablename__ = "visual_comparison_results"

    # Primary key
    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
        server_default=text("gen_random_uuid()"),
    )

    # Test run association
    test_run_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("software_test_runs.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Baseline association (nullable if no baseline exists)
    baseline_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("visual_baselines.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # Screenshot that was compared
    screenshot_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("test_screenshots.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Transition association (optional)
    transition_execution_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("transition_executions.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # State identification (denormalized for querying)
    state_name: Mapped[str] = mapped_column(
        String(500),
        nullable=False,
        index=True,
        comment="State name this comparison was for",
    )

    # Comparison details
    comparison_algorithm: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        comment="Algorithm used: ssim, pixel_diff, or perceptual_hash",
    )

    similarity_score: Mapped[float] = mapped_column(
        Float,
        nullable=False,
        comment="Similarity score from 0.0 to 1.0 (1.0 = identical)",
    )

    threshold_used: Mapped[float] = mapped_column(
        Float,
        nullable=False,
        comment="Threshold that was used for pass/fail determination",
    )

    status: Mapped[str] = mapped_column(
        Enum(VisualComparisonStatus),
        nullable=False,
        index=True,
        comment="Result status: passed, failed, pending_review, approved_as_new, no_baseline",
    )

    # Diff visualization
    diff_image_path: Mapped[str | None] = mapped_column(
        String(1000),
        nullable=True,
        comment="S3/MinIO path for diff visualization image",
    )

    diff_regions: Mapped[dict] = mapped_column(
        JSONB,
        nullable=False,
        default=list,
        comment="""List of diff regions detected:
        [{"x": int, "y": int, "width": int, "height": int, "change_percentage": float}]""",
    )

    # Execution metadata
    execution_time_ms: Mapped[int | None] = mapped_column(
        nullable=True,
        comment="Time taken to perform comparison in milliseconds",
    )

    # Review workflow
    reviewed_by_user_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    reviewed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        comment="When the comparison was reviewed",
    )

    review_decision: Mapped[str | None] = mapped_column(
        Enum(ReviewDecision),
        nullable=True,
        comment="Decision made during review: approved, rejected, new_baseline",
    )

    review_notes: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
        comment="Notes explaining the review decision",
    )

    # Auto-created deficiency (if comparison failed and created a deficiency)
    deficiency_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("test_deficiencies.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
        comment="Deficiency created from this failed comparison",
    )

    # Error tracking
    error_message: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
        comment="Error message if comparison failed to execute",
    )

    # Audit timestamps
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=datetime.utcnow,
    )

    # Relationships
    test_run = relationship(
        "SoftwareTestRun",
        back_populates="visual_comparison_results",
    )

    baseline = relationship(
        "VisualBaseline",
        back_populates="comparison_results",
    )

    screenshot = relationship(
        "TestScreenshot",
        back_populates="visual_comparisons",
    )

    transition_execution = relationship(
        "TransitionExecution",
        foreign_keys=[transition_execution_id],
    )

    reviewed_by = relationship(
        "User",
        foreign_keys=[reviewed_by_user_id],
    )

    deficiency = relationship(
        "TestDeficiency",
        foreign_keys=[deficiency_id],
    )

    def __repr__(self) -> str:
        return (
            f"<VisualComparisonResult(id={self.id}, state='{self.state_name}', "
            f"score={self.similarity_score:.3f}, status={self.status})>"
        )

    @property
    def passed(self) -> bool:
        """Whether this comparison passed."""
        return self.status == VisualComparisonStatus.PASSED

    @property
    def needs_review(self) -> bool:
        """Whether this comparison needs human review."""
        return self.status == VisualComparisonStatus.PENDING_REVIEW

    @property
    def diff_region_count(self) -> int:
        """Number of diff regions detected."""
        if isinstance(self.diff_regions, list):
            return len(self.diff_regions)
        return 0
