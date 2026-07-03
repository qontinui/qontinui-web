"""coord.condition_groups + coord.conditions + coord.condition_runs

Revision ID: coord_conditions_01_condition_groups
Revises: devenv_03_coord_device_bridge
Create Date: 2026-07-02

Phase 1 (substrate) of the "conditions regression tests" plan
(slug ``floofy-stargazing-pebble``).

Adds the three tables backing natural-language "conditions" regression
tests. A *condition group* is one test — a named bundle of natural-language
statements the AI agent checks against a target app via the UI Bridge. Each
*condition* is one such statement (ordered within its group). Each
*condition run* is one append-only execution record of a group (manual or
scheduled), carrying the per-condition verdicts.

## Access paths

* ``condition_groups``: tenant-scoped listing (``idx_condition_groups_tenant``)
  and the scheduler's "due groups" query — a partial index over
  ``(enabled, next_run_at)`` restricted to scheduled groups
  (``schedule_interval_secs IS NOT NULL``).
* ``conditions``: tenant listing + per-group fetch (ordered by ``position``).
* ``condition_runs``: tenant listing, per-group lookup, and per-group history
  ordered newest-first (``idx_condition_runs_group_started``).

alembic is the sole author of this schema. Rust (coord) only DMLs against
these tables; this web migration MUST be applied to prod RDS BEFORE the coord
image that reads/writes them deploys (same deploy-order rule as the rest of
the ``coord`` schema).

## House conventions followed

``op.create_table(..., schema="coord")`` with ``postgresql.UUID`` / JSONB /
``sa.TIMESTAMP(timezone=True)`` and ``sa.text("now()")`` server defaults —
same idiom as ``coord_hooks_01_hook_invocations``. Each ``upgrade`` body is
guarded by a ``has_table`` check so a partial/self-heal apply is a no-op,
matching the collision-safe convention across the ``coord.*`` migrations.
The ``coord`` schema is assumed to exist (it does — other coord tables live
there); we defensively ``CREATE SCHEMA IF NOT EXISTS coord`` as the sibling
migrations do.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
# down_revision = the current single alembic head at authoring time
# (``alembic heads`` confirmed it sole). coord's land-time down_revision
# re-point is authoritative and will correct this if the head drifts before
# land.
revision: str = "coord_conditions_01_condition_groups"
down_revision: str | Sequence[str] | None = "coord_test_targets"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create the three condition tables + their indexes. Idempotent."""
    op.execute("CREATE SCHEMA IF NOT EXISTS coord")

    bind = op.get_bind()
    insp = sa.inspect(bind)

    # condition_groups — one row = one test (a bundle of conditions).
    if not insp.has_table("condition_groups", schema="coord"):
        op.create_table(
            "condition_groups",
            sa.Column(
                "group_id",
                postgresql.UUID(as_uuid=True),
                nullable=False,
            ),
            sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("name", sa.Text(), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("target_url", sa.Text(), nullable=False),
            sa.Column("auth_setup", postgresql.JSONB(), nullable=True),
            sa.Column("schedule_interval_secs", sa.Integer(), nullable=True),
            sa.Column(
                "next_run_at", sa.TIMESTAMP(timezone=True), nullable=True
            ),
            sa.Column(
                "last_run_at", sa.TIMESTAMP(timezone=True), nullable=True
            ),
            sa.Column("last_status", sa.Text(), nullable=True),
            sa.Column(
                "enabled",
                sa.Boolean(),
                nullable=False,
                server_default=sa.text("true"),
            ),
            sa.Column(
                "created_at",
                sa.TIMESTAMP(timezone=True),
                nullable=False,
                server_default=sa.text("now()"),
            ),
            sa.Column(
                "updated_at",
                sa.TIMESTAMP(timezone=True),
                nullable=False,
                server_default=sa.text("now()"),
            ),
            sa.PrimaryKeyConstraint("group_id"),
            schema="coord",
        )
        op.create_index(
            "idx_condition_groups_tenant",
            "condition_groups",
            ["tenant_id"],
            schema="coord",
        )
        # Scheduler's "due groups" hot path — only scheduled groups.
        op.create_index(
            "idx_condition_groups_due",
            "condition_groups",
            ["enabled", "next_run_at"],
            schema="coord",
            postgresql_where=sa.text("schedule_interval_secs IS NOT NULL"),
        )

    # conditions — individual natural-language statements within a group.
    if not insp.has_table("conditions", schema="coord"):
        op.create_table(
            "conditions",
            sa.Column(
                "condition_id",
                postgresql.UUID(as_uuid=True),
                nullable=False,
            ),
            sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column(
                "group_id",
                postgresql.UUID(as_uuid=True),
                nullable=False,
            ),
            sa.Column("text", sa.Text(), nullable=False),
            sa.Column(
                "position",
                sa.Integer(),
                nullable=False,
                server_default=sa.text("0"),
            ),
            sa.Column(
                "enabled",
                sa.Boolean(),
                nullable=False,
                server_default=sa.text("true"),
            ),
            sa.Column(
                "created_at",
                sa.TIMESTAMP(timezone=True),
                nullable=False,
                server_default=sa.text("now()"),
            ),
            sa.Column(
                "updated_at",
                sa.TIMESTAMP(timezone=True),
                nullable=False,
                server_default=sa.text("now()"),
            ),
            sa.PrimaryKeyConstraint("condition_id"),
            sa.ForeignKeyConstraint(
                ["group_id"],
                ["coord.condition_groups.group_id"],
                ondelete="CASCADE",
            ),
            schema="coord",
        )
        op.create_index(
            "idx_conditions_tenant",
            "conditions",
            ["tenant_id"],
            schema="coord",
        )
        op.create_index(
            "idx_conditions_group",
            "conditions",
            ["group_id"],
            schema="coord",
        )

    # condition_runs — append-only run history (one row per group execution).
    if not insp.has_table("condition_runs", schema="coord"):
        op.create_table(
            "condition_runs",
            sa.Column(
                "run_id",
                postgresql.UUID(as_uuid=True),
                nullable=False,
            ),
            sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column(
                "group_id",
                postgresql.UUID(as_uuid=True),
                nullable=False,
            ),
            sa.Column(
                "started_at",
                sa.TIMESTAMP(timezone=True),
                nullable=False,
                server_default=sa.text("now()"),
            ),
            sa.Column(
                "finished_at", sa.TIMESTAMP(timezone=True), nullable=True
            ),
            sa.Column("status", sa.Text(), nullable=False),
            sa.Column("trigger", sa.Text(), nullable=False),
            sa.Column("device_id", postgresql.UUID(as_uuid=True), nullable=True),
            sa.Column("agent_id", postgresql.UUID(as_uuid=True), nullable=True),
            sa.Column("results", postgresql.JSONB(), nullable=True),
            sa.Column("summary", sa.Text(), nullable=True),
            # Per-run capability secret embedded in the spawned agent's prompt.
            # The PUBLIC report endpoint authenticates the verdict POST by
            # matching (run_id, report_token) — the condition-check agent has no
            # device JWT. Cleared (single-shot) once the run is reported.
            sa.Column("report_token", sa.Text(), nullable=True),
            sa.PrimaryKeyConstraint("run_id"),
            sa.ForeignKeyConstraint(
                ["group_id"],
                ["coord.condition_groups.group_id"],
                ondelete="CASCADE",
            ),
            schema="coord",
        )
        op.create_index(
            "idx_condition_runs_tenant",
            "condition_runs",
            ["tenant_id"],
            schema="coord",
        )
        op.create_index(
            "idx_condition_runs_group",
            "condition_runs",
            ["group_id"],
            schema="coord",
        )
        # Per-group history, newest first.
        op.create_index(
            "idx_condition_runs_group_started",
            "condition_runs",
            ["group_id", sa.text("started_at DESC")],
            schema="coord",
        )


def downgrade() -> None:
    """Reverse: drop in reverse dependency order (runs, conditions, groups)."""
    op.execute("DROP INDEX IF EXISTS coord.idx_condition_runs_group_started")
    op.execute("DROP INDEX IF EXISTS coord.idx_condition_runs_group")
    op.execute("DROP INDEX IF EXISTS coord.idx_condition_runs_tenant")
    op.execute("DROP TABLE IF EXISTS coord.condition_runs")

    op.execute("DROP INDEX IF EXISTS coord.idx_conditions_group")
    op.execute("DROP INDEX IF EXISTS coord.idx_conditions_tenant")
    op.execute("DROP TABLE IF EXISTS coord.conditions")

    op.execute("DROP INDEX IF EXISTS coord.idx_condition_groups_due")
    op.execute("DROP INDEX IF EXISTS coord.idx_condition_groups_tenant")
    op.execute("DROP TABLE IF EXISTS coord.condition_groups")
