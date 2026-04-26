"""Template Candidate model for click-to-template system."""

import uuid
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy import JSON, DateTime, Float, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.project import Project
    from app.models.user import User


class TemplateCandidate(Base):
    """
    A template candidate extracted from a click event during capture.

    Stores detected element boundaries and pixel data from click capture
    sessions. Candidates can be reviewed, adjusted, and approved for
    import into state machines.
    """

    __tablename__ = "template_candidates"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    session_id: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    project_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )

    # Click context
    click_x: Mapped[int] = mapped_column(Integer, nullable=False)
    click_y: Mapped[int] = mapped_column(Integer, nullable=False)
    click_button: Mapped[str] = mapped_column(
        String(20), nullable=False, default="left"
    )
    timestamp: Mapped[float] = mapped_column(Float, nullable=False)
    frame_number: Mapped[int] = mapped_column(Integer, nullable=False)

    # Detection results (stored as JSONB)
    primary_boundary: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    alternative_boundaries: Mapped[list[dict[str, Any]] | None] = mapped_column(
        JSON, nullable=True
    )
    detection_strategies: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)

    # Template data (stored in MinIO/S3)
    pixel_data_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    pixel_data_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    thumbnail_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    mask_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    mask_url: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # Review status: pending, approved, rejected, modified
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    adjusted_boundary: Mapped[dict[str, Any] | None] = mapped_column(
        JSON, nullable=True
    )
    reviewed_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("runner.users.id", ondelete="SET NULL"),
        nullable=True,
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # Detection metadata
    confidence_score: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    element_type: Mapped[str] = mapped_column(
        String(50), nullable=False, default="unknown"
    )
    application_name: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # User-defined metadata (state_hint, name, etc.)
    user_metadata: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(UTC),
    )

    # Relationships
    project: Mapped["Project | None"] = relationship(
        "Project", back_populates="template_candidates"
    )
    reviewed_by: Mapped["User | None"] = relationship("User")
