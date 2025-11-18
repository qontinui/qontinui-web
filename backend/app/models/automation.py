"""
Automation models for qontinui-web backend.

Provides models for automation input events.
"""

from datetime import datetime

from sqlalchemy import (
    TIMESTAMP,
    BigInteger,
    Column,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import relationship

from app.db.base import Base


class AutomationInputEvent(Base):
    """
    Automation input event model.

    Stores input events (mouse, keyboard) captured during automation sessions.
    """

    __tablename__ = "automation_input_events"

    id = Column(BigInteger, primary_key=True, index=True)
    session_id = Column(
        UUID(as_uuid=True),
        ForeignKey("automation_sessions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    event_type = Column(String(50), nullable=False)  # 'mouse.clicked', 'mouse.moved', 'mouse.dragged', 'keyboard.text_typed'
    timestamp = Column(TIMESTAMP, nullable=False)

    # Mouse event fields
    mouse_x = Column(Integer, nullable=True)
    mouse_y = Column(Integer, nullable=True)
    mouse_button = Column(String(20), nullable=True)  # 'left', 'right', 'middle'

    # Drag event fields
    drag_from_x = Column(Integer, nullable=True)
    drag_from_y = Column(Integer, nullable=True)
    drag_to_x = Column(Integer, nullable=True)
    drag_to_y = Column(Integer, nullable=True)
    drag_duration = Column(Float, nullable=True)  # Duration in seconds
    drag_path_points = Column(JSONB, nullable=True)  # Array of {x, y, timestamp} points
    drag_avg_speed = Column(Float, nullable=True)  # Average speed in pixels/second
    drag_max_speed = Column(Float, nullable=True)  # Maximum speed in pixels/second

    # Keyboard event fields
    text_typed = Column(Text, nullable=True)
    character_count = Column(Integer, nullable=True)

    # Screenshot references (nullable - may not have screenshots for all events)
    screenshot_before_id = Column(
        UUID(as_uuid=True),
        ForeignKey("automation_screenshots.id", ondelete="SET NULL"),
        nullable=True,
    )
    screenshot_after_id = Column(
        UUID(as_uuid=True),
        ForeignKey("automation_screenshots.id", ondelete="SET NULL"),
        nullable=True,
    )

    created_at = Column(TIMESTAMP, nullable=False, default=datetime.utcnow)

    # Relationships
    session = relationship("AutomationSession", back_populates="input_events")
    screenshot_before = relationship(
        "AutomationScreenshot",
        foreign_keys=[screenshot_before_id],
    )
    screenshot_after = relationship(
        "AutomationScreenshot",
        foreign_keys=[screenshot_after_id],
    )
    screenshot_associations = relationship(
        "ScreenshotInputAssociation",
        back_populates="input_event",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        Index("ix_automation_input_events_session_timestamp", "session_id", "timestamp"),
        Index("ix_automation_input_events_event_type", "event_type"),
    )
