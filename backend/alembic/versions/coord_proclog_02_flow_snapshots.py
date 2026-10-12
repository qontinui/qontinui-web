"""coord.process_flow_snapshots — cached flow metrics and the DORA five

Revision ID: coord_proclog_02
Revises: coord_proclog_01
Create Date: 2026-10-12

Phase 1 of plan ``2026-10-11-process-twin-event-log-and-flow-metrics``. The
plan lands ALL of its DDL in this one web PR (one web -> coord deploy boundary
instead of four), so this table exists before Phase 6, the coord leader worker
that writes and prunes it. Applied in production before any coord read
(``[policy: alembic-sole-authorship]``).

Why a snapshot table
====================

Flow metrics (per-state dwell, WIP ageing, flow efficiency, Little's law, the
DORA five, development speed) are too heavy to compute at request time:
``coord_query_twin_fidelity`` timed out 4 of 4 times at coord's 30 s per-tool
cap doing exactly that, and the ``/digital-twin`` page's probe budget is 8 s
(plan D9). A leader worker computes; the read serves the latest persisted row
with ``staleness_seconds``, so every replica answers the same row and a stale
result is labelled rather than served as current.

``body`` is the whole computed result for one tenant and window. Its shape is
owned by coord's code, not by this schema, so a new metric needs no migration.
``(computed_at)`` is the age index the worker's prune uses.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_proclog_02"
down_revision: str | Sequence[str] | None = "coord_proclog_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create the snapshot table. Idempotent; no rows."""
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.process_flow_snapshots (
            tenant_id    UUID NOT NULL,
            computed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
            window_days  INTEGER NOT NULL,
            body         JSONB NOT NULL,
            PRIMARY KEY (tenant_id, computed_at)
        )
        """
    )
    op.execute(
        """
        ALTER TABLE coord.process_flow_snapshots
            DROP CONSTRAINT IF EXISTS ck_process_flow_snapshots_window_days
        """
    )
    op.execute(
        """
        ALTER TABLE coord.process_flow_snapshots
            ADD CONSTRAINT ck_process_flow_snapshots_window_days
            CHECK (window_days > 0)
        """
    )
    # The worker's age-based prune.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_process_flow_snapshots_computed_at
            ON coord.process_flow_snapshots (computed_at)
        """
    )


def downgrade() -> None:
    """Drop the snapshot table."""
    op.execute("DROP TABLE IF EXISTS coord.process_flow_snapshots")
