"""Phase result model for runner-emitted workflow phase completions.

Mirrors the runner-side :class:`PhaseResult` struct in
``qontinui-runner/src-tauri/src/unified_workflow_executor/types.rs``.

Each row records the outcome of a single workflow phase (``setup``,
``verification``, ``agentic``, or ``completion``) as emitted by a server-mode
runner. Phase results are ingested by a runner-authenticated endpoint and
surfaced to the web UI for the run-timeline / phase-history views.

Duplicates are not deduplicated at the storage layer: re-ingesting the same
payload creates a second row. The runner is the single source of truth for
when a phase has completed; repeated deliveries indicate a retry and are worth
preserving.
"""

from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class PhaseResult(Base):
    """A single phase-completion record emitted by a server-mode runner."""

    __tablename__ = "phase_results"

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
        server_default=text("gen_random_uuid()"),
    )

    runner_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("auth.runners.id", ondelete="SET NULL"),
        nullable=True,
        comment="Runner fleet id that produced this phase result (nullable so "
        "history is preserved after a runner is deregistered).",
    )

    execution_id: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        index=True,
        comment="Runner-generated execution identifier the phase belongs to.",
    )

    phase: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
        comment="'setup' | 'verification' | 'agentic' | 'completion'",
    )

    iteration: Mapped[int | None] = mapped_column(
        Integer,
        nullable=True,
        comment="Iteration number (NULL for setup/completion).",
    )

    stage_index: Mapped[int | None] = mapped_column(
        Integer,
        nullable=True,
        comment="Stage index for multi-stage workflows (NULL = single-stage).",
    )

    success: Mapped[bool] = mapped_column(Boolean, nullable=False)
    all_passed: Mapped[bool] = mapped_column(Boolean, nullable=False)

    duration_ms: Mapped[int] = mapped_column(
        BigInteger,
        nullable=False,
        comment="Phase duration in milliseconds.",
    )

    failure_context: Mapped[str | None] = mapped_column(Text, nullable=True)

    commit_hash: Mapped[str | None] = mapped_column(
        String(64),
        nullable=True,
        comment="Git commit hash at end of phase (compensation correlation).",
    )

    step_results: Mapped[list] = mapped_column(
        JSONB,
        nullable=False,
        server_default=text("'[]'::jsonb"),
        comment="Per-step results (list of StepResultRecord JSON objects).",
    )

    variables_set: Mapped[dict | None] = mapped_column(
        JSONB,
        nullable=True,
        comment="Variables set during this phase (NULL = not captured).",
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    __table_args__ = (
        Index(
            "ix_phase_results_execution_id_created_at",
            "execution_id",
            "created_at",
        ),
        Index(
            "ix_phase_results_runner_id_created_at",
            "runner_id",
            "created_at",
        ),
        {"schema": "project"},
    )

    def __repr__(self) -> str:  # pragma: no cover - debug repr only
        return (
            f"<PhaseResult(id={self.id}, execution_id={self.execution_id!r}, "
            f"phase={self.phase!r}, success={self.success})>"
        )
