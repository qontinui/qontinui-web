from datetime import datetime
from uuid import uuid4

from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.db.base import Base


class Project(Base):
    __tablename__ = "projects"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
        server_default=text("gen_random_uuid()"),
        index=True,
    )
    name = Column(String, nullable=False)
    description = Column(Text)
    configuration = Column(JSON, nullable=False, default={})
    version = Column(Integer, nullable=False, default=1)
    is_public = Column(Boolean, nullable=False, default=False, index=True)
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
    package_installations = relationship(
        "PackageInstallation", back_populates="project", cascade="all, delete-orphan"
    )
    capture_sessions = relationship(
        "CaptureSession", back_populates="project", cascade="all, delete-orphan"
    )
    software_test_runs = relationship(
        "SoftwareTestRun", back_populates="project", cascade="all, delete-orphan"
    )
    coverage_snapshots = relationship(
        "CoverageSnapshot", back_populates="project", cascade="all, delete-orphan"
    )
    transition_reliability_stats = relationship(
        "TransitionReliability", back_populates="project", cascade="all, delete-orphan"
    )
