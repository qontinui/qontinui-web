"""
Discovered State Model

Stores discovered application states from BOTH automation sessions and recordings.
Unified model that supports dual sources for state discovery.
"""

from datetime import datetime
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import CheckConstraint, DateTime, Float, ForeignKey, String, ARRAY, JSON, Text, Boolean, Integer
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.automation_session import AutomationSession
    from app.models.recording import Recording
    from app.models.state_transition import StateTransition


class DiscoveredState(Base):
    """
    Discovered application state from automated analysis.

    Represents a unique UI state identified through visual analysis and clustering.
    Supports discovery from BOTH automation sessions and recordings.
    Contains references to screenshots and extracted StateImages that define this state.
    """

    __tablename__ = "discovered_states"

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        server_default="gen_random_uuid()"
    )

    # Source type - identifies where this state was discovered from
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

    # Unique state identifier (e.g., "state_0", "state_1")
    state_id: Mapped[str | None] = mapped_column(String(100), nullable=True)

    # Human-readable name
    name: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Description (from recordings)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Cluster ID (from clustering algorithm)
    cluster_id: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Confidence score for this state discovery (0.0 to 1.0)
    confidence: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)

    # Additional confidence scores (from recordings)
    uniqueness_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    stability_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    distinctiveness_score: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Additional state metadata (JSONB)
    state_metadata: Mapped[dict] = mapped_column(
        "metadata", JSON, default=dict, nullable=False, server_default="{}"
    )

    # Screenshot IDs associated with this state (from automation sessions)
    screenshot_ids: Mapped[list[UUID] | None] = mapped_column(
        ARRAY(PGUUID(as_uuid=True)),
        nullable=True,
        server_default="{}"
    )

    # Frame IDs belonging to this state (from recordings)
    frame_ids: Mapped[list | None] = mapped_column(JSON, nullable=True, server_default="[]")
    frame_count: Mapped[int | None] = mapped_column(Integer, nullable=True, default=0)

    # StateImage objects extracted for this state
    # Format: [{"x": int, "y": int, "width": int, "height": int, "pixel_hash": str}]
    state_images: Mapped[list] = mapped_column(
        JSON, nullable=False, server_default="[]"
    )

    # Visual elements (from recordings)
    regions: Mapped[list | None] = mapped_column(JSON, nullable=True, server_default="[]")
    locations: Mapped[list | None] = mapped_column(JSON, nullable=True, server_default="[]")
    strings: Mapped[list | None] = mapped_column(JSON, nullable=True, server_default="[]")

    # Position on canvas (from recordings)
    position_x: Mapped[float | None] = mapped_column(Float, nullable=True)
    position_y: Mapped[float | None] = mapped_column(Float, nullable=True)

    # State properties (from recordings)
    is_initial: Mapped[bool | None] = mapped_column(Boolean, nullable=True, default=False)
    is_error_state: Mapped[bool | None] = mapped_column(Boolean, nullable=True, default=False)
    is_transient: Mapped[bool | None] = mapped_column(Boolean, nullable=True, default=False)

    # Context (from recordings)
    window_context: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    url_context: Mapped[str | None] = mapped_column(String, nullable=True)

    # User review (from recordings)
    user_edited: Mapped[bool | None] = mapped_column(Boolean, nullable=True, default=False)
    user_approved: Mapped[bool | None] = mapped_column(Boolean, nullable=True, default=False)
    user_notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Conversion to actual state (from recordings)
    converted_to_state_id: Mapped[UUID | None] = mapped_column(PGUUID(as_uuid=True), nullable=True)
    converted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

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

    # Relationships for BOTH sources
    automation_session: Mapped["AutomationSession | None"] = relationship(
        "AutomationSession",
        back_populates="discovered_states",
        foreign_keys=[automation_session_id]
    )
    recording: Mapped["Recording | None"] = relationship(
        "Recording",
        back_populates="discovered_states",
        foreign_keys=[recording_id]
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

    # Table constraints
    __table_args__ = (
        CheckConstraint(
            '(automation_session_id IS NOT NULL AND recording_id IS NULL AND source_type = \'automation_session\') OR '
            '(automation_session_id IS NULL AND recording_id IS NOT NULL AND source_type = \'recording\')',
            name='check_single_source'
        ),
    )

    def __repr__(self) -> str:
        source_id = self.automation_session_id if self.source_type == 'automation_session' else self.recording_id
        return f"<DiscoveredState(id={self.id}, source_type='{self.source_type}', source_id={source_id})>"
