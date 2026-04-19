"""Scheduled workflow run model — Phase 3D.

One row per user-configured cron-driven workflow dispatch. The DB row is
the source of truth for ownership, cron expression, and dispatch target;
the corresponding redbeat entry (in Redis) is the runtime mechanism that
fires Celery's :func:`app.tasks.scheduled_dispatch.fire` at the configured
times. The two are kept in sync by :mod:`app.services.redbeat_manager`.

Deleting this row removes the redbeat entry. Disabling (enabled=False)
removes the redbeat entry but keeps the row, so re-enabling restores the
same schedule without losing history (``last_*`` columns).
"""

from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    String,
    Text,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class ScheduledWorkflowRun(Base):
    """A user-defined cron schedule that dispatches a workflow to a runner."""

    __tablename__ = "scheduled_workflow_runs"

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
        server_default=text("gen_random_uuid()"),
    )

    user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    workflow_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("unified_workflows.id", ondelete="CASCADE"),
        nullable=False,
    )

    name: Mapped[str] = mapped_column(String(255), nullable=False)

    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    cron_expression: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        comment="5-field cron expression, validated via croniter on write.",
    )

    target: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        comment=(
            "Either the literal string 'auto' or a stringified runner UUID — "
            "mirrors the WorkflowDispatchRequest.target shape."
        ),
    )

    enabled: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        server_default=text("true"),
    )

    last_fired_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    last_execution_id: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
        comment="Runner-returned execution_id from the most recent successful dispatch.",
    )

    last_status: Mapped[str | None] = mapped_column(
        String(32),
        nullable=True,
        comment="'dispatched' | 'failed' — outcome of the most recent fire.",
    )

    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)

    redbeat_entry_id: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
        unique=True,
        comment=(
            "Redbeat scheduler key for this row, conventionally "
            "'qontinui:schedule:{id}'. Present when a redbeat entry exists "
            "in Redis; cleared when the entry is removed (disable/delete)."
        ),
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    __table_args__ = (
        Index(
            "ix_scheduled_workflow_runs_workflow_id",
            "workflow_id",
        ),
        Index(
            "ix_scheduled_workflow_runs_user_workflow",
            "user_id",
            "workflow_id",
        ),
    )

    def __repr__(self) -> str:  # pragma: no cover - debug repr only
        return (
            f"<ScheduledWorkflowRun(id={self.id}, name={self.name!r}, "
            f"cron={self.cron_expression!r}, enabled={self.enabled})>"
        )
