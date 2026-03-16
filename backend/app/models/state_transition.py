"""
State Transition Model

Represents transitions between discovered states in state discovery analysis.
"""

from datetime import UTC, datetime
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, text
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.discovered_state import DiscoveredState


class StateTransition(Base):
    """
    Represents a transition from one discovered state to another.

    Tracks the relationship between states including trigger events
    and confidence scores.
    """

    __tablename__ = "state_transitions"

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )

    # Foreign keys to discovered states
    from_state_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("discovered_states.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    to_state_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("discovered_states.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Trigger information
    trigger_event_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    event_type: Mapped[str | None] = mapped_column(String(100), nullable=True)

    # Confidence score for this transition (0.0 to 1.0)
    confidence: Mapped[float] = mapped_column(Float, nullable=False, default=1.0)

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
        nullable=False,
    )

    # Relationships
    from_state: Mapped["DiscoveredState"] = relationship(
        "DiscoveredState",
        foreign_keys=[from_state_id],
        back_populates="outgoing_transitions",
    )
    to_state: Mapped["DiscoveredState"] = relationship(
        "DiscoveredState",
        foreign_keys=[to_state_id],
        back_populates="incoming_transitions",
    )

    def __repr__(self) -> str:
        return f"<StateTransition(id={self.id}, from={self.from_state_id}, to={self.to_state_id})>"
