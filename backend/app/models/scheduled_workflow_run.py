"""Scheduled workflow run model — Phase 3D.

One row per user-configured cron-driven workflow dispatch. The row is the
**sole** source of truth for ownership, cron expression, dispatch target, AND
*when the schedule next fires* — ``next_fire_at`` is a plain indexed column.

The in-process scheduler (:mod:`app.core.scheduler`) polls due rows every 30s
(``WHERE enabled AND next_fire_at <= now()``, ``FOR UPDATE SKIP LOCKED``) and
runs :func:`app.jobs.scheduled_dispatch.poll_and_dispatch_due`.

This replaced RedBeat, which kept schedule state in Redis. Schedule state is now
durable in Postgres: it survives a Redis flush, and it is inspectable in SQL.
Deleting the row removes the schedule; disabling it (``enabled=False``) keeps the
row and its ``last_*`` history, so re-enabling restores the same schedule.
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
        ForeignKey("auth.users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    workflow_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("project.unified_workflows.id", ondelete="CASCADE"),
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

    next_fire_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        index=True,
        comment=(
            "When this schedule next fires. Computed with croniter from "
            "cron_expression on create/update and advanced after each fire. "
            "The scheduler polls `enabled AND next_fire_at <= now()`. NULL "
            "means never fires (disabled, or an uncomputable cron)."
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
        {"schema": "project"},
    )

    def __repr__(self) -> str:  # pragma: no cover - debug repr only
        return (
            f"<ScheduledWorkflowRun(id={self.id}, name={self.name!r}, "
            f"cron={self.cron_expression!r}, enabled={self.enabled})>"
        )
