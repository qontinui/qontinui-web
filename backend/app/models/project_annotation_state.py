"""
Project Annotation State model for tracking annotation versions and enabling conflict detection.

This model stores the current annotation state for a project, including:
- Version tracking for optimistic concurrency control
- Element count and hash for quick conflict detection
- Full annotation data for merging and restoration
"""

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import JSON, Column, DateTime, ForeignKey, Index, Integer, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class ProjectAnnotationState(Base):
    """Stores the current annotation state for a project.

    This enables:
    - Conflict detection before saving
    - Version tracking for collaborative editing
    - Quick comparison via element count and hash
    """

    __tablename__ = "project_annotation_states"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    # Link to project
    project_id = Column(
        UUID(as_uuid=True),
        ForeignKey("project.projects.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
    )

    # Version tracking for optimistic concurrency control
    version_id = Column(
        String(36),
        nullable=False,
        default=lambda: str(uuid.uuid4()),
        comment="UUID string for version identification",
    )
    version_number = Column(
        Integer,
        nullable=False,
        default=1,
        comment="Incrementing version number",
    )

    # Quick comparison fields
    element_count = Column(
        Integer,
        nullable=False,
        default=0,
        comment="Number of annotation elements",
    )
    elements_hash = Column(
        String(32),
        nullable=False,
        default="",
        comment="MD5 hash of JSON-stringified elements for comparison",
    )

    # Full annotation data stored as JSON
    # Structure: { "annotations": [...], "metadata": {...} }
    annotation_data: Mapped[dict[str, Any] | None] = mapped_column(
        JSON,
        nullable=True,
        default=None,
        comment="Full annotation data for storage and merging",
    )

    # Tracking
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
        nullable=False,
    )
    updated_by_id = Column(
        UUID(as_uuid=True),
        ForeignKey("auth.users.id"),
        nullable=True,
        comment="User who last updated the annotations",
    )

    # Relationships
    project = relationship("Project", backref="annotation_state", uselist=False)
    updated_by = relationship("User")

    __table_args__ = (
        Index("ix_project_annotation_state_updated", "updated_at"),
        {"schema": "project"},
    )
