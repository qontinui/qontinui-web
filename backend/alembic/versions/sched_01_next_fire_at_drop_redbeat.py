"""Move schedule state from RedBeat/Redis into Postgres.

Adds ``scheduled_workflow_runs.next_fire_at`` (indexed) — the in-process
scheduler polls ``enabled AND next_fire_at <= now()`` — and drops
``redbeat_entry_id``, which keyed a RedBeat entry in Redis that no longer
exists (no Celery worker/beat was ever deployed, so it never fired).

Backfill: every enabled row gets a next_fire_at of ``now()`` so the first
scheduler tick after deploy picks it up and re-anchors it on its cron. Rows
that are disabled stay NULL (the poll skips them).

Revision ID: sched_01_next_fire_at
Revises: coord_memory_synthesis_jobs
Create Date: 2026-07-12
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "sched_01_next_fire_at"
down_revision: str | None = "coord_memory_synthesis_jobs"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "scheduled_workflow_runs",
        sa.Column(
            "next_fire_at",
            sa.DateTime(timezone=True),
            nullable=True,
            comment=(
                "When this schedule next fires. Computed with croniter from "
                "cron_expression on create/update and advanced after each fire. "
                "NULL means never fires (disabled, or an uncomputable cron)."
            ),
        ),
    )
    op.create_index(
        "ix_scheduled_workflow_runs_next_fire_at",
        "scheduled_workflow_runs",
        ["next_fire_at"],
    )

    # Enabled rows become due immediately; the first tick fires them once and
    # re-anchors next_fire_at onto the cron. Disabled rows stay NULL.
    op.execute(
        "UPDATE scheduled_workflow_runs SET next_fire_at = now() WHERE enabled IS TRUE"
    )

    op.drop_column("scheduled_workflow_runs", "redbeat_entry_id")


def downgrade() -> None:
    op.add_column(
        "scheduled_workflow_runs",
        sa.Column("redbeat_entry_id", sa.String(length=255), nullable=True),
    )
    op.create_unique_constraint(
        "uq_scheduled_workflow_runs_redbeat_entry_id",
        "scheduled_workflow_runs",
        ["redbeat_entry_id"],
    )
    op.drop_index(
        "ix_scheduled_workflow_runs_next_fire_at",
        table_name="scheduled_workflow_runs",
    )
    op.drop_column("scheduled_workflow_runs", "next_fire_at")
