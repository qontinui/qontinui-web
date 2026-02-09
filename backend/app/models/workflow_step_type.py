"""
Workflow Step Type Configuration Models

Stores per-user configuration for:
- Step types (the kinds of steps available in workflow phases)
- GUI action types (sub-types for gui_action steps)
- Workflow phases (setup, verification, agentic, completion)

Built-in entries are seeded on first access; users can also create custom entries.
"""

from datetime import datetime
from uuid import UUID

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class StepTypeConfig(Base):
    """
    Per-user workflow step type configuration.

    Each row represents one step type available in a specific workflow phase.
    The same step type (e.g. "script") can appear in multiple phases with
    different labels/descriptions.
    """

    __tablename__ = "step_type_configs"

    id: Mapped[UUID] = mapped_column(
        primary_key=True, server_default=text("gen_random_uuid()")
    )
    user_id: Mapped[UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Step type identity
    step_type: Mapped[str] = mapped_column(String(50), nullable=False)
    phase: Mapped[str] = mapped_column(
        String(20), nullable=False
    )  # setup | verification | agentic | completion

    # Display metadata
    label: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    icon: Mapped[str] = mapped_column(String(50), nullable=False)
    color: Mapped[str] = mapped_column(String(30), nullable=False)

    # Control fields
    is_built_in: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()"), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=text("now()"),
        onupdate=datetime.utcnow,
        nullable=False,
    )

    __table_args__ = (
        UniqueConstraint(
            "user_id", "step_type", "phase", name="uq_step_type_user_type_phase"
        ),
    )

    def __repr__(self) -> str:
        """Return string representation of StepTypeConfig."""
        return f"<StepTypeConfig(id={self.id}, type='{self.step_type}', phase='{self.phase}', label='{self.label}')>"


class GuiActionTypeConfig(Base):
    """
    Per-user GUI action sub-type configuration.

    Defines the action types available for gui_action steps
    (click, double_click, right_click, type, hotkey, scroll).
    """

    __tablename__ = "gui_action_type_configs"

    id: Mapped[UUID] = mapped_column(
        primary_key=True, server_default=text("gen_random_uuid()")
    )
    user_id: Mapped[UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    action_type: Mapped[str] = mapped_column(String(50), nullable=False)
    label: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    icon: Mapped[str] = mapped_column(String(50), nullable=False)

    is_built_in: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()"), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=text("now()"),
        onupdate=datetime.utcnow,
        nullable=False,
    )

    __table_args__ = (
        UniqueConstraint("user_id", "action_type", name="uq_gui_action_type_user_type"),
    )

    def __repr__(self) -> str:
        """Return string representation of GuiActionTypeConfig."""
        return f"<GuiActionTypeConfig(id={self.id}, action='{self.action_type}', label='{self.label}')>"


class WorkflowPhaseConfig(Base):
    """
    Per-user workflow phase configuration.

    Defines the 4 execution phases: setup, verification, agentic, completion.
    """

    __tablename__ = "workflow_phase_configs"

    id: Mapped[UUID] = mapped_column(
        primary_key=True, server_default=text("gen_random_uuid()")
    )
    user_id: Mapped[UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    phase: Mapped[str] = mapped_column(String(20), nullable=False)
    label: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    color: Mapped[str] = mapped_column(String(30), nullable=False)

    is_built_in: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()"), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=text("now()"),
        onupdate=datetime.utcnow,
        nullable=False,
    )

    __table_args__ = (
        UniqueConstraint("user_id", "phase", name="uq_workflow_phase_user_phase"),
    )

    def __repr__(self) -> str:
        """Return string representation of WorkflowPhaseConfig."""
        return f"<WorkflowPhaseConfig(id={self.id}, phase='{self.phase}', label='{self.label}')>"
