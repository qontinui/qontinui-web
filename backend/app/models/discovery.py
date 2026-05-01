"""Discovery model for storing pending config improvements from runners."""

from datetime import UTC, datetime
from typing import TYPE_CHECKING, Optional
from uuid import UUID

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.project import Project
    from app.models.user import User


class Discovery(Base):
    """
    Stores discoveries from runners that users can review and accept/reject.

    Discovery types:
    - new_element: A new element consistently detected in a state
    - new_transition: A new transition path discovered
    - timing_update: Updated expected duration for a transition
    - flaky_detection: Element/transition identified as flaky
    - unexpected_element: Element consistently appearing unexpectedly
    """

    __tablename__ = "discoveries"

    id: Mapped[UUID] = mapped_column(
        primary_key=True, server_default=text("gen_random_uuid()")
    )
    user_id: Mapped[UUID] = mapped_column(
        ForeignKey("auth.users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    project_id: Mapped[UUID] = mapped_column(
        ForeignKey("project.projects.id", ondelete="CASCADE"), nullable=False, index=True
    )

    # Runner info
    runner_id: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    runner_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    config_id: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    config_name: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Discovery details
    discovery_type: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    # The actual discovery data (flexible JSON)
    discovery_data: Mapped[dict] = mapped_column(
        JSONB, nullable=False, server_default=text("'{}'::jsonb")
    )

    # Evidence from runs
    evidence: Mapped[dict] = mapped_column(
        JSONB, nullable=False, server_default=text("'{}'::jsonb")
    )
    confidence: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    runs_observed: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Status
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="pending", index=True
    )

    # User response
    reviewed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    reviewed_by_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("auth.users.id", ondelete="SET NULL"), nullable=True
    )
    user_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    applied_to_config: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False
    )

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()"), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=text("now()"),
        onupdate=lambda: datetime.now(UTC),
        nullable=False,
    )

    # Relationships
    user: Mapped["User"] = relationship(
        "User", foreign_keys=[user_id], back_populates="discoveries"
    )
    reviewer: Mapped[Optional["User"]] = relationship(
        "User", foreign_keys=[reviewed_by_id]
    )
    project: Mapped["Project"] = relationship("Project", back_populates="discoveries")

    __table_args__ = (
        Index("ix_discoveries_project_status", "project_id", "status"),
        Index("ix_discoveries_user_status", "user_id", "status"),
        Index("ix_discoveries_config_type", "config_id", "discovery_type"),
        {"schema": "project"},
    )

    def __repr__(self) -> str:
        return f"<Discovery(id={self.id}, type={self.discovery_type}, status={self.status})>"
