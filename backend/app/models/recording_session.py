"""
Recording Session Model

Stores completed recording sessions as experience memory for retrieval.
When recording a similar app/URL, past sessions can be retrieved to
pre-seed the state machine with previously discovered states.
"""

from datetime import UTC, datetime
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import (
    JSON,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    text,
)
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.project import Project
    from app.models.ui_bridge_state import UIBridgeStateConfig


class RecordingSession(Base):
    """
    A completed recording session with its discovered state machine.

    Stores session metadata, the raw CooccurrenceExport, discovered results,
    and a reference to the persisted state config. Used for experience
    retrieval — when recording a similar app, past sessions inform the
    state machine with known states and transitions.
    """

    __tablename__ = "recording_sessions"

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )

    # Link to project
    project_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Session identification
    session_id: Mapped[str] = mapped_column(
        String(100), nullable=False, comment="SDK session ID from RecordingSessionManager"
    )

    # Application context (for experience retrieval)
    app_name: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    app_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    app_domain: Mapped[str | None] = mapped_column(
        String(255), nullable=True, index=True,
        comment="Extracted domain for similarity matching"
    )

    # Recording metadata
    duration_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    interaction_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    capture_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Discovery results summary
    state_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    transition_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    variable_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Confidence summary (average across all discovered transitions)
    avg_confidence: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)

    # Raw export data (for re-processing or incremental merge)
    export_data: Mapped[dict] = mapped_column(
        JSON, default=dict, nullable=False, server_default="{}",
        comment="Full CooccurrenceExport JSON from the SDK"
    )

    # Extracted variables
    variables: Mapped[list] = mapped_column(
        JSON, default=list, nullable=False, server_default="[]",
        comment="VariableCandidate list from recording"
    )

    # Generated playbook content (if generated)
    playbook_content: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Link to persisted state config (if saved)
    state_config_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("ui_bridge_state_configs.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Timestamps
    recorded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False
    )

    # Relationships
    project: Mapped["Project"] = relationship("Project")
    state_config: Mapped["UIBridgeStateConfig | None"] = relationship(
        "UIBridgeStateConfig", foreign_keys=[state_config_id]
    )

    def __repr__(self) -> str:
        return (
            f"<RecordingSession(id={self.id}, session_id='{self.session_id}', "
            f"app='{self.app_name}', states={self.state_count}, transitions={self.transition_count})>"
        )
