"""consolidation phase2 v_15 runner_instances (CROSS-SCHEMA: coord, not project)

Revision ID: consolidation_phase2_v_15_runner_instances
Revises: consolidation_phase2_v_14_drop_default_fixes
Create Date: 2026-04-29

Phase 2, v15: create runner_instances table.

Source: ``mod.rs:727-747``.

DEVIATION FROM "EVERYTHING → PROJECT" DEFAULT:
The schema mapping in the plan places ``runner_instances`` in
``coord`` (cross-instance coordination state — which runner owns what,
which is online, multi-runner heartbeat). Phase 1 batch 14 created it
as ``coord.runner_instances``. To match Phase 1's canonical end-state
this port targets ``coord`` rather than ``project``. Failure to do so
would create a duplicate ``project.runner_instances`` on canonical DB.

On fresh canonical DB: NO-OP. ``CREATE TABLE IF NOT EXISTS`` is
idempotent against the Phase-1-created ``coord.runner_instances``.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "consolidation_phase2_v_15_runner_instances"
down_revision: str = "consolidation_phase2_v_14_drop_default_fixes"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Explicit schema-qualified DDL; no search_path manipulation.
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.runner_instances (
            id             TEXT PRIMARY KEY,
            name           TEXT NOT NULL,
            port           INTEGER NOT NULL UNIQUE,
            hostname       TEXT NOT NULL DEFAULT 'localhost',
            is_primary     BOOLEAN NOT NULL DEFAULT FALSE,
            pid            INTEGER,
            status         TEXT NOT NULL DEFAULT 'starting',
            last_heartbeat TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            started_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            running_tasks  INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_ri_port ON coord.runner_instances(port);
        CREATE INDEX IF NOT EXISTS idx_ri_status ON coord.runner_instances(status);
        CREATE INDEX IF NOT EXISTS idx_ri_heartbeat ON coord.runner_instances(last_heartbeat);
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS coord.runner_instances CASCADE")
