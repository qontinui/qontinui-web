from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, String, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.db.base import Base


class RunnerDevice(Base):
    """
    Runner device registration model.

    Tracks desktop runner devices that connect to the platform.
    Each device is associated with a user and has a unique device_id.
    """

    __tablename__ = "runner_devices"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
        server_default=text("gen_random_uuid()"),
        index=True,
    )
    user_id = Column(
        UUID(as_uuid=True),
        ForeignKey("runner.users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    device_id = Column(String(255), nullable=False, unique=True, index=True)
    device_name = Column(String(255), nullable=False)
    platform = Column(String(50), nullable=False)
    last_seen_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False
    )
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
        nullable=False,
    )
    is_active = Column(Boolean, default=True, nullable=False, index=True)

    # Relationships
    user = relationship("User", back_populates="runner_devices")
