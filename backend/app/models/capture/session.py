"""CaptureSession model for workflow learning capture."""

import uuid
from datetime import UTC, datetime
from typing import TYPE_CHECKING

from sqlalchemy import JSON, DateTime, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.project import Project
    from app.models.project_assets import ProjectScreenshot
    from app.models.user import User

    from .learned_workflow import LearnedWorkflow
    from .screenshot import CaptureScreenshot


class CaptureSession(Base):
    """
    A capture session represents a recording of user interactions.

    Contains multiple screenshots taken in sequence, along with the actions
    performed between them. Used for learning workflows from demonstrations.
    """

    __tablename__ = "capture_sessions"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE")
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE")
    )

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Status: 'capturing', 'uploading', 'analyzing', 'completed', 'failed', 'archived'
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="capturing")

    # Metadata about the capture (using extra_metadata to avoid SQLAlchemy reserved name)
    extra_metadata: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    # Example extra_metadata:
    # {
    #   "runner_version": "1.0.0",
    #   "os": "Windows 11",
    #   "screen_resolution": "1920x1080",
    #   "total_duration_ms": 45000
    # }

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(UTC),
    )
    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # Relationships
    project: Mapped["Project"] = relationship(
        "Project", back_populates="capture_sessions"
    )
    user: Mapped["User"] = relationship("User", back_populates="capture_sessions")
    screenshots: Mapped[list["CaptureScreenshot"]] = relationship(
        "CaptureScreenshot", back_populates="session", cascade="all, delete-orphan"
    )
    learned_workflows: Mapped[list["LearnedWorkflow"]] = relationship(
        "LearnedWorkflow", back_populates="session", cascade="all, delete-orphan"
    )
    project_screenshots: Mapped[list["ProjectScreenshot"]] = relationship(
        "ProjectScreenshot", back_populates="capture_session"
    )
