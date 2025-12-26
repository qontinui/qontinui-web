"""
Unified execution screenshot model for tracking screenshots captured during execution.

Replaces TestScreenshot + AutomationScreenshot models with a single unified model.
"""

from datetime import datetime
from enum import Enum as PyEnum
from uuid import UUID, uuid4

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, String, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class ExecutionScreenshotType(str, PyEnum):
    """Execution screenshot type enumeration."""

    BEFORE_ACTION = "before_action"
    AFTER_ACTION = "after_action"
    ON_ERROR = "on_error"
    ON_SUCCESS = "on_success"
    STATE_CAPTURE = "state_capture"
    DIFF_BASELINE = "diff_baseline"
    DIFF_COMPARISON = "diff_comparison"
    MANUAL = "manual"


class ExecutionScreenshot(Base):
    """
    Unified execution screenshot tracking screenshots captured during execution.

    Replaces TestScreenshot + AutomationScreenshot with a single unified model.
    """

    __tablename__ = "execution_screenshots"

    # Primary key
    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
        server_default=text("gen_random_uuid()"),
    )

    # Foreign keys
    run_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("execution_runs.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    action_execution_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("action_executions.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # Sequence and type
    sequence_number: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        comment="Order of screenshot within the run",
    )

    screenshot_type: Mapped[str] = mapped_column(
        Enum(
            ExecutionScreenshotType,
            name="execution_screenshot_type",
            create_type=False,
        ),
        nullable=False,
        index=True,
    )

    # Storage information
    storage_path: Mapped[str] = mapped_column(
        String(500),
        nullable=False,
        comment="Path in storage system (S3, MinIO, local)",
    )

    image_url: Mapped[str] = mapped_column(
        String(500),
        nullable=False,
        comment="Public URL to access the image",
    )

    thumbnail_url: Mapped[str | None] = mapped_column(
        String(500),
        nullable=True,
        comment="URL to thumbnail version",
    )

    # Image properties
    width: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
    )

    height: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
    )

    file_size_bytes: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
    )

    # State context
    state_name: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
        index=True,
        comment="State name when screenshot was taken",
    )

    # Perceptual hash for similarity comparison
    perceptual_hash: Mapped[str | None] = mapped_column(
        String(64),
        nullable=True,
        index=True,
        comment="Perceptual hash for image similarity comparison",
    )

    # Capture timestamp
    captured_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
    )

    # Additional metadata
    extra_metadata: Mapped[dict] = mapped_column(
        "metadata",  # DB column name stays 'metadata' for compatibility
        JSONB,
        nullable=False,
        default=dict,
        server_default=text("'{}'::jsonb"),
        comment="Additional screenshot metadata: annotations, regions, etc.",
    )

    # Audit timestamp
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=datetime.utcnow,
        server_default=text("now()"),
    )

    # Relationships
    run = relationship("ExecutionRun", back_populates="screenshots")

    action = relationship(
        "ActionExecution",
        back_populates="screenshot",
        foreign_keys=[action_execution_id],
    )

    def __repr__(self) -> str:
        return f"<ExecutionScreenshot(id={self.id}, type='{self.screenshot_type}', state='{self.state_name}')>"
