"""fleet phase 1: machine budget + role declaration

Revision ID: fleet_phase_1_01_machine_budget
Revises: row_9_phase_4_01_coord_alerts
Create Date: 2026-05-14

Phase 1 of the fleet topology + per-machine build pool design
(``D:/qontinui-root/plans/2026-05-14-fleet-topology-and-build-pool-design.md``
§3.2). Adds the per-machine resource-budget columns to ``coord.machines``
so every Agent / Build / Cache / Coord node publishes a declared budget
on startup, and ``GET /coord/fleet`` can answer "where do I have
capacity for N more agents?" with structured data.

Rechained 2026-05-15 onto the then-current single head
``row_9_phase_4_01_coord_alerts``. The original branch authored this
revision as a sibling-head merge of ``p2q3r4s5t6u7`` (skills sharing)
and ``v8w9x0y1z2a3`` (datetime tz fix); both have since landed on main
as mid-chain ancestors of the single head, so the merge-node role is
obsolete and this is now a plain single-parent revision.

Columns added to ``coord.machines``:

* ``role`` — TEXT, NOT NULL DEFAULT 'agent'. Enum-style via CHECK
  constraint: ``agent`` / ``build`` / ``cache`` / ``coord``. Per §3.1
  every machine has a *declared* role; the coord routes work based on
  it. Dev workstations collapse all roles onto one host — last-writer
  wins for Phase 1 (visibility-only; Phase 5 adds enforcement).

* ``cpu_cores`` — INTEGER, nullable. Physical cores published by the
  process that booted on this machine (runner or supervisor). Nullable
  so a pre-budget row stays valid until the next startup heartbeat.

* ``memory_gb`` — INTEGER, nullable. Total RAM (GiB, rounded down).

* ``disk_total_gb`` — BIGINT, nullable. Total local disk where
  worktrees / build slots live (GiB).

* ``disk_reserved_gb`` — BIGINT, NOT NULL DEFAULT 0. Reserved for
  system + non-fleet workloads. Subtracted from ``disk_total_gb`` to
  derive available worktree budget.

* ``max_concurrent_agents`` — INTEGER, nullable. Derived per §3.2:
  ``floor((memory_gb - 4) / 4)`` for agent machines, 0 for build
  machines. The publisher computes and supplies this; coord uses the
  advertised value rather than re-deriving (lets each machine override
  via its own config).

* ``max_concurrent_builds`` — INTEGER, nullable. Derived per §3.2:
  ``min(floor(memory_gb / 4), floor(cpu_cores / 4))`` for build
  machines, 0 for agent machines.

* ``budget_updated_at`` — TIMESTAMPTZ, nullable. Stamped by the
  per-machine publisher each time the budget block is rewritten.
  Distinct from ``last_seen_at`` (which marks any heartbeat,
  including non-budget pings).

Indexes:

* ``idx_machines_role`` — supports ``GET /coord/fleet`` filtering by
  role and the future Phase-5 ``WHERE role = 'agent'`` cap
  enforcement.

Design notes:

* All new columns are added in a single ``ALTER TABLE`` (sqlalchemy
  batches them). Postgres rewrites the row metadata only, not the
  underlying heap, because every column is either nullable or has a
  literal-default — so this is O(catalog) regardless of row count.
* ``role`` defaults to 'agent' because today's dev workstations are
  runner-primary; the supervisor publisher overwrites to 'build' on
  Build-dedicated hardware (Phase 1 surface; Phase 6 cloud-burst
  consumes the same column).
* The CHECK constraint is added via raw ``op.execute`` rather than
  ``CheckConstraint`` so the message in violations is the canonical
  PG ``machines_role_chk`` name — matches the convention used by
  ``schema.pg.sql`` everywhere else.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "fleet_phase_1_01_machine_budget"
down_revision: str | Sequence[str] | None = "row_9_phase_4_01_coord_alerts"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "machines",
        sa.Column(
            "role",
            sa.Text(),
            nullable=False,
            server_default=sa.text("'agent'"),
        ),
        schema="coord",
    )
    op.add_column(
        "machines",
        sa.Column("cpu_cores", sa.Integer(), nullable=True),
        schema="coord",
    )
    op.add_column(
        "machines",
        sa.Column("memory_gb", sa.Integer(), nullable=True),
        schema="coord",
    )
    op.add_column(
        "machines",
        sa.Column("disk_total_gb", sa.BigInteger(), nullable=True),
        schema="coord",
    )
    op.add_column(
        "machines",
        sa.Column(
            "disk_reserved_gb",
            sa.BigInteger(),
            nullable=False,
            server_default=sa.text("0"),
        ),
        schema="coord",
    )
    op.add_column(
        "machines",
        sa.Column("max_concurrent_agents", sa.Integer(), nullable=True),
        schema="coord",
    )
    op.add_column(
        "machines",
        sa.Column("max_concurrent_builds", sa.Integer(), nullable=True),
        schema="coord",
    )
    op.add_column(
        "machines",
        sa.Column(
            "budget_updated_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
        schema="coord",
    )

    op.execute(
        "ALTER TABLE coord.machines "
        "ADD CONSTRAINT machines_role_chk "
        "CHECK (role IN ('agent', 'build', 'cache', 'coord'))"
    )

    op.create_index(
        "idx_machines_role",
        "machines",
        ["role"],
        schema="coord",
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS coord.idx_machines_role")
    op.execute(
        "ALTER TABLE coord.machines DROP CONSTRAINT IF EXISTS machines_role_chk"
    )
    op.drop_column("machines", "budget_updated_at", schema="coord")
    op.drop_column("machines", "max_concurrent_builds", schema="coord")
    op.drop_column("machines", "max_concurrent_agents", schema="coord")
    op.drop_column("machines", "disk_reserved_gb", schema="coord")
    op.drop_column("machines", "disk_total_gb", schema="coord")
    op.drop_column("machines", "memory_gb", schema="coord")
    op.drop_column("machines", "cpu_cores", schema="coord")
    op.drop_column("machines", "role", schema="coord")
