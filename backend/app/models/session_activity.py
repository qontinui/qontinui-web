"""
Session activity model for tracking user session metadata.

This model tracks:
- First login timestamp (session start)
- Last activity timestamp (updated on each request)
- Session expiry (absolute maximum)
- JWT ID (jti) for token identification
"""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import DateTime, ForeignKey, String, text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class SessionActivity(Base):
    """
    Tracks session activity for sliding window authentication.

    Each record represents an active session with metadata to enforce:
    1. Absolute maximum session duration (MAX_SESSION_DAYS)
    2. Activity-based session extension (sliding window)
    3. Token rotation and invalidation
    """

    __tablename__ = "session_activities"
    __table_args__ = {"schema": "project"}

    id: Mapped[UUID] = mapped_column(
        primary_key=True, server_default=text("gen_random_uuid()")
    )
    user_id: Mapped[UUID] = mapped_column(
        ForeignKey("auth.users.id", ondelete="CASCADE"), nullable=False, index=True
    )

    # JWT ID from the refresh token - used to invalidate specific sessions
    jti: Mapped[str] = mapped_column(String, unique=True, nullable=False, index=True)

    # Timestamps for session management
    first_login_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(UTC)
    )
    last_activity_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(UTC)
    )

    # Absolute session expiry (first_login_at + MAX_SESSION_DAYS)
    absolute_expiry_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )

    # Metadata
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
    )
