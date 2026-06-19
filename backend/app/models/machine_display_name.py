"""Machine display-name model — per-user friendly names for fleet machines.

A logged-in user can assign a friendly display name to a machine (keyed by
``hostname``). Names are per-user and persisted so they survive a refresh and
sync across the user's devices. The composite primary key ``(user_id,
hostname)`` enforces one display name per user per hostname.
"""

from datetime import UTC, datetime

from sqlalchemy import DateTime, ForeignKey, String, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class MachineDisplayName(Base):
    """Per-user friendly display name for a fleet machine (by hostname)."""

    __tablename__ = "machine_display_names"
    __table_args__ = {"schema": "auth"}

    user_id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("auth.users.id", ondelete="CASCADE"),
        primary_key=True,
        nullable=False,
    )
    hostname: Mapped[str] = mapped_column(String(255), primary_key=True, nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        server_default=text("now()"),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
        server_default=text("now()"),
        nullable=False,
    )
