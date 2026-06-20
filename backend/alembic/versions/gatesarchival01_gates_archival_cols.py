"""coord.gates — archival columns (gate-reaper Tier 1)

Revision ID: gatesarchival01
Revises: step5drain_01_merge_escalations
Create Date: 2026-06-19

Adds four nullable archival/lifecycle columns + one partial "live gates" index
to ``coord.gates`` for plan ``2026-06-19-autonomous-gate-reduction`` (the coord
gate-reaper). When the reaper archives a stale/superseded gate it stamps
``archived_at`` and records why (``reaped_reason``) and who/what did it
(``reaped_by``); the row is retained for audit rather than deleted. The Tier-3
``expires_at`` deadline lets a registration carry a hard expiry the orphan
reconciler enforces.

- ``archived_at TIMESTAMPTZ NULL`` — when the gate was archived (NULL ⇒ live).
  The sweep's hot read path filters ``archived_at IS NULL``.
- ``reaped_reason TEXT NULL`` — free-text/structured reason the reaper archived
  the gate (e.g. ``superseded``, ``stale``, ``plan_landed``).
- ``reaped_by TEXT NULL`` — identity of the actor that archived the gate
  (reaper job id / session / operator).
- ``expires_at TIMESTAMPTZ NULL`` — optional Tier-3 hard deadline. When set and
  in the past, the orphan reconciler fails the gate deterministically regardless
  of predicate kind. NULL (the default at every existing call site) ⇒ no expiry.

A partial index ``idx_gates_live`` over ``(tenant_id) WHERE archived_at IS
NULL`` keeps the hot per-tenant live-gates scan fast as the archived tail
grows. The predicate references only the immutable ``archived_at IS NULL``
constant comparison, so there is no IMMUTABLE-predicate hazard.

## House conventions followed

Raw ``op.execute`` (not ``op.add_column``) with ``ADD COLUMN IF NOT EXISTS`` /
``CREATE INDEX IF NOT EXISTS`` so the migration is collision-safe against any
canonical PG that might already carry the columns from a self-heal mirror —
same convention as ``coord_gates_observation_cols`` and
``coord_singleauthored_01_gates``.

Touches **only** ``coord.gates`` (an ALTER of an existing table, created
earlier in this same linear chain). It is NOT added to any
``ALEMBIC_OWNED_TABLES`` list — the table already exists; this revision only
ALTERs it.

NOTE: both ``revision`` and ``down_revision`` are RESERVED via a coord
migration-queue head-claim (reservation 690f1467-..., position 4 behind the
in-flight ``step5drain_01_merge_escalations``) — do NOT re-derive
``down_revision`` from a local ``alembic heads``. Rechained 2026-06-20 from the
buried ``coord_findings`` (which had since acquired merged children) onto the
live-queue tail to clear a predicted head-fork.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "gatesarchival01"
down_revision: str | Sequence[str] | None = "step5drain_01_merge_escalations"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE coord.gates
            ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ
        """
    )
    op.execute(
        """
        ALTER TABLE coord.gates
            ADD COLUMN IF NOT EXISTS reaped_reason TEXT
        """
    )
    op.execute(
        """
        ALTER TABLE coord.gates
            ADD COLUMN IF NOT EXISTS reaped_by TEXT
        """
    )
    op.execute(
        """
        ALTER TABLE coord.gates
            ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_gates_live
            ON coord.gates (tenant_id)
            WHERE archived_at IS NULL
        """
    )


def downgrade() -> None:
    op.execute("ALTER TABLE coord.gates DROP COLUMN IF EXISTS expires_at")
    op.execute("DROP INDEX IF EXISTS coord.idx_gates_live")
    op.execute("ALTER TABLE coord.gates DROP COLUMN IF EXISTS reaped_by")
    op.execute("ALTER TABLE coord.gates DROP COLUMN IF EXISTS reaped_reason")
    op.execute("ALTER TABLE coord.gates DROP COLUMN IF EXISTS archived_at")
