"""
Unified Workflow model for storing workflow definitions.

Workflows define automation sequences with four phases:
  Setup (once) -> [Verification <-> Agentic]* -> Completion (once)

Migrated from runner's SQLite-based unified_workflows table to become the
source of truth in PostgreSQL. The runner maintains a local cache for offline
execution.
"""

from datetime import UTC, datetime
from uuid import UUID, uuid4

from app.db.base import Base
from sqlalchemy import Boolean, DateTime, Integer, String, Text, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column


class UnifiedWorkflow(Base):
    """
    Unified Workflow definition.

    Stores the full workflow configuration including all four phases of steps,
    execution settings, and context configuration. Step data is stored as
    opaque JSONB — the runner validates step structure at execution time.
    """

    __tablename__ = "unified_workflows"

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
        server_default=text("gen_random_uuid()"),
    )

    created_by_user_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        nullable=True,
        index=True,
    )

    project_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        nullable=True,
        index=True,
    )

    # Workflow identity
    name: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
    )

    description: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        server_default=text("''"),
        default="",
    )

    category: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
        server_default=text("'general'"),
        default="general",
        index=True,
    )

    tags: Mapped[list] = mapped_column(
        JSONB,
        nullable=False,
        server_default=text("'[]'::jsonb"),
        default=list,
    )

    # Workflow steps — stored as opaque JSONB arrays
    setup_steps: Mapped[list] = mapped_column(
        JSONB,
        nullable=False,
        server_default=text("'[]'::jsonb"),
        default=list,
    )

    verification_steps: Mapped[list] = mapped_column(
        JSONB,
        nullable=False,
        server_default=text("'[]'::jsonb"),
        default=list,
    )

    agentic_steps: Mapped[list] = mapped_column(
        JSONB,
        nullable=False,
        server_default=text("'[]'::jsonb"),
        default=list,
    )

    completion_steps: Mapped[list] = mapped_column(
        JSONB,
        nullable=False,
        server_default=text("'[]'::jsonb"),
        default=list,
    )

    # Execution settings
    max_iterations: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        server_default=text("10"),
        default=10,
    )

    timeout_seconds: Mapped[int | None] = mapped_column(
        Integer,
        nullable=True,
    )

    provider: Mapped[str | None] = mapped_column(
        String(100),
        nullable=True,
    )

    model: Mapped[str | None] = mapped_column(
        String(100),
        nullable=True,
    )

    skip_ai_summary: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        server_default=text("false"),
        default=False,
    )

    # Log and health check settings
    log_watch_enabled: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        server_default=text("true"),
        default=True,
    )

    health_check_enabled: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        server_default=text("true"),
        default=True,
    )

    health_check_urls: Mapped[list] = mapped_column(
        JSONB,
        nullable=False,
        server_default=text("'[]'::jsonb"),
        default=list,
    )

    preflight_check_enabled: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        server_default=text("true"),
        default=True,
    )

    log_source_selection: Mapped[dict | str] = mapped_column(
        JSONB,
        nullable=False,
        server_default=text("'\"default\"'::jsonb"),
        default="default",
    )

    # Context settings
    context_ids: Mapped[list] = mapped_column(
        JSONB,
        nullable=False,
        server_default=text("'[]'::jsonb"),
        default=list,
    )

    disabled_context_ids: Mapped[list] = mapped_column(
        JSONB,
        nullable=False,
        server_default=text("'[]'::jsonb"),
        default=list,
    )

    auto_include_contexts: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        server_default=text("true"),
        default=True,
    )

    prompt_template: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    # Completion sweep configuration
    enable_sweep: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        server_default=text("false"),
        default=False,
    )

    max_sweep_iterations: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        server_default=text("5"),
        default=5,
    )

    # Multi-stage workflow configuration
    stages: Mapped[list | None] = mapped_column(
        JSONB,
        nullable=True,
        default=None,
        comment="JSON array of WorkflowStage objects for multi-stage execution",
    )

    stop_on_failure: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        server_default=text("false"),
        default=False,
        comment="Whether to stop execution if a stage fails verification",
    )

    approval_gate: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        server_default=text("false"),
        default=False,
        comment="Whether to pause for human approval before agentic phase",
    )

    reflection_mode: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        server_default=text("true"),
        default=True,
        comment="Whether to enable reflection mode during AI iterations",
    )

    constraint_overrides: Mapped[dict | None] = mapped_column(
        JSONB,
        nullable=True,
        default=None,
        comment="Per-constraint enable/disable overrides keyed by constraint ID",
    )

    model_overrides: Mapped[dict | None] = mapped_column(
        JSONB,
        nullable=True,
        default=None,
        comment="Per-phase model/provider overrides keyed by phase name",
    )

    # Provenance
    generated_by_task_run_id: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
        comment="Task run ID that generated this workflow (e.g. error-fix generator)",
    )

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(UTC),
        server_default=text("now()"),
    )

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(UTC),
        server_default=text("now()"),
        onupdate=lambda: datetime.now(UTC),
    )
