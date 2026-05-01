"""
Unified State Discovery Result Model

Stores the output of state discovery regardless of the source method
(Playwright extraction, UI Bridge exploration, video recording, etc.).

This is the unified state machine format for model-based GUI automation:
- Images: Screenshots with bounding boxes and pixel data
- States: Collections of images that appear together
- Transitions: Actions that change the active set of states
"""

from datetime import UTC, datetime
from enum import StrEnum
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, Text, text
from sqlalchemy.dialects.postgresql import JSON
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.project import Project


class DiscoverySourceType(StrEnum):
    """Source type for state discovery."""

    PLAYWRIGHT = "playwright"  # Web extraction via Playwright
    UI_BRIDGE = "ui_bridge"  # DOM exploration via UI Bridge
    RECORDING = "recording"  # Video recording analysis
    VISION = "vision"  # Pure vision-based extraction
    MANUAL = "manual"  # Manually defined states


class StateDiscoveryResult(Base):
    """
    Unified state discovery result.

    Stores the output state machine from any discovery method.
    The state machine consists of:
    - Images: Visual elements with bounding boxes on screenshots
    - States: Groups of images that co-occur across renders/screenshots
    - Transitions: Actions that change which states are active
    """

    __tablename__ = "state_discovery_results"
    __table_args__ = {'schema': "project"}

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )

    # Link to project
    project_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("project.projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Human-readable name for this discovery result
    name: Mapped[str] = mapped_column(String(255), nullable=False)

    # Optional description
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Source tracking - what method produced this result
    source_type: Mapped[str] = mapped_column(String(50), nullable=False, index=True)

    # Reference to the source session (polymorphic - could be any session type)
    # This is stored as string to allow referencing different tables
    source_session_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True), nullable=True, index=True
    )

    # Strategy used for discovery (e.g., "legacy", "fingerprint", "vision")
    discovery_strategy: Mapped[str | None] = mapped_column(String(100), nullable=True)

    # ==========================================================================
    # State Machine Data (the unified output)
    # ==========================================================================

    # Images: Visual elements with bounding boxes
    # Format: [{
    #   "id": "img_001",
    #   "screenshot_id": "...",
    #   "bbox": {"x": 0, "y": 0, "width": 100, "height": 50},
    #   "pixel_hash": "abc123...",
    #   "state_id": "state_001",
    #   "element_type": "button",
    #   "label": "Submit",
    #   "confidence": 0.95
    # }]
    images: Mapped[list] = mapped_column(
        JSON, default=list, nullable=False, server_default="[]"
    )

    # States: Collections of images that appear together
    # Format: [{
    #   "id": "state_001",
    #   "name": "Login Form",
    #   "image_ids": ["img_001", "img_002"],
    #   "render_ids": ["render_1", "render_2"],  # Where this state appears
    #   "confidence": 0.92,
    #   "description": "User login form with email and password fields"
    # }]
    states: Mapped[list] = mapped_column(
        JSON, default=list, nullable=False, server_default="[]"
    )

    # Transitions: Actions that change the active states
    # Format: [{
    #   "id": "trans_001",
    #   "from_state_id": "state_001",
    #   "to_state_id": "state_002",
    #   "trigger": {
    #     "type": "click",
    #     "image_id": "img_003",
    #     "element_id": "submit-button"
    #   },
    #   "confidence": 0.88
    # }]
    transitions: Mapped[list] = mapped_column(
        JSON, default=list, nullable=False, server_default="[]"
    )

    # Element to renders mapping (for co-occurrence analysis reference)
    # Format: {"element_id": ["render_1", "render_2", ...]}
    element_to_renders: Mapped[dict] = mapped_column(
        JSON, default=dict, nullable=False, server_default="{}"
    )

    # ==========================================================================
    # Statistics and Metadata
    # ==========================================================================

    # Counts for quick access
    image_count: Mapped[int] = mapped_column(Integer, default=0)
    state_count: Mapped[int] = mapped_column(Integer, default=0)
    transition_count: Mapped[int] = mapped_column(Integer, default=0)
    render_count: Mapped[int] = mapped_column(Integer, default=0)
    unique_element_count: Mapped[int] = mapped_column(Integer, default=0)

    # Overall confidence score
    confidence: Mapped[float] = mapped_column(Float, default=0.0)

    # Additional metadata from discovery process
    discovery_metadata: Mapped[dict] = mapped_column(
        JSON, default=dict, nullable=False, server_default="{}"
    )

    # ==========================================================================
    # Timestamps
    # ==========================================================================

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
        nullable=False,
    )

    # ==========================================================================
    # Relationships
    # ==========================================================================

    project: Mapped["Project"] = relationship(
        "Project", back_populates="state_discovery_results"
    )

    def __repr__(self) -> str:
        return (
            f"<StateDiscoveryResult(id={self.id}, name='{self.name}', "
            f"source={self.source_type}, states={self.state_count})>"
        )
