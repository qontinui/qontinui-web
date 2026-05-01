"""HistoricalResult model for video capture."""

import uuid
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.db.base import Base


class HistoricalResult(Base):
    """
    Queryable historical results for automation execution data.

    Stores image recognition and action results from both:
    1. Snapshot runs (offline capture/recording)
    2. Live test runs (real-time execution via runner)

    Used by multiple features:
    - Integration testing: Search by patterns/states across executions
    - Workflow visualization: Playback execution recordings
    - Mock mode: Random selection for testing without real execution
    - Unit testing: Pattern-specific result retrieval

    Key features:
    - Indexed by pattern, state, action type, and test run for fast lookups
    - Links to video capture session for frame retrieval
    - Stores match coordinates (x, y, width, height) for visualization
    - Supports deterministic playback via sequence_number ordering
    """

    __tablename__ = "historical_results"

    # Primary key
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True)

    # Source references - can come from snapshot runs OR live test runs
    snapshot_run_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("project.snapshot_runs.id", ondelete="CASCADE"),
        nullable=True,  # Made nullable to support live test runs
        index=True,
    )
    snapshot_action_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("project.snapshot_actions.id", ondelete="CASCADE"),
        nullable=True,  # Made nullable to support live test runs
        index=True,
    )
    video_capture_session_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("project.video_capture_sessions.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # Link to live test run (for integration testing / workflow visualization)
    test_run_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("project.software_test_runs.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )

    # Sequence within a run (for deterministic playback ordering)
    sequence_number: Mapped[int | None] = mapped_column(
        Integer,
        nullable=True,
        comment="Order of recognition within the test run",
    )

    # Denormalized query fields (for efficient selection)
    pattern_id: Mapped[str | None] = mapped_column(
        String(255), nullable=True, index=True
    )
    pattern_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    action_type: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    active_states: Mapped[list[str] | None] = mapped_column(
        ARRAY(String), nullable=True
    )

    # Result data
    success: Mapped[bool] = mapped_column(Boolean, nullable=False, index=True)
    match_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    best_match_score: Mapped[float | None] = mapped_column(Numeric(5, 4), nullable=True)
    duration_ms: Mapped[float | None] = mapped_column(Numeric(10, 3), nullable=True)

    # Match location (for FIND actions)
    match_x: Mapped[int | None] = mapped_column(Integer, nullable=True)
    match_y: Mapped[int | None] = mapped_column(Integer, nullable=True)
    match_width: Mapped[int | None] = mapped_column(Integer, nullable=True)
    match_height: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Video frame info (for frame retrieval)
    frame_timestamp_ms: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    frame_number: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Full result data for mock responses
    result_data_json: Mapped[dict] = mapped_column(JSONB, nullable=False)

    # Workflow/project context (workflow_id references workflow in project JSON, not a FK)
    workflow_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    project_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("project.projects.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # Timestamps
    recorded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=func.now()
    )

    __table_args__ = (
        Index("idx_historical_pattern_states", "pattern_id", "active_states"),
        Index("idx_historical_action_type_success", "action_type", "success"),
        Index("idx_historical_workflow_pattern", "workflow_id", "pattern_id"),
        Index("idx_historical_project_pattern", "project_id", "pattern_id"),
        Index(
            "idx_historical_selection",
            "pattern_id",
            "action_type",
            "success",
            "recorded_at",
        ),
        Index("idx_historical_test_run_seq", "test_run_id", "sequence_number"),
        Index("idx_historical_test_run_pattern", "test_run_id", "pattern_id"),
        {"schema": "project"},
    )

    def __repr__(self) -> str:
        return f"<HistoricalResult(id={self.id}, pattern={self.pattern_id}, type={self.action_type})>"
