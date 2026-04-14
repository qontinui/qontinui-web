import secrets
from datetime import UTC, datetime, timedelta
from enum import StrEnum

from app.db.base import Base
from sqlalchemy import (JSON, Boolean, CheckConstraint, Column, DateTime,
                        ForeignKey, Index, String, Text, UniqueConstraint,
                        text)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship


class TeamRole(StrEnum):
    """Team member roles with hierarchical permissions"""

    OWNER = "owner"
    ADMIN = "admin"
    MEMBER = "member"
    VIEWER = "viewer"


class PermissionLevel(StrEnum):
    """Project access permission levels"""

    VIEW = "view"
    COMMENT = "comment"
    EDIT = "edit"
    ADMIN = "admin"


class Organization(Base):
    """
    Organization model for team collaboration.

    Organizations allow users to collaborate on projects and manage team members.
    Each organization has an owner and can have multiple members with different roles.
    """

    __tablename__ = "organizations"

    id = Column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    name = Column(String, nullable=False, index=True)
    slug = Column(String, unique=True, nullable=False, index=True)
    description = Column(Text, nullable=True)
    owner_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    avatar_url = Column(String, nullable=True)
    settings = Column(JSON, default={}, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False
    )
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
        nullable=False,
    )

    # Relationships
    owner = relationship("User", foreign_keys=[owner_id])
    members = relationship(
        "TeamMember",
        back_populates="organization",
        cascade="all, delete-orphan",
        foreign_keys="TeamMember.organization_id",
    )
    projects = relationship(
        "Project",
        secondary="project_access_control",
        viewonly=True,
    )
    invitations = relationship(
        "OrganizationInvitation",
        back_populates="organization",
        cascade="all, delete-orphan",
    )

    # Indexes
    __table_args__ = (Index("idx_org_slug", "slug"),)

    def __repr__(self):
        """Return string representation of Organization."""
        return f"<Organization(id={self.id}, name={self.name}, slug={self.slug})>"


class TeamMember(Base):
    """
    Team member model linking users to organizations with roles.

    Tracks user membership in organizations, their role, permissions,
    and activity within the organization.
    """

    __tablename__ = "team_members"

    id = Column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    organization_id = Column(
        UUID(as_uuid=True),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )
    user_id = Column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    role = Column(String, default=TeamRole.MEMBER.value, nullable=False)
    permissions = Column(JSON, default={}, nullable=False)
    invited_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    joined_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False
    )
    last_active_at = Column(DateTime(timezone=True), nullable=True)

    # Relationships
    organization = relationship(
        "Organization",
        back_populates="members",
        foreign_keys=[organization_id],
    )
    user = relationship(
        "User",
        foreign_keys=[user_id],
    )
    inviter = relationship(
        "User",
        foreign_keys=[invited_by],
    )

    # Constraints and Indexes
    __table_args__ = (
        UniqueConstraint("organization_id", "user_id", name="uq_org_user"),
        Index("idx_org_user", "organization_id", "user_id"),
        Index("idx_team_member_user", "user_id"),
        Index("idx_team_member_org", "organization_id"),
    )

    def __repr__(self):
        """Return string representation of TeamMember."""
        return f"<TeamMember(org={self.organization_id}, user={self.user_id}, role={self.role})>"


class OrganizationInvitation(Base):
    """
    Organization invitation model for inviting users via email.

    Tracks pending invitations to join organizations. Invitations expire
    after a set period and can be accepted once.
    """

    __tablename__ = "organization_invitations"

    id = Column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    organization_id = Column(
        UUID(as_uuid=True),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )
    email = Column(String, nullable=False)
    role = Column(String, default=TeamRole.MEMBER.value, nullable=False)
    invited_by = Column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    token = Column(String, unique=True, nullable=False, index=True)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    accepted_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False
    )

    # Relationships
    organization = relationship(
        "Organization",
        back_populates="invitations",
    )
    inviter = relationship(
        "User",
        foreign_keys=[invited_by],
    )

    # Indexes
    __table_args__ = (
        Index("idx_invitation_email", "email"),
        Index("idx_invitation_org", "organization_id"),
        Index("idx_invitation_token", "token"),
    )

    def __repr__(self):
        """Return string representation of OrganizationInvitation."""
        return (
            f"<OrganizationInvitation(org={self.organization_id}, email={self.email})>"
        )

    @staticmethod
    def generate_token():
        """Generate a secure random token for invitation links"""
        return secrets.token_urlsafe(32)

    @staticmethod
    def default_expiry():
        """Default expiry time for invitations (7 days)"""
        return datetime.now(UTC) + timedelta(days=7)

    @property
    def is_expired(self):
        """Check if invitation has expired"""
        return datetime.now(UTC) > self.expires_at

    @property
    def is_accepted(self):
        """Check if invitation has been accepted"""
        return self.accepted_at is not None


class ProjectAccessControl(Base):
    """
    Project access control model for managing project permissions.

    Manages fine-grained access control for projects, supporting both
    individual user access and organization-wide access. Each access
    entry can have an optional expiration date.
    """

    __tablename__ = "project_access_control"

    id = Column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    project_id = Column(
        UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
    )
    user_id = Column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=True
    )
    organization_id = Column(
        UUID(as_uuid=True),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=True,
    )
    permission_level = Column(
        String, default=PermissionLevel.VIEW.value, nullable=False
    )
    created_by = Column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    expires_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False
    )

    # Relationships
    project = relationship("Project")
    user = relationship(
        "User",
        foreign_keys=[user_id],
    )
    organization = relationship(
        "Organization",
    )
    creator = relationship(
        "User",
        foreign_keys=[created_by],
    )

    # Constraints and Indexes
    __table_args__ = (
        CheckConstraint(
            "(user_id IS NOT NULL AND organization_id IS NULL) OR "
            "(user_id IS NULL AND organization_id IS NOT NULL)",
            name="chk_user_or_org",
        ),
        Index("idx_project_access_project", "project_id"),
        Index("idx_project_access_user", "user_id"),
        Index("idx_project_access_org", "organization_id"),
        Index("idx_project_access_expires_at", "expires_at"),
    )

    def __repr__(self):
        """Return string representation of ProjectAccessControl."""
        target = (
            f"user={self.user_id}" if self.user_id else f"org={self.organization_id}"
        )
        return f"<ProjectAccessControl(project={self.project_id}, {target}, level={self.permission_level})>"

    @property
    def is_expired(self) -> bool:
        """Check if access has expired"""
        if self.expires_at is None:
            return False  # type: ignore[unreachable]
        return datetime.now(UTC) > self.expires_at  # type: ignore[return-value]
