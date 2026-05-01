from datetime import UTC, datetime
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
    """Project model representing a user project."""

    __tablename__ = "projects"
    __table_args__ = {'schema': "project"}

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
    owner_id = Column(UUID(as_uuid=True), ForeignKey("auth.users.id"), nullable=False)
    organization_id = Column(
        UUID(as_uuid=True),
        ForeignKey("auth.organizations.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(UTC))
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
    )

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
    screenshots = relationship(
        "ProjectScreenshot", back_populates="project", cascade="all, delete-orphan"
    )
    images = relationship(
        "ProjectImage", back_populates="project", cascade="all, delete-orphan"
    )
    test_notification_preferences = relationship(
        "TestNotificationPreferences",
        back_populates="project",
        uselist=False,
        cascade="all, delete-orphan",
    )
    visual_baselines = relationship(
        "VisualBaseline",
        back_populates="project",
        cascade="all, delete-orphan",
    )
    embeddings = relationship(
        "ProjectEmbedding",
        back_populates="project",
        cascade="all, delete-orphan",
    )
    embedding_jobs = relationship(
        "EmbeddingGenerationJob",
        back_populates="project",
        cascade="all, delete-orphan",
    )
    detected_issues = relationship(
        "DetectedIssue",
        back_populates="project",
        cascade="all, delete-orphan",
    )
    discoveries = relationship(
        "Discovery",
        back_populates="project",
        cascade="all, delete-orphan",
    )
    execution_runs = relationship(
        "ExecutionRun",
        back_populates="project",
        cascade="all, delete-orphan",
    )
    task_runs = relationship(
        "TaskRun",
        back_populates="project",
    )
    verification_tests = relationship(
        "VerificationTest",
        back_populates="project",
        cascade="all, delete-orphan",
    )
    workflow_test_associations = relationship(
        "WorkflowTestAssociation",
        back_populates="project",
        cascade="all, delete-orphan",
    )
    ui_bridge_configs = relationship(
        "UIBridgeStateConfig",
        back_populates="project",
        cascade="all, delete-orphan",
    )
    exploration_sessions = relationship(
        "UIBridgeExplorationSession",
        back_populates="project",
        cascade="all, delete-orphan",
        order_by="UIBridgeExplorationSession.created_at.desc()",
    )
    domain_knowledge = relationship(
        "DomainKnowledge",
        back_populates="project",
        cascade="all, delete-orphan",
    )
    element_annotation_sets = relationship(
        "ElementAnnotationSet",
        back_populates="project",
        cascade="all, delete-orphan",
    )
    state_discovery_results = relationship(
        "StateDiscoveryResult",
        back_populates="project",
        cascade="all, delete-orphan",
        order_by="StateDiscoveryResult.created_at.desc()",
    )
    template_candidates = relationship(
        "TemplateCandidate",
        back_populates="project",
        cascade="all, delete-orphan",
    )
