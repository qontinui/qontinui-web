"""VideoCaptureSession model for video recording."""

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.db.base import Base

if TYPE_CHECKING:
    from .action_frame import ActionFrame
    from .frame_index import FrameIndex
    from .input_event import InputEvent


class VideoCaptureSession(Base):
    """
    Video capture session metadata.

    Represents a single video recording session that captures:
    - Screen video
    - Input events (mouse, keyboard)
    - Automation results (linked via snapshot_run)

    The video file is stored externally (local filesystem or S3),
    with only the reference stored in the database.

    NOTE: This is different from CaptureSession which is for workflow learning
    from screenshots. This model is for continuous video recording.
    """

    __tablename__ = "video_capture_sessions"

    # Primary key
    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)

    # Unique session identifier (UUID)
    session_id: Mapped[str] = mapped_column(
        String(36), unique=True, nullable=False, index=True
    )

    # Timestamps
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=func.now(), index=True
    )
    ended_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    duration_ms: Mapped[int | None] = mapped_column(
        BigInteger, nullable=True
    )  # Total duration in milliseconds

    # Video metadata
    video_width: Mapped[int] = mapped_column(Integer, nullable=False)
    video_height: Mapped[int] = mapped_column(Integer, nullable=False)
    video_fps: Mapped[float] = mapped_column(Float, nullable=False, default=30.0)
    video_codec: Mapped[str] = mapped_column(String(50), nullable=False, default="h264")
    video_format: Mapped[str] = mapped_column(String(10), nullable=False, default="mp4")
    total_frames: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Storage information
    storage_backend: Mapped[str] = mapped_column(
        String(20), nullable=False, default="local"
    )  # 'local' or 's3'
    video_path: Mapped[str] = mapped_column(
        Text, nullable=False
    )  # Local path or S3 key
    video_size_bytes: Mapped[int | None] = mapped_column(BigInteger, nullable=True)

    # Optional compressed/streaming version
    compressed_video_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    compressed_video_size_bytes: Mapped[int | None] = mapped_column(
        BigInteger, nullable=True
    )

    # Monitor/display info
    monitor_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    monitor_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    monitor_scale_factor: Mapped[float | None] = mapped_column(
        Float, nullable=True, default=1.0
    )

    # Association with snapshot run (automation results)
    snapshot_run_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("snapshot_runs.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # Association with workflow (references workflow_id in project JSON, not a FK)
    workflow_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)

    # Association with project
    project_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # User who created the session
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("runner.users.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Session status
    is_complete: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_processed: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False
    )  # Frame index built

    # Additional metadata
    metadata_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    tags: Mapped[list[str] | None] = mapped_column(ARRAY(Text), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Audit timestamps
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=func.now(), onupdate=func.now()
    )

    # Relationships
    input_events: Mapped[list["InputEvent"]] = relationship(
        "InputEvent",
        back_populates="video_capture_session",
        cascade="all, delete-orphan",
        lazy="dynamic",  # For efficient querying of large event sets
    )
    frame_index: Mapped[list["FrameIndex"]] = relationship(
        "FrameIndex",
        back_populates="video_capture_session",
        cascade="all, delete-orphan",
        lazy="dynamic",
    )
    action_frames: Mapped[list["ActionFrame"]] = relationship(
        "ActionFrame",
        back_populates="video_capture_session",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        Index("idx_video_capture_sessions_started_at", "started_at"),
        Index("idx_video_capture_sessions_workflow_id", "workflow_id"),
        Index("idx_video_capture_sessions_project_id", "project_id"),
        Index("idx_video_capture_sessions_snapshot_run_id", "snapshot_run_id"),
    )

    def __repr__(self) -> str:
        return f"<VideoCaptureSession(id={self.id}, session_id='{self.session_id}')>"
