"""Render log models for development debugging.

These models store DOM snapshots captured by the frontend for AI-assisted
debugging. Only used when RENDER_LOG_ENABLED=True (development mode).
"""

from datetime import datetime
from enum import StrEnum
from uuid import UUID

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class RenderLogTrigger(StrEnum):
    """Trigger type for render log capture."""

    MUTATION = "mutation"  # DOM mutation observed
    NAVIGATION = "navigation"  # Page navigation
    MANUAL = "manual"  # Explicit capture call
    INTERVAL = "interval"  # Periodic capture


class RenderLogMutationType(StrEnum):
    """Type of DOM mutation that triggered the capture."""

    CHILD_LIST = "childList"  # Child nodes added/removed
    ATTRIBUTES = "attributes"  # Attribute changed
    CHARACTER_DATA = "characterData"  # Text content changed


class RenderImageType(StrEnum):
    """Type of captured image."""

    SCREENSHOT = "screenshot"  # Full page screenshot
    ELEMENT = "element"  # Specific element capture
    CANVAS = "canvas"  # Canvas element content


class RenderLog(Base):
    """
    Render log model for storing DOM snapshots.

    Captures comprehensive DOM state for AI-assisted debugging including:
    - Full element tree with text content
    - Element positions and dimensions
    - Computed styles
    - Visibility states

    The snapshot field (JSONB) contains the full DOM tree structure.
    """

    __tablename__ = "render_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    # Session identification (groups related snapshots)
    session_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)

    # Capture timestamp
    timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=datetime.utcnow,
        server_default="now()",
    )

    # Page context
    page_url: Mapped[str] = mapped_column(String(512), nullable=False)
    page_title: Mapped[str | None] = mapped_column(String(256), nullable=True)

    # Capture trigger
    trigger: Mapped[str] = mapped_column(String(64), nullable=False)
    mutation_type: Mapped[str | None] = mapped_column(String(32), nullable=True)
    target_selector: Mapped[str | None] = mapped_column(Text, nullable=True)

    # DOM snapshot - full element tree with text, position, styling
    snapshot: Mapped[dict] = mapped_column(JSONB, nullable=False)

    # Viewport information
    viewport_width: Mapped[int | None] = mapped_column(Integer, nullable=True)
    viewport_height: Mapped[int | None] = mapped_column(Integer, nullable=True)
    scroll_x: Mapped[int | None] = mapped_column(Integer, nullable=True)
    scroll_y: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Performance metrics
    capture_duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    element_count: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # User context (optional)
    user_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Relationships
    user = relationship("User", back_populates="render_logs")
    images: Mapped[list["RenderImage"]] = relationship(
        "RenderImage", back_populates="render_log", cascade="all, delete-orphan"
    )

    # Composite indexes for efficient queries
    __table_args__ = (
        Index("ix_render_logs_session_timestamp", "session_id", "timestamp"),
        Index("ix_render_logs_page_url", "page_url"),
    )

    def __repr__(self) -> str:
        return f"<RenderLog(id={self.id}, session_id={self.session_id}, page_url={self.page_url}, trigger={self.trigger})>"


class RenderImage(Base):
    """
    Render image model for storing captured images.

    References image files stored on disk (not in database) to avoid
    bloating the database with binary data.
    """

    __tablename__ = "render_images"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    # Parent render log
    render_log_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("render_logs.id", ondelete="CASCADE"), nullable=False
    )

    # Image metadata
    image_type: Mapped[str] = mapped_column(String(32), nullable=False)
    element_selector: Mapped[str | None] = mapped_column(Text, nullable=True)

    # File reference (path relative to RENDER_LOG_IMAGE_DIR)
    file_path: Mapped[str] = mapped_column(String(512), nullable=False)

    # Image dimensions
    width: Mapped[int | None] = mapped_column(Integer, nullable=True)
    height: Mapped[int | None] = mapped_column(Integer, nullable=True)
    file_size_bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    mime_type: Mapped[str | None] = mapped_column(String(64), nullable=True)

    # Timestamp
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=datetime.utcnow,
        server_default="now()",
    )

    # Relationships
    render_log: Mapped["RenderLog"] = relationship("RenderLog", back_populates="images")

    # Index for finding images by render log
    __table_args__ = (Index("ix_render_images_render_log_id", "render_log_id"),)

    def __repr__(self) -> str:
        return f"<RenderImage(id={self.id}, render_log_id={self.render_log_id}, image_type={self.image_type})>"
