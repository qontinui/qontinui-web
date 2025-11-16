"""
State Transition Model

Tracks transitions between discovered states triggered by input events.
Unified model that supports BOTH automation sessions and recordings.
"""

from datetime import datetime
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    JSON,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.automation import AutomationInputEvent
    from app.models.automation_session import AutomationSession
    from app.models.discovered_state import DiscoveredState
    from app.models.recording import Recording, RecordingInteraction


class StateTransition(Base):
    """
    Represents a transition from one discovered state to another.

    Supports discovery from BOTH automation sessions and recordings.
    Transitions are triggered by input events (clicks, keyboard input, etc.)
    and represent the flow through the application's state graph.
    """

    __tablename__ = "state_transitions"

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        server_default="gen_random_uuid()"
    )

    # Source type - identifies where this transition was discovered from
    source_type: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        index=True
    )  # 'automation_session' | 'recording'

    # Foreign keys for BOTH sources (only one should be set)
    automation_session_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("automation_sessions.id", ondelete="CASCADE"),
        nullable=True,
        index=True
    )
    recording_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("recordings.id", ondelete="CASCADE"),
        nullable=True,
        index=True
    )

    # Legacy field for backward compatibility with automation sessions
    session_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        nullable=True
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

    # Multi-state support (from recordings)
    activate_state_ids: Mapped[list | None] = mapped_column(JSON, nullable=True, server_default="[]")
    deactivate_state_ids: Mapped[list | None] = mapped_column(JSON, nullable=True, server_default="[]")
    stays_visible: Mapped[bool | None] = mapped_column(Boolean, nullable=True, default=False)

    # Input event that triggered this transition (from automation sessions)
    trigger_event_id: Mapped[int | None] = mapped_column(
        BigInteger,
        ForeignKey("automation_input_events.id", ondelete="SET NULL"),
        nullable=True,
        index=True
    )

    # Trigger interaction (from recordings)
    trigger_interaction_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("recording_interactions.id", ondelete="SET NULL"),
        nullable=True,
        index=True
    )

    # Event/trigger type (for quick filtering)
    event_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    trigger_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    trigger_description: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Confidence scores
    confidence: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    clarity_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    consistency_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    completeness_score: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Timing
    timestamp: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    latency_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    recommended_timeout_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    recommended_retry_count: Mapped[int | None] = mapped_column(Integer, nullable=True, default=3)

    # Generated workflow (from recordings)
    workflow: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    workflow_name: Mapped[str | None] = mapped_column(String, nullable=True)

    # Position on canvas (from recordings)
    position_x: Mapped[float | None] = mapped_column(Float, nullable=True)
    position_y: Mapped[float | None] = mapped_column(Float, nullable=True)

    # User review (from recordings)
    user_edited: Mapped[bool | None] = mapped_column(Boolean, nullable=True, default=False)
    user_approved: Mapped[bool | None] = mapped_column(Boolean, nullable=True, default=False)
    user_notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Conversion to actual transition (from recordings)
    converted_to_transition_id: Mapped[UUID | None] = mapped_column(PGUUID(as_uuid=True), nullable=True)
    converted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Additional transition metadata (JSONB)
    transition_metadata: Mapped[dict] = mapped_column(
        "metadata", JSON, default=dict, nullable=False, server_default="{}"
    )

    # Created timestamp
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow, nullable=False
    )

    # Relationships for BOTH sources
    automation_session: Mapped["AutomationSession | None"] = relationship(
        "AutomationSession",
        back_populates="state_transitions",
        foreign_keys=[automation_session_id]
    )
    recording: Mapped["Recording | None"] = relationship(
        "Recording",
        back_populates="state_transitions",
        foreign_keys=[recording_id]
    )
    from_state: Mapped["DiscoveredState | None"] = relationship(
        "DiscoveredState",
        foreign_keys=[from_state_id],
        back_populates="outgoing_transitions"
    )
    to_state: Mapped["DiscoveredState | None"] = relationship(
        "DiscoveredState",
        foreign_keys=[to_state_id],
        back_populates="incoming_transitions"
    )
    trigger_event: Mapped["AutomationInputEvent | None"] = relationship(
        "AutomationInputEvent",
        foreign_keys=[trigger_event_id]
    )
    trigger_interaction: Mapped["RecordingInteraction | None"] = relationship(
        "RecordingInteraction",
        foreign_keys=[trigger_interaction_id]
    )

    # Table constraints
    __table_args__ = (
        CheckConstraint(
            '(automation_session_id IS NOT NULL AND recording_id IS NULL AND source_type = \'automation_session\') OR '
            '(automation_session_id IS NULL AND recording_id IS NOT NULL AND source_type = \'recording\')',
            name='check_single_source'
        ),
    )

    def __repr__(self) -> str:
        return (
            f"<StateTransition(id={self.id}, "
            f"source_type='{self.source_type}', "
            f"from={self.from_state_id}, to={self.to_state_id})>"
        )
