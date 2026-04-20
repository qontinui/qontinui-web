from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class DeviceSession(Base):
    """
    Device session model for tracking user devices and detecting suspicious activity.

    This model stores device fingerprints to:
    - Detect logins from new/unknown devices
    - Help prevent token theft (token + device fingerprint validation)
    - Allow users to manage their trusted devices
    - Track last seen activity per device
    - Verify new devices via email
    - Track geolocation from IP addresses
    """

    __tablename__ = "device_sessions"

    id: Mapped[UUID] = mapped_column(primary_key=True)
    user_id: Mapped[UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )

    # Device fingerprint (hash of device characteristics)
    device_fingerprint: Mapped[str] = mapped_column(
        String(255), nullable=False, index=True
    )

    # Device information
    ip_address: Mapped[str] = mapped_column(
        String(45), nullable=False
    )  # IPv6 max length
    user_agent: Mapped[str] = mapped_column(Text, nullable=False)
    accept_language: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Trust and activity tracking
    is_trusted: Mapped[bool] = mapped_column(Boolean, default=False)
    first_seen: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC)
    )
    last_seen: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
    )
    last_ip: Mapped[str] = mapped_column(String(45), nullable=False)  # Track IP changes

    # Optional: Device name set by user
    device_name: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Email verification for new devices
    email_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    verification_token: Mapped[str | None] = mapped_column(
        Text, nullable=True, index=True
    )
    verification_sent_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # Geolocation from IP address
    country: Mapped[str | None] = mapped_column(String(100), nullable=True)
    city: Mapped[str | None] = mapped_column(String(100), nullable=True)

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
    )

    # Relationships
    user = relationship("User", back_populates="device_sessions")
