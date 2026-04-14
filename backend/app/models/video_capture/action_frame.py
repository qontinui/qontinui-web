"""ActionFrame model for video capture."""

from typing import TYPE_CHECKING

from app.db.base import Base
from sqlalchemy import (BigInteger, ForeignKey, Index, Integer, String, Text,
                        UniqueConstraint)
from sqlalchemy.orm import Mapped, mapped_column, relationship

if TYPE_CHECKING:
    from .session import VideoCaptureSession


class ActionFrame(Base):
    """
    Links automation actions to specific video frames.

    This table enables:
    - Retrieving the exact frame when an action occurred
    - Showing visual context for automation results
    - Integration test playback with screenshots

    Each automation action (from SnapshotAction) can have multiple
    associated frames (before, during, after the action).
    """

    __tablename__ = "action_frames"

    # Primary key
    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)

    # Foreign keys
    video_capture_session_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("video_capture_sessions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    snapshot_action_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("snapshot_actions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Frame timing
    frame_number: Mapped[int] = mapped_column(Integer, nullable=False)
    timestamp_ms: Mapped[int] = mapped_column(BigInteger, nullable=False)

    # Frame type relative to action
    frame_type: Mapped[str] = mapped_column(
        String(20), nullable=False, default="action"
    )  # 'before', 'action', 'after', 'result'

    # Cached frame path (if extracted and cached)
    cached_frame_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    cache_storage_backend: Mapped[str | None] = mapped_column(
        String(20), nullable=True
    )  # 'local' or 's3'

    # Relationship
    video_capture_session: Mapped["VideoCaptureSession"] = relationship(
        "VideoCaptureSession", back_populates="action_frames"
    )

    __table_args__ = (
        Index("idx_action_frames_session", "video_capture_session_id"),
        Index("idx_action_frames_action", "snapshot_action_id"),
        Index("idx_action_frames_type", "frame_type"),
        UniqueConstraint(
            "video_capture_session_id",
            "snapshot_action_id",
            "frame_type",
            name="uq_action_frames_session_action_type",
        ),
    )

    def __repr__(self) -> str:
        return (
            f"<ActionFrame(action={self.snapshot_action_id}, type={self.frame_type})>"
        )
