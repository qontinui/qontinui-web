"""
Snapshot and Screenshot Database Models

Models for storing snapshot runs and associated screenshots for integration testing.

This module consolidates all snapshot models:
- SnapshotRun: High-level snapshot run metadata
- Screenshot: Individual screenshots from snapshot runs
- Pattern: Visual patterns detected in screenshots
- SnapshotAction: Individual actions from action logs
- SnapshotPattern: Pattern statistics and metadata
- SnapshotMatch: Individual match records for patterns
"""

from datetime import UTC, datetime
from typing import TYPE_CHECKING
from uuid import UUID as PyUUID

from app.db.base import Base
from sqlalchemy import (
    ARRAY,
    JSON,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

if TYPE_CHECKING:
    from app.models.project import Project


class SnapshotRun(Base):
    """
    A snapshot run represents a collection of screenshots and patterns
    captured during a test execution or manual snapshot session.
    """

    __tablename__ = "snapshot_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    run_id: Mapped[str] = mapped_column(
        String(255), unique=True, index=True, nullable=False
    )
    run_name: Mapped[str] = mapped_column(String(255), nullable=False)

    # Optional project association
    project_id: Mapped[PyUUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )

    # Workflow association (workflow_id references processes/workflows)
    workflow_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)

    # Metadata
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
        nullable=False,
    )

    # JSON fields for flexible storage
    states: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    run_metadata: Mapped[dict] = mapped_column(
        "metadata", JSON, default=dict, nullable=False
    )
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
        lazy="selectin",
    )
    patterns: Mapped[list["Pattern"]] = relationship(
        "Pattern",
        back_populates="snapshot_run",
        cascade="all, delete-orphan",
        lazy="selectin",
    )
    # Additional relationships for detailed action tracking
    actions: Mapped[list["SnapshotAction"]] = relationship(
        "SnapshotAction",
        back_populates="snapshot_run",
        cascade="all, delete-orphan",
    )
    snapshot_patterns: Mapped[list["SnapshotPattern"]] = relationship(
        "SnapshotPattern",
        back_populates="snapshot_run",
        cascade="all, delete-orphan",
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
        ForeignKey("snapshot_runs.id", ondelete="CASCADE"), nullable=False, index=True
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
    screenshot_metadata: Mapped[dict] = mapped_column(
        "metadata", JSON, default=dict, nullable=False
    )

    # Relationships
    snapshot_run: Mapped["SnapshotRun"] = relationship(
        "SnapshotRun", back_populates="screenshots"
    )

    def __repr__(self) -> str:
        return (
            f"<Screenshot(path='{self.screenshot_path}', states={self.active_states})>"
        )


class Pattern(Base):
    """
    A visual pattern detected in a screenshot.
    """

    __tablename__ = "patterns"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)

    # Foreign key to snapshot run
    snapshot_run_id: Mapped[int] = mapped_column(
        ForeignKey("snapshot_runs.id", ondelete="CASCADE"), nullable=False, index=True
    )

    # Pattern identification
    pattern_id: Mapped[str] = mapped_column(
        String(255), unique=True, index=True, nullable=False
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    type: Mapped[str] = mapped_column(String(50), nullable=False, index=True)

    # Screenshot reference
    screenshot_path: Mapped[str] = mapped_column(String(500), nullable=False)

    # Region data (x, y, width, height)
    region: Mapped[dict] = mapped_column(JSON, nullable=False)

    # States where this pattern is active
    active_states: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)

    # Confidence score
    confidence: Mapped[float] = mapped_column(Float, nullable=False)

    # Optional metadata (using mapped name to avoid SQLAlchemy reserved word)
    pattern_metadata: Mapped[dict] = mapped_column(
        "metadata", JSON, default=dict, nullable=False
    )

    # Relationships
    snapshot_run: Mapped["SnapshotRun"] = relationship(
        "SnapshotRun", back_populates="patterns"
    )

    def __repr__(self) -> str:
        return f"<Pattern(name='{self.name}', type='{self.type}', confidence={self.confidence})>"


# Additional models for detailed action tracking and pattern matching


