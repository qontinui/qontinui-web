"""
UI Bridge State Models

Stores states discovered from UI Bridge render logs using co-occurrence analysis.
These are semantic states based on element presence, not visual/pixel-based states.
"""

from datetime import UTC, datetime
from typing import TYPE_CHECKING
from uuid import UUID

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    JSON,
    Boolean,
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
    from app.models.ui_bridge_transition import UIBridgeTransition


class UIBridgeExplorationSession(Base):
    """
    Persisted exploration session.

    Stores render logs and exploration results so they can be recovered
    after page reloads or browser crashes.
    """

    __tablename__ = "ui_bridge_exploration_sessions"

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

    # Session name (auto-generated or user-provided)
    name: Mapped[str] = mapped_column(String(255), nullable=False)

    # Exploration status: "running", "completed", "failed", "cancelled"
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="running")

    # Target configuration
    target_type: Mapped[str] = mapped_column(
        String(50), nullable=False, default="extension"
    )
    target_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)

    # Exploration configuration (max_depth, delays, filters, etc.)
    exploration_config: Mapped[dict] = mapped_column(
        JSON, default=dict, nullable=False, server_default="{}"
    )

    # Raw render logs (the primary data we want to persist)
    render_logs: Mapped[list] = mapped_column(
        JSON, default=list, nullable=False, server_default="[]"
    )

    # Exploration progress
    elements_discovered: Mapped[int] = mapped_column(Integer, default=0)
    elements_explored: Mapped[int] = mapped_column(Integer, default=0)
    render_count: Mapped[int] = mapped_column(Integer, default=0)

    # Error message if failed
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Whether discovery has been run on this session
    discovery_completed: Mapped[bool] = mapped_column(Boolean, default=False)

    # Link to saved config if discovery results were saved
    saved_config_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("ui_bridge_state_configs.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Timestamps
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False
    )
    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
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
    project: Mapped["Project"] = relationship(
        "Project", back_populates="exploration_sessions"
    )
    saved_config: Mapped["UIBridgeStateConfig | None"] = relationship(
        "UIBridgeStateConfig", foreign_keys=[saved_config_id]
    )

    def __repr__(self) -> str:
        """Return string representation."""
        return f"<UIBridgeExplorationSession(id={self.id}, status='{self.status}', render_count={self.render_count})>"


class UIBridgeStateConfig(Base):
    """
    Configuration for a UI Bridge state discovery session.

    Stores the discovered states and their descriptions for a project.
    Each project can have multiple discovery configurations (e.g., for different
    versions or branches of the application).
    """

    __tablename__ = "ui_bridge_state_configs"

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

    # Configuration name (e.g., "main", "v2.0", "feature-branch")
    name: Mapped[str] = mapped_column(String(255), nullable=False, default="default")

    # Description of this configuration
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Discovery extra_metadata
    render_count: Mapped[int] = mapped_column(default=0)
    element_count: Mapped[int] = mapped_column(default=0)

    # Include HTML IDs in element detection
    include_html_ids: Mapped[bool] = mapped_column(default=False)

    # Raw discovery result (for reference)
    discovery_result: Mapped[dict] = mapped_column(
        JSON, default=dict, nullable=False, server_default="{}"
    )

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
    project: Mapped["Project"] = relationship(
        "Project", back_populates="ui_bridge_configs"
    )
    states: Mapped[list["UIBridgeState"]] = relationship(
        "UIBridgeState",
        back_populates="config",
        cascade="all, delete-orphan",
        order_by="UIBridgeState.name",
    )
    transitions: Mapped[list["UIBridgeTransition"]] = relationship(
        "UIBridgeTransition",
        back_populates="config",
        cascade="all, delete-orphan",
        order_by="UIBridgeTransition.name",
    )

    def __repr__(self) -> str:
        """Return string representation."""
        return f"<UIBridgeStateConfig(id={self.id}, project_id={self.project_id}, name='{self.name}')>"


