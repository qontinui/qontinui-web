"""twin p6 01 — Ξ_Worktree Phase 6 reclaim-lifecycle columns

Revision ID: twin_p6_01_worktree_reclaim_lifecycle
Revises: coord_sessions_task_run_id
Create Date: 2026-06-05

Phase 6.1 (web migration) of the Ξ_Worktree lifecycle-driven safe-reclaim plan
(``D:/qontinui-root/plans/2026-06-05-twin-worktree-phase6-lifecycle-reclaim.md``
§6 Phase 6.1 + §9 touch map row 1).

Adds three **nullable** lifecycle columns consumed by qontinui-coord (Rust),
which cannot author DDL — Alembic in qontinui-web is the sole author of the
``coord.*`` schema (enforced coord-side by ``coord_schema_authorship``). The
Rust side only SELECTs / INSERTs / UPDATEs these columns.

Columns
=======

* ``coord.agent_worktrees.reclaim_candidate_at TIMESTAMPTZ`` (nullable) — when a
  worktree first became a reclaim *candidate* (``first_candidate_at`` in §3 /
  ``candidate_since`` in the §6.5 explain surface). NULL = not (yet) a
  candidate. The §4 G5 grace predicate is ``now − reclaim_candidate_at ≥
  RECLAIM_GRACE``; coord stamps it on the first tick a candidate signal fires
  and clears it (back to NULL) when the worktree leaves the candidate set.
* ``coord.agent_worktrees.trigger_signal TEXT`` (nullable) — the typed
  candidate signal that put the worktree in the queue (§3:
  ``pr_merged`` / ``session_stale`` / ``lease_ttl`` / ``done_signal``). NULL =
  no active candidate signal. Free-form TEXT (no CHECK) so new signal kinds in
  later phases don't need a migration — matches the ``coord.*`` TEXT-enum
  posture (cf. ``pr_events.event_kind``).
* ``coord.worktree_census.landed_in_main BOOLEAN`` (nullable) — the per-worktree
  G2 "work landed" fact computed runner-side in the census
  (``git merge-base --is-ancestor`` else empty ``git diff origin/main...HEAD``).
  NULL = couldn't determine (fails the gate, per §4 G2). Sits alongside
  ``is_dirty`` on the per-tick census oplog row.

Why nullable / no backfill
==========================

Expand-only / forward-only per ``reference_alembic_expand_contract_forward_only``.
All three are pure-derived lifecycle facts recomputed each watcher / census tick
from authoritative state; legacy rows (pre-Phase-6 worktree rows, historical
census rows) carry NULL and there is nothing meaningful to backfill — the next
tick repopulates the live set.

No indexes
==========

The two ``agent_worktrees`` columns are read in the full per-tick candidate scan
(``load_declared_worktrees``), not via a point lookup, so a partial index buys
nothing over the existing PK / status indexes. ``landed_in_main`` is read from
the latest census row already located by ``idx_worktree_census_device_observed_at``
/ ``idx_worktree_census_repo_path``. No precedent index exists on similar
census fact columns (``is_dirty`` is unindexed), so we add none — following
house style.

Idempotency / authorship posture
================================

* DDL uses ``ADD COLUMN IF NOT EXISTS`` / ``DROP COLUMN IF EXISTS`` raw SQL —
  matching the ``coord.*`` migration house style (see
  ``coord_sessions_task_run_id`` / ``pr_merge_01_pr_state_extensions``). coord
  boots against this same schema, so re-running against an already-applied DB
  is a no-op.
* **alembic is the SOLE author of the coord.* schema.** No Rust
  ``CREATE``/``ALTER`` self-heal for these columns.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "twin_p6_01_worktree_reclaim_lifecycle"
down_revision: str = "coord_sessions_task_run_id"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE coord.agent_worktrees "
        "ADD COLUMN IF NOT EXISTS reclaim_candidate_at TIMESTAMPTZ"
    )
    op.execute(
        "ALTER TABLE coord.agent_worktrees "
        "ADD COLUMN IF NOT EXISTS trigger_signal TEXT"
    )
    op.execute(
        "ALTER TABLE coord.worktree_census "
        "ADD COLUMN IF NOT EXISTS landed_in_main BOOLEAN"
    )


def downgrade() -> None:
    op.execute(
        "ALTER TABLE coord.worktree_census DROP COLUMN IF EXISTS landed_in_main"
    )
    op.execute(
        "ALTER TABLE coord.agent_worktrees DROP COLUMN IF EXISTS trigger_signal"
    )
    op.execute(
        "ALTER TABLE coord.agent_worktrees DROP COLUMN IF EXISTS reclaim_candidate_at"
    )
