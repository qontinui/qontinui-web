"""
Snapshot and Screenshot Database Models

Models for storing snapshot runs and associated screenshots for integration testing.
"""

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base_class import Base

if TYPE_CHECKING:
    from app.models.project import Project


class SnapshotRun(Base):
    """
    A snapshot run represents a collection of screenshots and patterns
    captured during a test execution or manual snapshot session.
    """

    __tablename__ = "snapshot_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    run_id: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    run_name: Mapped[str] = mapped_column(String(255), nullable=False)

    # Optional project association
    project_id: Mapped[int | None] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=True, index=True
    )

    # Workflow association (workflow_id references processes/workflows)
    workflow_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)

    # Metadata
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False
    )

    # JSON fields for flexible storage
    states: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    run_metadata: Mapped[dict] = mapped_column("metadata", JSON, default=dict, nullable=False)
    tags: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)

    # Summary statistics (denormalized for performance)
    num_screenshots: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    num_patterns: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # Description
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Relationships
    project: Mapped["Project"] = relationship("Project", back_populates="snapshot_runs")
    screenshots: Mapped[list["Screenshot"]] = relationship(
        "Screenshot",
        back_populates="snapshot_run",
        cascade="all, delete-orphan",
        lazy="selectin"
    )
    patterns: Mapped[list["Pattern"]] = relationship(
        "Pattern",
        back_populates="snapshot_run",
        cascade="all, delete-orphan",
        lazy="selectin"
    )

    def __repr__(self) -> str:
        return f"<SnapshotRun(run_id='{self.run_id}', run_name='{self.run_name}')>"


class Screenshot(Base):
    """
    A screenshot captured during a snapshot run.
    """

    __tablename__ = "screenshots"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)

    # Foreign key to snapshot run
    snapshot_run_id: Mapped[int] = mapped_column(
        ForeignKey("snapshot_runs.id", ondelete="CASCADE"),
        nullable=False,
        index=True
    )

    # Screenshot data
    screenshot_path: Mapped[str] = mapped_column(String(500), nullable=False)
    active_states: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    # Image dimensions
    width: Mapped[int] = mapped_column(Integer, nullable=False)
    height: Mapped[int] = mapped_column(Integer, nullable=False)

    # Hash for duplicate detection
    state_hash: Mapped[str] = mapped_column(String(64), nullable=False, index=True)

    # Optional metadata (using mapped name to avoid SQLAlchemy reserved word)
    screenshot_metadata: Mapped[dict] = mapped_column("metadata", JSON, default=dict, nullable=False)

    # Relationships
    snapshot_run: Mapped["SnapshotRun"] = relationship("SnapshotRun", back_populates="screenshots")

    def __repr__(self) -> str:
        return f"<Screenshot(path='{self.screenshot_path}', states={self.active_states})>"


class Pattern(Base):
    """
    A visual pattern detected in a screenshot.
    """

    __tablename__ = "patterns"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)

    # Foreign key to snapshot run
    snapshot_run_id: Mapped[int] = mapped_column(
        ForeignKey("snapshot_runs.id", ondelete="CASCADE"),
        nullable=False,
        index=True
    )

    # Pattern identification
    pattern_id: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    type: Mapped[str] = mapped_column(String(50), nullable=False, index=True)

    # Screenshot reference
    screenshot_path: Mapped[str] = mapped_column(String(500), nullable=False)

    # Region data (x, y, width, height)
    region: Mapped[dict] = mapped_column(JSON, nullable=False)

    # States where this pattern is active
    active_states: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)

    # Confidence score
    confidence: Mapped[float] = mapped_column(Integer, nullable=False)

    # Optional metadata (using mapped name to avoid SQLAlchemy reserved word)
    pattern_metadata: Mapped[dict] = mapped_column("metadata", JSON, default=dict, nullable=False)

    # Relationships
    snapshot_run: Mapped["SnapshotRun"] = relationship("SnapshotRun", back_populates="patterns")

    def __repr__(self) -> str:
        return f"<Pattern(name='{self.name}', type='{self.type}', confidence={self.confidence})>"
