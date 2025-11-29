"""
Database models for web extraction.
"""

from datetime import datetime
from uuid import uuid4

from sqlalchemy import JSON, Column, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import ARRAY, UUID
from sqlalchemy.orm import relationship

from app.db.base import Base


class ExtractionSession(Base):
    """A web extraction session."""

    __tablename__ = "extraction_sessions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    project_id = Column(
        UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Source configuration
    source_urls = Column(ARRAY(String), nullable=False, default=list)  # type: ignore[var-annotated]
    config = Column(JSON, nullable=False, default=dict)

    # Status
    status = Column(
        String(50), nullable=False, default="pending"
    )  # pending, running, completed, failed
    error_message = Column(Text, nullable=True)

    # Statistics
    stats = Column(JSON, nullable=False, default=dict)

    # Timestamps
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)

    # User who created
    created_by = Column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    # Relationships
    annotations = relationship(
        "ExtractionAnnotation", back_populates="session", cascade="all, delete-orphan"
    )


class ExtractionAnnotation(Base):
    """Annotations for a single screenshot in an extraction."""

    __tablename__ = "extraction_annotations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    session_id = Column(
        UUID(as_uuid=True),
        ForeignKey("extraction_sessions.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Screenshot reference (stored locally on runner)
    screenshot_id = Column(String(100), nullable=False)
    source_url = Column(Text, nullable=False)

    # Viewport info
    viewport_width = Column(Integer, nullable=False, default=1920)
    viewport_height = Column(Integer, nullable=False, default=1080)

    # Annotations (can be edited in web UI)
    elements = Column(JSON, nullable=False, default=list)
    states = Column(JSON, nullable=False, default=list)

    # Timestamps
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(
        DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    # Relationship
    session = relationship("ExtractionSession", back_populates="annotations")
