"""
Detected Issue Model

Stores issues detected during AI-assisted automation sessions.
Issues are detected via structured markers in AI output and synced from the runner.
"""

from datetime import UTC, datetime
from typing import TYPE_CHECKING, Optional
from uuid import UUID

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, Text, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.project import Project
    from app.models.user import User


class DetectedIssue(Base):
    """
    Issues detected during AI-assisted automation sessions.

    Tracks errors and issues found by AI analysis, including:
    - Where the error occurs in code (file, line)
    - Where the AI found the error (log file, screenshot, etc.)
    - Resolution status and description
    """

    __tablename__ = "detected_issues"

    id: Mapped[UUID] = mapped_column(
        primary_key=True, server_default=text("gen_random_uuid()")
    )

    # Session and project linkage
    session_id: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    project_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("project.projects.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    user_id: Mapped[UUID] = mapped_column(
        ForeignKey("auth.users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Issue details
    type: Mapped[str] = mapped_column(
        String(50), nullable=False
    )  # error, warning, exception, type_error, runtime_error
    severity: Mapped[str] = mapped_column(
        String(20), nullable=False, index=True
    )  # critical, high, medium, low
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Location (where the error occurs in code)
    file: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    line: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Source (where the AI found/detected the error)
    # JSONB: {type, path?, line_range?, description?}
    source: Mapped[dict] = mapped_column(JSONB, nullable=False)

    # Status tracking
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="detected", index=True
    )  # detected, in_progress, resolved, skipped
    resolution: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Timestamps
    detected_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    resolved_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()"), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=text("now()"),
        onupdate=lambda: datetime.now(UTC),
        nullable=False,
    )

    # Relationships
    project: Mapped[Optional["Project"]] = relationship(
        "Project", back_populates="detected_issues"
    )
    user: Mapped["User"] = relationship("User", back_populates="detected_issues")

    # Composite indexes for common queries
    __table_args__ = (
        Index("ix_detected_issues_project_status", "project_id", "status"),
        Index("ix_detected_issues_session", "session_id"),
        Index("ix_detected_issues_user_severity", "user_id", "severity"),
        Index(
        "ix_detected_issues_source",
        "source",
        postgresql_using="gin",
        postgresql_ops={"source": "jsonb_path_ops"},
        ),
        {"schema": "project"},
    )

    def __repr__(self) -> str:
        return f"<DetectedIssue(id={self.id}, title='{self.title[:50]}...', severity='{self.severity}', status='{self.status}')>"
