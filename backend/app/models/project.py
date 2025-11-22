from datetime import datetime

from app.db.base import Base
from sqlalchemy import JSON, Column, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship


class Project(Base):
    __tablename__ = "projects"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    description = Column(Text)
    configuration = Column(JSON, nullable=False, default={})
    version = Column(Integer, nullable=False, default=1)
    owner_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    organization_id = Column(
        UUID(as_uuid=True),
        ForeignKey("organizations.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    owner = relationship("User", back_populates="projects")
    organization = relationship("Organization", back_populates="projects")
    snapshot_runs = relationship(
        "SnapshotRun", back_populates="project", cascade="all, delete-orphan"
    )
    versions = relationship(
        "ProjectVersion", back_populates="project", cascade="all, delete-orphan"
    )
    edit_commands = relationship(
        "EditCommand", back_populates="project", cascade="all, delete-orphan"
    )
