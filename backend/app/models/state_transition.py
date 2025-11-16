"""
State Transition Model

Tracks transitions between discovered states triggered by input events.
"""

from datetime import datetime
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import (
    BigInteger,
    DateTime,
    Float,
    ForeignKey,
    JSON,
    String,
)
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.automation import AutomationInputEvent
    from app.models.automation_session import AutomationSession
    from app.models.discovered_state import DiscoveredState


class StateTransition(Base):
    """
    Represents a transition from one discovered state to another.

    Transitions are triggered by input events (clicks, keyboard input, etc.)
    and represent the flow through the application's state graph.
    """

    __tablename__ = "state_transitions"

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

    # Source state
    from_state_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("discovered_states.id", ondelete="CASCADE"),
        nullable=True,
        index=True
    )

    # Destination state
    to_state_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("discovered_states.id", ondelete="CASCADE"),
        nullable=True,
        index=True
    )

    # Input event that triggered this transition
    trigger_event_id: Mapped[int | None] = mapped_column(
        BigInteger,
        ForeignKey("automation_input_events.id", ondelete="SET NULL"),
        nullable=True,
        index=True
    )

    # Event type (for quick filtering)
    event_type: Mapped[str | None] = mapped_column(String(50), nullable=True)

    # Confidence score for this transition (0.0 to 1.0)
    confidence: Mapped[float] = mapped_column(Float, nullable=False)

    # When the transition occurred
    timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )

    # Additional transition metadata (JSONB)
    transition_metadata: Mapped[dict] = mapped_column(
        "metadata", JSON, default=dict, nullable=False, server_default="{}"
    )

    # Created timestamp
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow, nullable=False
    )

    # Relationships
    session: Mapped["AutomationSession"] = relationship(
        "AutomationSession",
        back_populates="state_transitions"
    )
    from_state: Mapped["DiscoveredState"] = relationship(
        "DiscoveredState",
        foreign_keys=[from_state_id],
        back_populates="outgoing_transitions"
    )
    to_state: Mapped["DiscoveredState"] = relationship(
        "DiscoveredState",
        foreign_keys=[to_state_id],
        back_populates="incoming_transitions"
    )
    trigger_event: Mapped["AutomationInputEvent"] = relationship(
        "AutomationInputEvent",
        foreign_keys=[trigger_event_id]
    )

    def __repr__(self) -> str:
        return (
            f"<StateTransition(id={self.id}, "
            f"from={self.from_state_id}, to={self.to_state_id}, "
            f"event_type='{self.event_type}')>"
        )
