"""
Embedding Generation Job Model

Tracks background jobs for generating vector embeddings from pattern images.
Allows monitoring of progress, failures, and retries.
"""

from datetime import UTC, datetime
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.project import Project
    from app.models.user import User


class EmbeddingGenerationJob(Base):
    """
    Background job for generating embeddings from project patterns.

    Tracks progress of embedding generation and provides status updates
    for long-running operations. Supports retry on failure.
    """

    __tablename__ = "embedding_generation_jobs"
    __table_args__ = {'schema': "project"}

    id: Mapped[UUID] = mapped_column(
        primary_key=True, server_default=text("gen_random_uuid()")
    )

    # Project association
    project_id: Mapped[UUID] = mapped_column(
        ForeignKey("project.projects.id", ondelete="CASCADE"), nullable=False, index=True
    )

    # User who triggered the job
    user_id: Mapped[UUID] = mapped_column(
        ForeignKey("auth.users.id", ondelete="CASCADE"), nullable=False, index=True
    )

    # Job status
    status: Mapped[str] = mapped_column(
        String(50), nullable=False, default="pending", index=True
    )
    # Values: pending, in_progress, completed, failed, cancelled

    # Progress tracking
    total_patterns: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    processed_patterns: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Error tracking
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Retry tracking
    retry_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    max_retries: Mapped[int] = mapped_column(Integer, nullable=False, default=3)

    # Job metadata (JSONB)
    job_metadata: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    # Stores: embedding_model, embedding_version, parameters, etc.

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False
    )
    started_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # Relationships
    project: Mapped["Project"] = relationship(
        "Project", back_populates="embedding_jobs"
    )
    user: Mapped["User"] = relationship("User", back_populates="embedding_jobs")

    def calculate_progress_percent(self) -> float:
        """
        Calculate progress percentage.

        Returns:
            Progress as a percentage (0.0 to 100.0)
        """
        if self.total_patterns == 0:
            return 0.0
        return (self.processed_patterns / self.total_patterns) * 100.0

    def is_complete(self) -> bool:
        """
        Check if job is in a terminal state.

        Returns:
            True if job is completed, failed, or cancelled
        """
        return self.status in ("completed", "failed", "cancelled")

    def can_retry(self) -> bool:
        """
        Check if job can be retried.

        Returns:
            True if job failed and hasn't exceeded max retries
        """
        return self.status == "failed" and self.retry_count < self.max_retries

    def __repr__(self) -> str:
        return f"<EmbeddingGenerationJob(id={self.id}, status='{self.status}', progress={self.processed_patterns}/{self.total_patterns})>"
