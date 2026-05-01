from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import DateTime, ForeignKey, String, Text, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

# Default expiry: 24 hours from creation
CLIPBOARD_EXPIRY_HOURS = 24


class ClipboardEntry(Base):
    """
    Clipboard entry for cross-device clipboard sync.

    Stores clipboard content pushed from any authenticated device (runner or mobile)
    and relays it to the user's other devices. Entries auto-expire after 24 hours.
    """

    __tablename__ = "clipboard_entries"
    __table_args__ = {'schema': "project"}

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    user_id: Mapped[UUID] = mapped_column(
        ForeignKey("auth.users.id", ondelete="CASCADE"), nullable=False, index=True
    )

    # Source device info
    source_device_id: Mapped[str] = mapped_column(String(255), nullable=False)
    source_device_name: Mapped[str] = mapped_column(String(255), nullable=False)

    # Content type: "text", "image", "file_ref"
    content_type: Mapped[str] = mapped_column(String(50), nullable=False)

    # Content fields (only one populated depending on content_type)
    text_content: Mapped[str | None] = mapped_column(Text, nullable=True)
    image_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    file_ref: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC)
    )
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC) + timedelta(hours=CLIPBOARD_EXPIRY_HOURS),
    )

    # Relationships
    user = relationship("User")
