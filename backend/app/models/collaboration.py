"""
Collaboration models for real-time project collaboration features.

Includes:
- ProjectLock: Manages resource locks for concurrent editing
- ProjectComment: Comments and discussions on project resources
- ActivityLog: Tracks all project activities for real-time updates
- ConflictLog: Tracks and manages merge conflicts for collaborative editing
"""

from datetime import datetime, timedelta
from enum import Enum as PyEnum
from uuid import UUID as PyUUID

from app.db.base import Base
from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship


class ResourceType(str, PyEnum):
    """Types of resources that can be locked or commented on."""

    WORKFLOW = "workflow"
    STATE = "state"
    IMAGE = "image"
    TRANSITION = "transition"
    ACTION = "action"
    PROJECT = "project"


class ActionType(str, PyEnum):
    """Types of actions that can be logged."""

    CREATED = "created"
    MODIFIED = "modified"
    DELETED = "deleted"
    SHARED = "shared"
    COMMENTED = "commented"
    LOCKED = "locked"
    UNLOCKED = "unlocked"
    VIEWED = "viewed"
    EXPORTED = "exported"
    IMPORTED = "imported"


class ProjectLock(Base):
    """
    Resource locking for concurrent editing prevention.

    Manages locks on project resources (workflows, states, images, etc.)
    to prevent conflicts when multiple users are editing simultaneously.
    """

    __tablename__ = "project_locks"

    id = Column(
        UUID(as_uuid=True), primary_key=True, server_default="gen_random_uuid()"
    )
    project_id = Column(
        UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    resource_type = Column(Enum(ResourceType), nullable=False)
    resource_id = Column(String, nullable=False, index=True)
    acquired_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    expires_at = Column(DateTime, nullable=False)
    auto_release = Column(Boolean, default=True, nullable=False)
    lock_metadata: Mapped[dict] = mapped_column("metadata", JSON, nullable=True)

    # Relationships
    project = relationship("Project", backref="locks")
    user = relationship("User", backref="locks")

    def __init__(self, **kwargs):
        """Initialize lock with default expiration if not provided."""
        if "expires_at" not in kwargs and "acquired_at" in kwargs:
            # Default lock duration: 5 minutes
            kwargs["expires_at"] = kwargs["acquired_at"] + timedelta(minutes=5)
        elif "expires_at" not in kwargs:
            kwargs["expires_at"] = datetime.utcnow() + timedelta(minutes=5)
        super().__init__(**kwargs)

    def is_expired(self) -> bool:
        """Check if lock has expired."""
        return datetime.utcnow() > self.expires_at

    def extend_lock(self, minutes: int = 5) -> None:
        """Extend lock expiration time."""
        self.expires_at = datetime.utcnow() + timedelta(minutes=minutes)


class ProjectComment(Base):
    """
    Comments and discussions on project resources.

    Supports threaded discussions, mentions, and positioning for canvas-based comments.
    """

    __tablename__ = "project_comments"

    id = Column(
        UUID(as_uuid=True), primary_key=True, server_default="gen_random_uuid()"
    )
    project_id = Column(
        UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    workflow_id = Column(
        String, nullable=True, index=True
    )  # Optional: specific workflow
    action_id = Column(
        String, nullable=True, index=True
    )  # Optional: specific action/state
    author_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    content = Column(Text, nullable=False)
    position = Column(
        JSON, nullable=True
    )  # {x: number, y: number} for canvas positioning
    mentions = Column(JSON, nullable=True)  # Array of user IDs mentioned in comment
    resolved = Column(Boolean, default=False, nullable=False)
    resolved_by = Column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    resolved_at = Column(DateTime, nullable=True)
    parent_comment_id = Column(
        UUID(as_uuid=True),
        ForeignKey("project_comments.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )
    comment_metadata: Mapped[dict] = mapped_column(
        "metadata", JSON, nullable=True
    )  # Additional metadata (attachments, reactions, etc.)

    # Relationships
    project = relationship("Project", backref="comments")
    author = relationship("User", foreign_keys=[author_id], backref="comments")
    resolver = relationship(
        "User", foreign_keys=[resolved_by], backref="resolved_comments"
    )
    parent = relationship("ProjectComment", remote_side=[id], backref="replies")

    def resolve(self, user_id: PyUUID) -> None:
        """Mark comment as resolved."""
        self.resolved = True
        self.resolved_by = user_id
        self.resolved_at = datetime.utcnow()

    def unresolve(self) -> None:
        """Mark comment as unresolved."""
        self.resolved = False
        self.resolved_by = None
        self.resolved_at = None


class ActivityLog(Base):
    """
    Activity log for tracking all project activities.

    Tracks all user actions within a project for real-time updates,
    audit trails, and activity feeds.
    """

    __tablename__ = "activity_logs"

    id = Column(
        UUID(as_uuid=True), primary_key=True, server_default="gen_random_uuid()"
    )
    project_id = Column(
        UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    action_type = Column(Enum(ActionType), nullable=False, index=True)
    resource_type = Column(Enum(ResourceType), nullable=False)
    resource_id = Column(String, nullable=False, index=True)
    resource_name = Column(String, nullable=True)  # Human-readable resource name
    changes = Column(JSON, nullable=True)  # Detailed change information
    activity_metadata: Mapped[dict] = mapped_column(
        "metadata", JSON, nullable=True
    )  # Additional context
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)

    # Relationships
    project = relationship("Project", backref="activities")
    user = relationship("User", backref="activities")

    @classmethod
    def create_activity(
        cls,
        project_id: PyUUID,
        user_id: PyUUID,
        action_type: ActionType,
        resource_type: ResourceType,
        resource_id: str,
        resource_name: str = None,
        changes: dict = None,
        activity_metadata: dict = None,
    ) -> "ActivityLog":
        """
        Factory method to create activity log entry.

        Args:
            project_id: ID of the project
            user_id: ID of the user performing the action
            action_type: Type of action performed
            resource_type: Type of resource affected
            resource_id: ID of the resource
            resource_name: Human-readable name of the resource
            changes: Dictionary of changes made
            activity_metadata: Additional context

        Returns:
            ActivityLog instance
        """
        return cls(
            project_id=project_id,
            user_id=user_id,
            action_type=action_type,
            resource_type=resource_type,
            resource_id=resource_id,
            resource_name=resource_name,
            changes=changes,
            activity_metadata=activity_metadata,
        )


class ConflictLog(Base):
    """
    Conflict log for tracking merge conflicts during collaborative editing.

    Implements 3-way merge conflict detection and resolution tracking.
    Stores base, local, and remote versions of conflicting data.
    """

    __tablename__ = "conflict_logs"

    id = Column(
        UUID(as_uuid=True), primary_key=True, server_default="gen_random_uuid()"
    )
    resource_type = Column(String, nullable=False)
    resource_id = Column(String, nullable=False, index=True)
    local_version = Column(Integer, nullable=False)
    remote_version = Column(Integer, nullable=False)
    local_user_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    remote_user_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    base_data = Column(JSON, nullable=True)  # Data before both edits
    local_data = Column(JSON, nullable=True)  # Local user's changes
    remote_data = Column(JSON, nullable=True)  # Remote user's changes
    changes = Column(JSON, nullable=True)  # Array of ConflictChange objects
    detected_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    resolved = Column(Boolean, default=False, nullable=False)
    resolved_at = Column(DateTime, nullable=True)
    resolution_type = Column(String, nullable=True)  # 'local', 'remote', 'merge'
    resolved_data = Column(JSON, nullable=True)  # Final merged data
    conflict_metadata: Mapped[dict] = mapped_column("metadata", JSON, nullable=True)

    # Relationships
    local_user = relationship(
        "User", foreign_keys=[local_user_id], backref="local_conflicts"
    )
    remote_user = relationship(
        "User", foreign_keys=[remote_user_id], backref="remote_conflicts"
    )

    def resolve(self, resolution_type: str, resolved_data: dict) -> None:
        """
        Mark conflict as resolved.

        Args:
            resolution_type: Type of resolution ('local', 'remote', 'merge')
            resolved_data: Final merged data
        """
        if resolution_type not in ["local", "remote", "merge"]:
            raise ValueError(f"Invalid resolution_type: {resolution_type}")

        self.resolved = True
        self.resolved_at = datetime.utcnow()
        self.resolution_type = resolution_type
        self.resolved_data = resolved_data

    @classmethod
    def create_conflict(
        cls,
        resource_type: str,
        resource_id: str,
        local_version: int,
        remote_version: int,
        local_user_id: PyUUID,
        remote_user_id: PyUUID,
        base_data: dict = None,
        local_data: dict = None,
        remote_data: dict = None,
        changes: list = None,
        metadata: dict = None,
    ) -> "ConflictLog":
        """
        Factory method to create conflict log entry.

        Args:
            resource_type: Type of resource (workflow, state, etc.)
            resource_id: ID of the resource
            local_version: Version number of local changes
            remote_version: Version number of remote changes
            local_user_id: ID of user with local changes
            remote_user_id: ID of user with remote changes
            base_data: Data before both edits
            local_data: Local user's changes
            remote_data: Remote user's changes
            changes: Array of ConflictChange objects
            metadata: Additional context

        Returns:
            ConflictLog instance
        """
        return cls(
            resource_type=resource_type,
            resource_id=resource_id,
            local_version=local_version,
            remote_version=remote_version,
            local_user_id=local_user_id,
            remote_user_id=remote_user_id,
            base_data=base_data,
            local_data=local_data,
            remote_data=remote_data,
            changes=changes,
            conflict_metadata=metadata,
        )
