"""coord.footprint_drift_events (Ξ_Worktree Phase 7.6 — declared-vs-actual footprint honesty oplog)

Revision ID: coord_footprint_drift_events
Revises: auto_fix_rm_flaky_01
Create Date: 2026-07-18

Phase 7.6 of ``2026-06-06-twin-worktree-phase7-informed-isolation.md``.

Stands up ``coord.footprint_drift_events``: an append-only oplog of every
observed file edit whose path fell OUTSIDE the allocation's declared overlap
footprint (declared-vs-actual drift, plan §3.1 / P4). One row per drifting
observed path. coord detects drift at Ξ_FS ingest (``POST /coord/fs/observations``)
by glob-matching each observed path against the allocation's persisted
``declared_overlap_paths``; a non-match appends a row here + bumps
``coord_footprint_declared_vs_actual_drift_total``.

The table is the substrate for the per-SESSION confidence downgrade: on the
next ``POST /agents/allocate``, coord checks whether the request's
``agent_session_id`` has ANY drift event and, if so, downgrades that request's
``footprint_confidence`` to ``Absent`` — forcing isolation for the rest of the
session's life (fail toward isolation, never toward a wider shared branch). One
drift event marks the whole conversation untrusted (plan §8 Q2: per-session).

coord OWNS reads/writes of this table; web only authors the DDL. Per fleet
policy coord authors ZERO ``coord.*`` DDL, so THIS web migration is the sole
DDL author.

Schema:

* ``event_id UUID PRIMARY KEY``        — synthetic id.
* ``agent_session_id UUID NOT NULL``   — the downgrade key (per-session scope).
* ``agent_id UUID``                    — the allocation whose edit drifted.
* ``tenant_id UUID``                   — owning tenant, when the observation
  batch carried one (best-effort; the fs-observation ingest may omit it).
* ``repo TEXT``                        — repo of the drifting edit.
* ``observed_path TEXT NOT NULL``      — the actual edited path that did NOT
  match the declared footprint.
* ``declared_paths TEXT[]``            — the declared globs at detection time
  (audit: what the session promised it would touch).
* ``correlation_id UUID``              — the Ξ_FS batch this drift came from.
* ``created_at TIMESTAMPTZ NOT NULL``  — when the drift was detected.

Indices:

* ``idx_fde_session``  — ``(agent_session_id)`` — the HOT per-session
  existence probe the allocate-side downgrade runs (``... WHERE
  agent_session_id = $1 LIMIT 1``).
* ``idx_fde_created``  — ``(created_at)`` — the retention sweep age scan
  (``edit_effects::prune_old_fs_rows`` precedent).

Idempotency: ``CREATE TABLE/INDEX IF NOT EXISTS``. coord reads/writes
BEST-EFFORT (a missing table logs WARN and is treated as "no drift" — NOT in
the boot ``require_table`` gate) so coord + this migration land in either
order without a boot-gate crash-loop (the ungated-inverse trap: a coord read
of a not-yet-migrated object is guarded here by best-effort, not by a hard
require).

Chains off ``coord_sessions_role_01`` (the live single head of the coord
alembic chain on main at authoring time). If a concurrent head-race moves the
head before this lands, re-point ``down_revision`` onto the new head (or let
coord's auto-rebase reconcile the fork).
"""

from collections.abc import Sequence

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "coord_footprint_drift_events"
down_revision: str | Sequence[str] | None = "auto_fix_rm_flaky_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create ``coord.footprint_drift_events`` + indices. Idempotent."""
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.footprint_drift_events (
            event_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            agent_session_id  UUID NOT NULL,
            agent_id          UUID,
            tenant_id         UUID,
            repo              TEXT,
            observed_path     TEXT NOT NULL,
            declared_paths    TEXT[],
            correlation_id    UUID,
            created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    # Hot per-session existence probe run by the allocate-side downgrade.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_fde_session
            ON coord.footprint_drift_events (agent_session_id)
        """
    )
    # Retention sweep age scan.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_fde_created
            ON coord.footprint_drift_events (created_at)
        """
    )


def downgrade() -> None:
    """Drop ``coord.footprint_drift_events`` + indices."""
    op.execute("DROP INDEX IF EXISTS coord.idx_fde_created")
    op.execute("DROP INDEX IF EXISTS coord.idx_fde_session")
    op.execute("DROP TABLE IF EXISTS coord.footprint_drift_events")
