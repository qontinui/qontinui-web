from datetime import UTC, datetime, timedelta
from uuid import UUID

from app.db.base import Base
from sqlalchemy import BigInteger, DateTime, ForeignKey, String, text
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

# Default expiry: 7 days from creation
SHARED_FILE_EXPIRY_DAYS = 7


class SharedFile(Base):
    """
    Shared file for cross-device file transfer.

    Files uploaded from any authenticated device (runner or mobile) are stored
    on the local filesystem and relayed to the user's other devices.
    Entries auto-expire after 7 days.
    """

    __tablename__ = "shared_files"

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    user_id: Mapped[UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )

    # Source device info
    source_device_id: Mapped[str] = mapped_column(String(255), nullable=False)

    # File metadata
    filename: Mapped[str] = mapped_column(String(512), nullable=False)
    content_type: Mapped[str] = mapped_column(String(255), nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    storage_path: Mapped[str] = mapped_column(String(1024), nullable=False)

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC)
    )
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC) + timedelta(days=SHARED_FILE_EXPIRY_DAYS),
    )

    # Relationships
    user = relationship("User")
