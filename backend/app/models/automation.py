"""
Automation models for qontinui-web backend.

Provides models for automation sessions, screenshots, and input events.
"""

from datetime import datetime

from sqlalchemy import (
    TIMESTAMP,
    BigInteger,
    Column,
    DateTime,
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


class AutomationSession(Base):
    """
    Automation session model.

    Represents a single automation workflow execution session.
    """

    __tablename__ = "automation_sessions"

    id = Column(UUID(as_uuid=True), primary_key=True, index=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True)
    workflow_name = Column(String(255), nullable=False)
    status = Column(String(50), nullable=False)  # 'running', 'completed', 'failed'
    started_at = Column(TIMESTAMP, nullable=False, default=datetime.utcnow)
    ended_at = Column(TIMESTAMP, nullable=True)
    created_at = Column(TIMESTAMP, nullable=False, default=datetime.utcnow)

    # Relationships
    user = relationship("User", foreign_keys=[user_id])
    screenshots = relationship(
        "AutomationScreenshot",
        back_populates="session",
        cascade="all, delete-orphan",
    )
    input_events = relationship(
        "AutomationInputEvent",
        back_populates="session",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        Index("ix_automation_sessions_user_started", "user_id", "started_at"),
        Index("ix_automation_sessions_status", "status"),
    )


class AutomationScreenshot(Base):
    """
    Automation screenshot model.

    Stores screenshot metadata and references to S3 storage.
    """

    __tablename__ = "automation_screenshots"

    id = Column(UUID(as_uuid=True), primary_key=True, index=True)
    session_id = Column(
        UUID(as_uuid=True),
        ForeignKey("automation_sessions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    s3_key = Column(String(512), nullable=False)
    timestamp = Column(TIMESTAMP, nullable=False)
    screenshot_metadata = Column(JSONB, nullable=True, default={})
    created_at = Column(TIMESTAMP, nullable=False, default=datetime.utcnow)

    # Relationships
    session = relationship("AutomationSession", back_populates="screenshots")
    input_associations_before = relationship(
        "ScreenshotInputAssociation",
        foreign_keys="ScreenshotInputAssociation.screenshot_id",
        back_populates="screenshot",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        Index("ix_automation_screenshots_session_timestamp", "session_id", "timestamp"),
    )


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


class ScreenshotInputAssociation(Base):
    """
    Many-to-many association between screenshots and input events.

    Allows linking multiple screenshots to input events with relationship metadata.
    """

    __tablename__ = "screenshot_input_associations"

    id = Column(BigInteger, primary_key=True, index=True)
    screenshot_id = Column(
        UUID(as_uuid=True),
        ForeignKey("automation_screenshots.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    input_event_id = Column(
        BigInteger,
        ForeignKey("automation_input_events.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    association_type = Column(
        String(20),
        nullable=False,
    )  # 'before', 'after', 'during'
    time_delta_ms = Column(Integer, nullable=True)  # Time difference in milliseconds
    created_at = Column(TIMESTAMP, nullable=False, default=datetime.utcnow)

    # Relationships
    screenshot = relationship(
        "AutomationScreenshot",
        foreign_keys=[screenshot_id],
        back_populates="input_associations_before",
    )
    input_event = relationship(
        "AutomationInputEvent",
        back_populates="screenshot_associations",
    )

    __table_args__ = (
        Index(
            "ix_screenshot_input_assoc_screenshot_input",
            "screenshot_id",
            "input_event_id",
        ),
        Index("ix_screenshot_input_assoc_type", "association_type"),
    )
