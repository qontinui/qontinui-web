"""Sync lock model for coordinating backend operations with frontend sync."""

from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import Column, DateTime, ForeignKey, Index, String, Text, text
from sqlalchemy.dialects.postgresql import UUID

from app.db.base_class import Base


class SyncLock(Base):
    """
    Sync lock for coordinating backend operations with frontend sync.

    When a backend operation needs exclusive access to a project (e.g., import states),
    it acquires a sync lock. This tells all connected frontend clients to pause
    local saves until the lock is released.

    Locks automatically expire after TTL to prevent deadlocks if the backend
    operation crashes or the release fails.
    """

    __tablename__ = "sync_locks"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
        server_default=text("gen_random_uuid()"),
    )
    project_id = Column(
        UUID(as_uuid=True),
        ForeignKey("project.projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id = Column(
        UUID(as_uuid=True),
        ForeignKey("auth.users.id", ondelete="CASCADE"),
        nullable=False,
    )
    operation = Column(
        String(100),
        nullable=False,
        doc="Description of the operation holding the lock",
    )
    acquired_at = Column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(UTC),
        server_default=text("now()"),
    )
    expires_at = Column(
        DateTime(timezone=True),
        nullable=False,
        doc="When the lock automatically expires",
    )
    released_at = Column(
        DateTime(timezone=True),
        nullable=True,
        doc="When the lock was explicitly released (null if still held or expired)",
    )
    error_message = Column(
        Text,
        nullable=True,
        doc="Error message if the operation failed",
    )

    __table_args__ = (
        Index(
            "ix_sync_locks_project_active",
            "project_id",
            unique=True,
            postgresql_where=text("released_at IS NULL"),
        ),
        {"schema": "project"},
    )

    @property
    def is_active(self) -> bool:
        """Check if the lock is still active (not released and not expired)."""
        if self.released_at is not None:
            return False
        return self.expires_at > datetime.now(UTC)  # type: ignore[return-value]
