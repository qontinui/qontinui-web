"""
Visual baseline model for storing approved baseline screenshots for visual regression testing.

Baselines serve as the "golden" reference screenshots that new test screenshots
are compared against to detect visual regressions.
"""

from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class VisualBaseline(Base):
    """
    Visual baseline for regression testing.

    Stores the approved baseline screenshot for a specific state in a project.
    Each state can have one active baseline at a time, with version history
    maintained through the version field and is_active flag.

    Baselines can be created:
    - Manually by uploading an image
    - Automatically from a test screenshot that passes approval

    Comparison settings define how screenshots are compared against this baseline,
    including algorithm choice, threshold, and ignore regions for dynamic content.
    """

    __tablename__ = "visual_baselines"

    # Primary key
    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
        server_default=text("gen_random_uuid()"),
    )

    # Project association
    project_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # State identification - the key for matching screenshots to baselines
    state_name: Mapped[str] = mapped_column(
        String(500),
        nullable=False,
        index=True,
        comment="State name used to match screenshots to this baseline",
    )

    # Optional workflow scoping
    workflow_id: Mapped[str | None] = mapped_column(
        String(500),
        nullable=True,
        index=True,
        comment="Optional workflow ID to scope baseline to specific workflow",
    )

    # Storage information
    storage_path: Mapped[str] = mapped_column(
        String(1000),
        nullable=False,
        comment="S3/MinIO storage path for baseline image",
    )

    thumbnail_path: Mapped[str | None] = mapped_column(
        String(1000),
        nullable=True,
        comment="S3/MinIO storage path for thumbnail preview",
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

    file_size_bytes: Mapped[int | None] = mapped_column(
        Integer,
        nullable=True,
        comment="File size in bytes",
    )

    # Perceptual hash for quick pre-comparison filtering
    perceptual_hash: Mapped[str | None] = mapped_column(
        String(256),
        nullable=True,
        index=True,
        comment="Perceptual hash for quick comparison filtering",
    )

    # Version management
    version: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=1,
        comment="Version number of this baseline (incremented on updates)",
    )

    is_active: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
        index=True,
        comment="Whether this is the active baseline for this state",
    )

    # Approval information
    approved_by_user_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("runner.users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    approved_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        comment="When the baseline was approved",
    )

    approval_notes: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
        comment="Optional notes explaining the approval",
    )

    # Comparison settings
    comparison_settings: Mapped[dict] = mapped_column(
        JSONB,
        nullable=False,
        default=dict,
        comment="""Comparison configuration:
        {
            "algorithm": "ssim" | "pixel_diff" | "perceptual_hash",
            "threshold": float (0.0-1.0),
            "ignore_regions": [{"x": int, "y": int, "width": int, "height": int, "name": str}]
        }""",
    )

    # Source tracking (where this baseline came from)
    source_test_run_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("software_test_runs.id", ondelete="SET NULL"),
        nullable=True,
        comment="Test run this baseline was created from (if auto-created)",
    )

    source_screenshot_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("test_screenshots.id", ondelete="SET NULL"),
        nullable=True,
        comment="Screenshot this baseline was created from",
    )

    # Audit timestamps
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(UTC),
    )

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
    )

    # Relationships
    project = relationship(
        "Project",
        back_populates="visual_baselines",
    )

    approved_by = relationship(
        "User",
        foreign_keys=[approved_by_user_id],
    )

    source_test_run = relationship(
        "SoftwareTestRun",
        foreign_keys=[source_test_run_id],
    )

    source_screenshot = relationship(
        "TestScreenshot",
        foreign_keys=[source_screenshot_id],
    )

    comparison_results = relationship(
        "VisualComparisonResult",
        back_populates="baseline",
        cascade="all, delete-orphan",
    )

    def __repr__(self) -> str:
        return (
            f"<VisualBaseline(id={self.id}, state_name='{self.state_name}', "
            f"version={self.version}, is_active={self.is_active})>"
        )

    @property
    def algorithm(self) -> str:
        """Get the comparison algorithm from settings."""
        result = self.comparison_settings.get("algorithm", "ssim")
        return str(result)

    @property
    def threshold(self) -> float:
        """Get the comparison threshold from settings."""
        result = self.comparison_settings.get("threshold", 0.95)
        return float(result)

    @property
    def ignore_regions(self) -> list[dict]:
        """Get the ignore regions from settings."""
        result = self.comparison_settings.get("ignore_regions", [])
        return list(result) if result else []
