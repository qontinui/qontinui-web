"""Push device model for storing Expo push notification tokens."""

from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, String, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.db.base import Base


class PushDevice(Base):
    """
    Push notification device registration.

    Mobile clients register their Expo push token after login so the backend
    can send push notifications for workflow events.
    """

    __tablename__ = "push_devices"
    __table_args__ = {"schema": "auth"}

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
        server_default=text("gen_random_uuid()"),
        index=True,
    )
    user_id = Column(
        UUID(as_uuid=True),
        ForeignKey("auth.users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    push_token = Column(String(255), nullable=False, unique=True, index=True)
    platform = Column(String(50), nullable=False, default="expo")
    device_name = Column(String(255), nullable=True)
    is_active = Column(
        Boolean, default=True, server_default=text("true"), nullable=False, index=True
    )
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
    user = relationship("User", back_populates="push_devices")
