"""
Finding Category Config Model

Stores per-user finding category configurations.
Categories define how AI-detected findings are classified (e.g. Code Bug, Security, TODO).
Built-in categories are seeded on first access; users can also create custom categories.
"""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class FindingCategoryConfig(Base):
    """
    Per-user finding category configuration.

    Each row represents one category (built-in or custom).
    Built-in categories are auto-seeded and cannot be deleted.
    """

    __tablename__ = "finding_category_configs"

    id: Mapped[UUID] = mapped_column(
        primary_key=True, server_default=text("gen_random_uuid()")
    )
    user_id: Mapped[UUID] = mapped_column(
        ForeignKey("runner.users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    slug: Mapped[str] = mapped_column(String(100), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    icon: Mapped[str] = mapped_column(String(50), nullable=False)
    color: Mapped[str] = mapped_column(String(30), nullable=False)
    is_built_in: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    default_action_type: Mapped[str] = mapped_column(
        String(30), nullable=False
    )  # auto_fix | needs_user_input | manual | informational
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()"), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=text("now()"),
        onupdate=lambda: datetime.now(UTC),
        nullable=False,
    )

    __table_args__ = (
        UniqueConstraint("user_id", "slug", name="uq_finding_category_user_slug"),
    )

    def __repr__(self) -> str:
        """Return string representation of FindingCategoryConfig."""
        return f"<FindingCategoryConfig(id={self.id}, slug='{self.slug}', name='{self.name}', built_in={self.is_built_in})>"
