"""coord.consistent_snapshots (Layer 3 Phase 3.1 — cross-repo consistent HEAD snapshots)

Revision ID: coord_consistent_snapshots_01
Revises: coord_p4_02_reanchor_plan_gates
Create Date: 2026-07-03

Phase 3.1 of the Layer 3 consistent-snapshots plan.

Stands up ``coord.consistent_snapshots``: one row per reconcile tick recording
the tuple of every managed repo's main HEAD SHA together with whether that tuple
is *consistent* (all repos individually green at that instant). The "latest
consistent snapshot" is the durable fixed point downstream orchestration can pin
work against.

Schema:

* ``snapshot_id UUID PRIMARY KEY``    — synthetic id (``gen_random_uuid()``).
* ``computed_at TIMESTAMPTZ NOT NULL``— when this tick's tuple was computed.
* ``repo_shas JSONB NOT NULL``        — object mapping repo slug → main HEAD sha
  at ``computed_at``. JSONB so the managed-repo set can grow without a migration.
* ``consistent BOOLEAN NOT NULL``     — true iff every repo in ``repo_shas`` was
  individually green at this tick.
* ``reason TEXT``                     — human-readable why-consistent-or-not
  (nullable): the diagnostic string coord emits when marking the tuple.
* ``tenant_id UUID``                  — owning tenant (nullable), matching the
  tenant-scoping other coord tables use.

Indices:

* ``ix_consistent_snapshots_latest``  — ``(consistent, computed_at DESC)`` for
  the hot "latest consistent snapshot" lookup
  (``WHERE consistent = true ORDER BY computed_at DESC LIMIT 1``).
* ``ix_consistent_snapshots_tenant``  — partial on ``tenant_id`` for the
  tenant-scoped read, mirroring the sibling coord tables' tenant index.

Idempotency: ``CREATE TABLE IF NOT EXISTS`` + ``CREATE INDEX IF NOT EXISTS``,
matching the ``coord.primary_trees`` / ``coord.findings`` posture (alembic is
canonical; the coord Rust side may self-heal this table best-effort).

NOTE: ``down_revision`` was assigned by ``coord_migration_reserve`` on 2026-07-03
(reservation ``23db311c-a9d8-413c-ba03-495aaffeb689``, position 6 → chained off the
coord migration queue tail ``coord_p4_02_reanchor_plan_gates``, NOT the bare local
alembic head — the queue's fork prevention). Do NOT hand-edit the ``down_revision``
(memory ``feedback_migration_reservation_withdraw_cascade_repoint_hazard``).

Chains off ``coord_p4_02_reanchor_plan_gates``.
"""

from collections.abc import Sequence

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "coord_consistent_snapshots_01"
down_revision: str | Sequence[str] | None = "coord_p4_02_reanchor_plan_gates"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create ``coord.consistent_snapshots`` + indices. Idempotent."""
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.consistent_snapshots (
            snapshot_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            computed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
            repo_shas    JSONB NOT NULL,
            consistent   BOOLEAN NOT NULL,
            reason       TEXT,
            tenant_id    UUID
        )
        """
    )
    # Hot path: latest consistent snapshot lookup.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_consistent_snapshots_latest
            ON coord.consistent_snapshots (consistent, computed_at DESC)
        """
    )
    # Tenant-scoped read.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_consistent_snapshots_tenant
            ON coord.consistent_snapshots (tenant_id)
            WHERE tenant_id IS NOT NULL
        """
    )


def downgrade() -> None:
    """Drop ``coord.consistent_snapshots`` + indices."""
    op.execute("DROP INDEX IF EXISTS coord.ix_consistent_snapshots_tenant")
    op.execute("DROP INDEX IF EXISTS coord.ix_consistent_snapshots_latest")
    op.execute("DROP TABLE IF EXISTS coord.consistent_snapshots")