class SnapshotAction(Base):
    """
    Snapshot action records table.

    Stores individual actions from the action log with detailed execution data.
    This is more detailed than Screenshot and tracks action-level execution.
    """

    __tablename__ = "snapshot_actions"

    # Primary key
    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)

    # Foreign key
    snapshot_run_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("snapshot_runs.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Action identifiers
    sequence_number: Mapped[int] = mapped_column(Integer, nullable=False)
    timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, index=True
    )
    action_type: Mapped[str] = mapped_column(String(50), nullable=False, index=True)

    # Pattern info
    pattern_id: Mapped[str | None] = mapped_column(
        String(255), nullable=True, index=True
    )
    pattern_name: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Result info
    success: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, index=True
    )
    match_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    duration_ms: Mapped[float | None] = mapped_column(Numeric(10, 3), nullable=True)

    # State and context
    active_states: Mapped[list[str] | None] = mapped_column(ARRAY(Text), nullable=True)
    screenshot_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_start_screenshot: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, index=True
    )

    # Full action data from action_log.json
    action_data_json: Mapped[dict] = mapped_column(JSON, nullable=False)

    # Relationship
    snapshot_run: Mapped["SnapshotRun"] = relationship(
        "SnapshotRun", back_populates="actions"
    )

    # Indexes
    __table_args__ = (
        Index(
            "idx_snapshot_actions_run_sequence", "snapshot_run_id", "sequence_number"
        ),
        Index("idx_snapshot_actions_timestamp", "timestamp"),
        Index("idx_snapshot_actions_pattern_id", "pattern_id"),
        Index("idx_snapshot_actions_action_type", "action_type"),
        Index("idx_snapshot_actions_success", "success"),
    )

    def __repr__(self) -> str:
        return (
            f"<SnapshotAction(run_id={self.snapshot_run_id}, "
            f"seq={self.sequence_number}, type='{self.action_type}')>"
        )


class SnapshotPattern(Base):
    """
    Pattern statistics table.

    Aggregates pattern usage across a snapshot run.
    This is more detailed than the Pattern model and includes usage statistics.
    """

    __tablename__ = "snapshot_patterns"

    # Primary key
    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)

    # Foreign key
    snapshot_run_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("snapshot_runs.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Pattern identifiers
    pattern_id: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    pattern_name: Mapped[str] = mapped_column(String(255), nullable=False)

    # Statistics
    total_finds: Mapped[int] = mapped_column(Integer, default=0)
    successful_finds: Mapped[int] = mapped_column(Integer, default=0)
    failed_finds: Mapped[int] = mapped_column(Integer, default=0)
    total_matches: Mapped[int] = mapped_column(Integer, default=0)
    avg_duration_ms: Mapped[float | None] = mapped_column(Numeric(10, 3), nullable=True)

    # Full pattern data from patterns/{pattern-id}/metadata.json
    pattern_data_json: Mapped[dict] = mapped_column(JSON, nullable=False)

    # Relationships
    snapshot_run: Mapped["SnapshotRun"] = relationship(
        "SnapshotRun", back_populates="snapshot_patterns"
    )
    matches: Mapped[list["SnapshotMatch"]] = relationship(
        "SnapshotMatch",
        back_populates="pattern",
        cascade="all, delete-orphan",
    )

    # Indexes
    __table_args__ = (
        Index("idx_snapshot_patterns_run_pattern", "snapshot_run_id", "pattern_id"),
        Index("idx_snapshot_patterns_pattern_id", "pattern_id"),
    )

    def __repr__(self) -> str:
        return (
            f"<SnapshotPattern(run_id={self.snapshot_run_id}, "
            f"pattern_id='{self.pattern_id}')>"
        )


class SnapshotMatch(Base):
    """
    Individual match records table.

    Stores detailed match information for pattern finds.
    """

    __tablename__ = "snapshot_matches"

    # Primary key
    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)

    # Foreign keys
    pattern_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("snapshot_patterns.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    action_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("snapshot_actions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Match info
    match_index: Mapped[int] = mapped_column(Integer, nullable=False)
    x: Mapped[int] = mapped_column(Integer, nullable=False)
    y: Mapped[int] = mapped_column(Integer, nullable=False)
    width: Mapped[int] = mapped_column(Integer, nullable=False)
    height: Mapped[int] = mapped_column(Integer, nullable=False)
    score: Mapped[float | None] = mapped_column(Numeric(5, 4), nullable=True)

    # Full match data from patterns/{pattern-id}/history.json
    match_data_json: Mapped[dict] = mapped_column(JSON, nullable=False)

    # Relationships
    pattern: Mapped["SnapshotPattern"] = relationship(
        "SnapshotPattern", back_populates="matches"
    )

    # Indexes
    __table_args__ = (
        Index("idx_snapshot_matches_pattern", "pattern_id"),
        Index("idx_snapshot_matches_action", "action_id"),
    )

    def __repr__(self) -> str:
        return f"<SnapshotMatch(pattern_id={self.pattern_id}, x={self.x}, y={self.y})>"
