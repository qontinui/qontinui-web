"""FrameIndex model for video capture."""

from typing import TYPE_CHECKING

from app.db.base import Base
from sqlalchemy import (BigInteger, Boolean, ForeignKey, Index, Integer,
                        String, UniqueConstraint)
from sqlalchemy.orm import Mapped, mapped_column, relationship

if TYPE_CHECKING:
    from .session import VideoCaptureSession


class FrameIndex(Base):
    """
    Index mapping timestamps to video frame positions.

    This table enables efficient frame extraction by storing:
    - Keyframe positions (I-frames) for fast seeking
    - Timestamp to frame number mapping
    - Byte offsets for direct seeking (optional)

    Only keyframes and periodic samples are stored to keep the table size manageable.
    """

    __tablename__ = "frame_index"

    # Primary key
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True)

    # Foreign key to video capture session
    video_capture_session_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("video_capture_sessions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Frame information
    frame_number: Mapped[int] = mapped_column(Integer, nullable=False)
    timestamp_ms: Mapped[int] = mapped_column(
        BigInteger, nullable=False, index=True
    )  # Milliseconds from start

    # Video seeking information
    byte_offset: Mapped[int | None] = mapped_column(
        BigInteger, nullable=True
    )  # Byte position in video file
    is_keyframe: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, index=True
    )

    # Frame metadata (optional, for important frames)
    frame_hash: Mapped[str | None] = mapped_column(
        String(64), nullable=True
    )  # For deduplication/comparison

    # Relationship
    video_capture_session: Mapped["VideoCaptureSession"] = relationship(
        "VideoCaptureSession", back_populates="frame_index"
    )

    __table_args__ = (
        Index(
            "idx_frame_index_session_timestamp",
            "video_capture_session_id",
            "timestamp_ms",
        ),
        Index(
            "idx_frame_index_session_frame", "video_capture_session_id", "frame_number"
        ),
        Index("idx_frame_index_keyframes", "video_capture_session_id", "is_keyframe"),
        UniqueConstraint(
            "video_capture_session_id",
            "frame_number",
            name="uq_frame_index_session_frame",
        ),
    )

    def __repr__(self) -> str:
        return f"<FrameIndex(session={self.video_capture_session_id}, frame={self.frame_number})>"
