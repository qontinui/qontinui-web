"""LearnedWorkflow model for workflow learning capture."""

import uuid
from datetime import UTC, datetime
from typing import TYPE_CHECKING

from sqlalchemy import JSON, DateTime, Float, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.project import Project
    from app.models.user import User

    from .session import CaptureSession


class LearnedWorkflow(Base):
    """
    A workflow generated from a capture session.

    This is a draft workflow awaiting user review. Once approved,
    it can be converted to a real Workflow in the workflows table.
    """

    __tablename__ = "learned_workflows"
    __table_args__ = {'schema': "project"}

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    session_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("project.capture_sessions.id", ondelete="CASCADE")
    )
    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("project.projects.id", ondelete="CASCADE")
    )

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Generated workflow structure (JSON)
    workflow_json: Mapped[dict] = mapped_column(JSON, nullable=False)
    # Example structure:
    # {
    #   "states": [...],
    #   "transitions": [...],
    #   "start_state_id": "...",
    #   "metadata": {
    #     "confidence": 0.87,
    #     "warnings": ["Transition 2->3 has low confidence"],
    #     "generation_method": "sequential_analysis",
    #     "screenshot_count": 15
    #   }
    # }

    # Overall confidence score
    confidence: Mapped[float] = mapped_column(Float, nullable=False)

    # Status: 'draft', 'reviewing', 'approved', 'rejected', 'published'
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="draft")

    # Warnings/issues found during generation
    warnings: Mapped[list | None] = mapped_column(JSON, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(UTC),
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    reviewer_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("auth.users.id", ondelete="SET NULL"), nullable=True
    )

    # If published, metadata about the workflow integration
    # Since workflows are stored in project configuration JSON, not a separate table,
    # we store metadata about where this workflow was published
    published_info: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    # Example:
    # {
    #   "workflow_name": "Login Flow",
    #   "published_to_project_version": 15,
    #   "workflow_id_in_config": "workflow-uuid-123"
    # }

    # Relationships
    session: Mapped["CaptureSession"] = relationship(
        "CaptureSession", back_populates="learned_workflows"
    )
    project: Mapped["Project"] = relationship("Project")
    reviewer: Mapped["User | None"] = relationship("User", foreign_keys=[reviewer_id])
