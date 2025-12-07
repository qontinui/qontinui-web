"""
Runner token model for desktop runner authentication.

This model stores dedicated authentication tokens for desktop runners,
separate from user JWT tokens. Tokens are hashed and never stored in plain text.
"""

from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import Boolean, DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class RunnerToken(Base):
    """
    Runner token model for desktop runner authentication.

    Each token represents a unique desktop runner connection. Users can create
    multiple tokens for different devices (e.g., "Work Laptop", "Home PC").

    Security features:
    - Tokens are hashed using SHA-256 before storage
    - Optional expiration dates
    - Revocation support with audit trail
    - Last used tracking for security monitoring
    """

    __tablename__ = "runner_tokens"

    # Primary key
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)

    # Foreign key to user
    user_id: Mapped[UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )

    # Token identification
    name: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        comment="User-friendly name like 'My Laptop', 'Work Desktop'",
    )

    # Token hash (never store plain text)
    token_hash: Mapped[str] = mapped_column(
        String(64),  # SHA-256 produces 64 character hex string
        nullable=False,
        unique=True,
        index=True,
        comment="SHA-256 hash of the token",
    )

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, nullable=False
    )

    expires_at: Mapped[datetime | None] = mapped_column(
        DateTime, nullable=True, comment="Token expiration time. None = never expires"
    )

    last_used_at: Mapped[datetime | None] = mapped_column(
        DateTime,
        nullable=True,
        index=True,
        comment="Last time this token was used for authentication",
    )

    # Revocation
    is_revoked: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        nullable=False,
        index=True,
        comment="Soft delete flag for audit trail",
    )

    revoked_at: Mapped[datetime | None] = mapped_column(
        DateTime, nullable=True, comment="When the token was revoked"
    )

    # Connection tracking metadata
    last_ip_address: Mapped[str | None] = mapped_column(
        String(45),  # IPv6 max length
        nullable=True,
        comment="Last IP address that used this token",
    )

    last_user_agent: Mapped[str | None] = mapped_column(
        String(500), nullable=True, comment="Last user agent that used this token"
    )

    # Relationships
    user = relationship("User", back_populates="runner_tokens")
    connections = relationship(
        "RunnerConnection", back_populates="runner_token", cascade="all, delete-orphan"
    )

    def is_valid(self) -> bool:
        """
        Check if token is currently valid.

        Returns:
            True if token is not revoked and not expired, False otherwise
        """
        if self.is_revoked:
            return False

        if self.expires_at and datetime.utcnow() > self.expires_at:
            return False

        return True

    def __repr__(self) -> str:
        return f"<RunnerToken(id={self.id}, name='{self.name}', user_id={self.user_id}, is_revoked={self.is_revoked})>"
