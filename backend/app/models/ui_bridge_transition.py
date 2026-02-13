"""
UI Bridge Transition Model

Stores transitions between UI Bridge states. Transitions define how to navigate
from one set of active states to another, including the actions to execute.
"""

from datetime import datetime
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    String,
    text,
)
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.ui_bridge_state import UIBridgeStateConfig


class UIBridgeTransition(Base):
    """
    A transition between UI Bridge states.

    Defines how to move from one state configuration to another,
    including the actions to execute and the cost for pathfinding.
    """

    __tablename__ = "ui_bridge_transitions"

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )

    # Link to config
    config_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("ui_bridge_state_configs.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Transition identifier (user-defined or auto-generated)
    transition_id: Mapped[str] = mapped_column(String(100), nullable=False)

    # Human-readable name
    name: Mapped[str] = mapped_column(String(255), nullable=False)

    # State references (stored as JSON lists of state_id strings)
    from_states: Mapped[list] = mapped_column(
        JSON, default=list, nullable=False, server_default="[]"
    )
    activate_states: Mapped[list] = mapped_column(
        JSON, default=list, nullable=False, server_default="[]"
    )
    exit_states: Mapped[list] = mapped_column(
        JSON, default=list, nullable=False, server_default="[]"
    )

    # Actions to execute for this transition
    # Each action: {"type": "click"|"type"|"select"|"wait"|"navigate", "target": "element_id", ...}
    actions: Mapped[list] = mapped_column(
        JSON, default=list, nullable=False, server_default="[]"
    )

    # Path cost for pathfinding (lower = preferred)
    path_cost: Mapped[float] = mapped_column(Float, nullable=False, default=1.0)

    # Whether the triggering element stays visible after transition
    stays_visible: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    # Additional metadata
    extra_metadata: Mapped[dict] = mapped_column(
        JSON, default=dict, nullable=False, server_default="{}"
    )

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )

    # Relationships
    config: Mapped["UIBridgeStateConfig"] = relationship(
        "UIBridgeStateConfig", back_populates="transitions"
    )

    def __repr__(self) -> str:
        """Return string representation."""
        return f"<UIBridgeTransition(id={self.id}, transition_id='{self.transition_id}', name='{self.name}')>"