class UIBridgeState(Base):
    """
    A discovered UI Bridge state.

    Represents a group of UI elements that consistently appear together
    across multiple render snapshots.
    """

    __tablename__ = "ui_bridge_states"

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

    # State identifier from discovery (e.g., "state_000")
    state_id: Mapped[str] = mapped_column(String(100), nullable=False)

    # Human-readable name (can be edited by user)
    name: Mapped[str] = mapped_column(String(255), nullable=False)

    # User-provided description of what this state represents
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Element IDs that belong to this state (e.g., ["testid:nav", "ui:sidebar"])
    element_ids: Mapped[list] = mapped_column(
        JSON, default=list, nullable=False, server_default="[]"
    )

    # Render IDs where this state is active
    render_ids: Mapped[list] = mapped_column(
        JSON, default=list, nullable=False, server_default="[]"
    )

    # Confidence score from discovery algorithm
    confidence: Mapped[float] = mapped_column(Float, nullable=False, default=0.9)

    # Acceptance criteria for this state (what should be verified)
    acceptance_criteria: Mapped[list] = mapped_column(
        JSON, default=list, nullable=False, server_default="[]"
    )

    # Additional extra_metadata
    extra_metadata: Mapped[dict] = mapped_column(
        JSON, default=dict, nullable=False, server_default="{}"
    )

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
    config: Mapped["UIBridgeStateConfig"] = relationship(
        "UIBridgeStateConfig", back_populates="states"
    )
    domain_knowledge_refs: Mapped[list["UIBridgeStateDomainKnowledge"]] = relationship(
        "UIBridgeStateDomainKnowledge",
        back_populates="state",
        cascade="all, delete-orphan",
    )

    def __repr__(self) -> str:
        """Return string representation."""
        return f"<UIBridgeState(id={self.id}, state_id='{self.state_id}', name='{self.name}')>"


class DomainKnowledge(Base):
    """
    Domain knowledge entry.

    Reusable knowledge that can be referenced by multiple states.
    Explains concepts, terminology, or expected behavior.
    """

    __tablename__ = "domain_knowledge"

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )

    # Link to project (or null for global knowledge)
    project_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )

    # Title (e.g., "What is a State in Qontinui?")
    title: Mapped[str] = mapped_column(String(255), nullable=False)

    # Full content (markdown supported)
    content: Mapped[str] = mapped_column(Text, nullable=False)

    # Tags for categorization and search
    tags: Mapped[list] = mapped_column(
        JSON, default=list, nullable=False, server_default="[]"
    )

    # Embedding vector for semantic search (384-dim MiniLM-L6-v2)
    content_embedding = mapped_column(
        Vector(384),
        nullable=True,
        comment="384-dim MiniLM embedding of the knowledge content",
    )

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
    project: Mapped["Project | None"] = relationship(
        "Project", back_populates="domain_knowledge"
    )
    state_refs: Mapped[list["UIBridgeStateDomainKnowledge"]] = relationship(
        "UIBridgeStateDomainKnowledge",
        back_populates="knowledge",
        cascade="all, delete-orphan",
    )

    def __repr__(self) -> str:
        """Return string representation."""
        return f"<DomainKnowledge(id={self.id}, title='{self.title}')>"


class UIBridgeStateDomainKnowledge(Base):
    """Association table linking states to domain knowledge."""

    __tablename__ = "ui_bridge_state_domain_knowledge"

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )

    state_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("ui_bridge_states.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    knowledge_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("domain_knowledge.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Order for display
    order: Mapped[int] = mapped_column(default=0)

    # Relationships
    state: Mapped["UIBridgeState"] = relationship(
        "UIBridgeState", back_populates="domain_knowledge_refs"
    )
    knowledge: Mapped["DomainKnowledge"] = relationship(
        "DomainKnowledge", back_populates="state_refs"
    )

    def __repr__(self) -> str:
        """Return string representation."""
        return f"<UIBridgeStateDomainKnowledge(state_id={self.state_id}, knowledge_id={self.knowledge_id})>"
