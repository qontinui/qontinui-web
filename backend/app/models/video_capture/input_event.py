"""InputEvent model for video capture."""

from typing import TYPE_CHECKING

from sqlalchemy import (
    BigInteger,
    Boolean,
    ForeignKey,
    Index,
    Integer,
    SmallInteger,
    String,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from .session import VideoCaptureSession


class InputEvent(Base):
    """
    Input events (mouse and keyboard) captured during a video session.

    Stored as time-series data with millisecond precision timestamps
    relative to session start. This allows efficient querying for
    events within a time range and playback synchronization with video.
    """

    __tablename__ = "input_events"

    # Primary key
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True)

    # Foreign key to video capture session
    video_capture_session_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("project.video_capture_sessions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Timestamp (milliseconds from session start)
    timestamp_ms: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True)

    # Event type
    event_type: Mapped[str] = mapped_column(String(50), nullable=False, index=True)

    # Mouse position (for mouse events)
    mouse_x: Mapped[int | None] = mapped_column(Integer, nullable=True)
    mouse_y: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Mouse button (for click events): 1=left, 2=middle, 3=right
    mouse_button: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)

    # Scroll delta (for scroll events)
    scroll_dx: Mapped[int | None] = mapped_column(Integer, nullable=True)
    scroll_dy: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Keyboard data
    key_code: Mapped[str | None] = mapped_column(
        String(50), nullable=True
    )  # Virtual key code
    key_name: Mapped[str | None] = mapped_column(
        String(50), nullable=True
    )  # Human-readable key name
    key_char: Mapped[str | None] = mapped_column(
        String(10), nullable=True
    )  # Character if printable

    # Modifier keys state
    shift_pressed: Mapped[bool | None] = mapped_column(
        Boolean, nullable=True, default=False
    )
    ctrl_pressed: Mapped[bool | None] = mapped_column(
        Boolean, nullable=True, default=False
    )
    alt_pressed: Mapped[bool | None] = mapped_column(
        Boolean, nullable=True, default=False
    )
    meta_pressed: Mapped[bool | None] = mapped_column(
        Boolean, nullable=True, default=False
    )  # Win/Cmd key

    # Additional event data (for complex events like drag)
    event_data_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    # Relationship
    video_capture_session: Mapped["VideoCaptureSession"] = relationship(
        "VideoCaptureSession", back_populates="input_events"
    )

    __table_args__ = (
        Index(
            "idx_input_events_session_timestamp",
            "video_capture_session_id",
            "timestamp_ms",
        ),
        Index("idx_input_events_type", "event_type"),
        {"schema": "project"},
    )

    def __repr__(self) -> str:
        return f"<InputEvent(id={self.id}, type={self.event_type}, ts={self.timestamp_ms}ms)>"
