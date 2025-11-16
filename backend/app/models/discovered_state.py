"""
Discovered State Model

Stores discovered application states from automation session analysis.
"""

from datetime import datetime
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import DateTime, Float, ForeignKey, String, ARRAY, JSON
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.automation_session import AutomationSession
    from app.models.state_transition import StateTransition


class DiscoveredState(Base):
    """
    Discovered application state from automation session analysis.

    Represents a unique UI state identified through visual analysis and clustering.
    Contains references to screenshots and extracted StateImages that define this state.
    """

    __tablename__ = "discovered_states"

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        server_default="gen_random_uuid()"
    )

    # Foreign key to automation session
    session_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("automation_sessions.id", ondelete="CASCADE"),
        nullable=False,
        index=True
    )

    # Unique state identifier within session (e.g., "state_0", "state_1")
    state_id: Mapped[str] = mapped_column(String(100), nullable=False)

    # Optional human-readable name
    name: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Confidence score for this state discovery (0.0 to 1.0)
    confidence: Mapped[float] = mapped_column(Float, nullable=False)

    # Additional state metadata (JSONB)
    state_metadata: Mapped[dict] = mapped_column(
        "metadata", JSON, default=dict, nullable=False, server_default="{}"
    )

    # Screenshot IDs associated with this state
    screenshot_ids: Mapped[list[UUID]] = mapped_column(
        ARRAY(PGUUID(as_uuid=True)),
        nullable=False,
        server_default="{}"
    )

    # StateImage objects extracted for this state
    # Format: [{"x": int, "y": int, "width": int, "height": int, "pixel_hash": str}]
    state_images: Mapped[list] = mapped_column(
        JSON, nullable=False, server_default="[]"
    )

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False
    )

    # Relationships
    session: Mapped["AutomationSession"] = relationship(
        "AutomationSession",
        back_populates="discovered_states"
    )
    outgoing_transitions: Mapped[list["StateTransition"]] = relationship(
        "StateTransition",
        foreign_keys="StateTransition.from_state_id",
        back_populates="from_state",
        cascade="all, delete-orphan"
    )
    incoming_transitions: Mapped[list["StateTransition"]] = relationship(
        "StateTransition",
        foreign_keys="StateTransition.to_state_id",
        back_populates="to_state",
        cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return f"<DiscoveredState(id={self.id}, state_id='{self.state_id}', session_id={self.session_id})>"
