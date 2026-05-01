"""
Runner token model — long-lived bearer credentials for headless runners.

A ``RunnerToken`` is minted by an authenticated user and used by a qontinui
runner process to authenticate against this backend. The plaintext value is
only returned once at creation; the database stores an Argon2 hash.
"""

from datetime import datetime
from uuid import UUID, uuid4

from qontinui_schemas.common import utc_now
from sqlalchemy import Boolean, DateTime, ForeignKey, String, text
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class RunnerToken(Base):
    """Persistent record of a runner bearer token.

    Columns mirror the historical schema dropped in migration
    ``7931bff72fe5_remove_runner_tokens`` but widen ``token_hash`` from
    ``VARCHAR(64)`` (SHA-256 hex) to ``VARCHAR(255)`` so a full Argon2 hash
    (including salt and parameters) fits.
    """

    __tablename__ = "runner_tokens"
    __table_args__ = {"schema": "auth"}

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
        server_default=text("gen_random_uuid()"),
    )

    user_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("auth.users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    name: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        comment="User-friendly name like 'My Laptop', 'Work Desktop'",
    )

    token_hash: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        unique=True,
        index=True,
        comment="Argon2 hash of the plain token (plain never persisted)",
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        server_default=text("now()"),
        nullable=False,
    )

    expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        comment="Token expiration time. None = never expires",
    )

    last_used_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        index=True,
        comment="Last time this token was used for authentication",
    )

    is_revoked: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        server_default=text("false"),
        nullable=False,
        index=True,
        comment="Soft-delete flag for audit trail",
    )

    revoked_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        comment="When the token was revoked",
    )

    last_ip_address: Mapped[str | None] = mapped_column(
        String(45),  # IPv6 max length
        nullable=True,
        comment="Last IP address that used this token",
    )

    last_user_agent: Mapped[str | None] = mapped_column(
        String(500),
        nullable=True,
        comment="Last user agent that used this token",
    )

    # Relationships
    user = relationship("User", back_populates="runner_tokens")
    runners = relationship(
        "Runner",
        back_populates="runner_token",
        foreign_keys="Runner.runner_token_id",
    )

    def __repr__(self) -> str:
        """Return string representation of the runner token."""
        state = "revoked" if self.is_revoked else "active"
        return f"<RunnerToken(id={self.id}, name={self.name!r}, {state})>"
