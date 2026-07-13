"""Move schedule state from RedBeat/Redis into Postgres.

Adds ``project.scheduled_workflow_runs.next_fire_at`` (indexed) — the in-process
scheduler polls ``enabled AND next_fire_at <= now()`` — and drops
``redbeat_entry_id``, which keyed a RedBeat entry in Redis that no longer exists
(no Celery worker/beat was ever deployed, so it never fired).

The table lives in the ``project`` schema (moved there by
``consolidation_phase7_03_move_workflow_tables``); every op below passes
``schema="project"`` explicitly, since alembic's env sets no default search_path.

**No backfill.** Existing rows keep ``next_fire_at = NULL``. A ``now()`` backfill
would make every enabled schedule due at once, and the first scheduler tick after
deploy would dispatch all of them off-cron — real GUI automation firing unattended
on users' desktops at deploy time. (RedBeat never actually fired, so the population
of enabled-but-never-run schedules is exactly what that would hit.) Instead the
scheduler *re-anchors* a NULL row onto its cron on first sight, without firing it:
see ``app.jobs.scheduled_dispatch._anchor_unscheduled_rows``.

Revision ID: sched_01_next_fire_at
Revises: coord_prompt_injection_events
Create Date: 2026-07-12
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "sched_01_next_fire_at"
down_revision: str | None = "coord_prompt_injection_events"
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
                "NULL means unscheduled — the scheduler re-anchors it onto its "
                "cron on first sight (it does not fire it)."
            ),
        ),
        schema="project",
    )
    op.create_index(
        "ix_scheduled_workflow_runs_next_fire_at",
        "scheduled_workflow_runs",
        ["next_fire_at"],
        schema="project",
    )
    op.drop_column(
        "scheduled_workflow_runs", "redbeat_entry_id", schema="project"
    )


def downgrade() -> None:
    op.add_column(
        "scheduled_workflow_runs",
        sa.Column("redbeat_entry_id", sa.String(length=255), nullable=True),
        schema="project",
    )
    op.create_unique_constraint(
        "uq_scheduled_workflow_runs_redbeat_entry_id",
        "scheduled_workflow_runs",
        ["redbeat_entry_id"],
        schema="project",
    )
    op.drop_index(
        "ix_scheduled_workflow_runs_next_fire_at",
        table_name="scheduled_workflow_runs",
        schema="project",
    )
    op.drop_column("scheduled_workflow_runs", "next_fire_at", schema="project")
