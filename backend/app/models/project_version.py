from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import (
    JSON,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.db.base import Base


class ProjectVersion(Base):
    """
    Stores complete snapshots of project state at specific points in time.

    This model supports version history by capturing full project state,
    making it easy to restore to any previous version without reconstructing
    from events/diffs.
    """

    __tablename__ = "project_versions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    project_id = Column(
        UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    version_number = Column(Integer, nullable=False)
    snapshot = Column(
        JSON, nullable=False
    )  # Full project state including configuration
    created_by = Column(
        UUID(as_uuid=True),
        ForeignKey("runner.users.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False
    )
    comment = Column(Text)  # Optional version description/commit message

    # Relationships
    project = relationship("Project", back_populates="versions")
    created_by_user = relationship("User", back_populates="project_versions")

    __table_args__ = (
        UniqueConstraint("project_id", "version_number", name="uq_project_version"),
        Index("ix_project_versions_project_created", "project_id", "created_at"),
    )
