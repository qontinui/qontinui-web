"""coord.primary_trees primary-tree state lookup

Revision ID: coord_primary_trees
Revises: ud03_drop_remap_table
Create Date: 2026-05-19

Phase 1 of plan
``D:/qontinui-root/plans/2026-05-19-coordinator-production-readiness.md``.

Stands up ``coord.primary_trees``: one row per ``(device_id, repo)``
representing the most recent primary-tree state the runner has observed
locally for that repo. Populated by the runner-side
``tree_state_publisher`` (sibling of ``heartbeat_to_coord``); read by
the stale-WIP watcher and the operator dashboard.

Schema:

* ``device_id UUID``      — FK to ``coord.devices(device_id)`` ON DELETE
  CASCADE. ``coord.devices`` is the unified replacement for the old
  ``coord.machines`` (post ``ud01_unify_devices_registry``).
* ``repo TEXT``           — repository name, e.g. ``qontinui-runner``.
* ``branch TEXT``         — checked-out branch name.
* ``head_sha TEXT``       — HEAD commit SHA at observation time.
* ``dirty BOOLEAN``       — ``git status --porcelain`` returned non-empty.
* ``dirty_files TEXT[]``  — sample of dirty paths (capped; NULL when
  clean).
* ``last_observed_at TIMESTAMPTZ`` — when the publisher wrote this row.
* ``last_edit_at TIMESTAMPTZ``     — most-recent modification time on
  any tracked file (used by the stale-WIP watcher).
* ``last_edit_by_agent UUID``      — best-effort attribution. Today the
  publisher leaves it NULL because no per-repo agent-id is wired up; the
  column is in place so Phase 4 (spawn surface) can stamp it when an
  agent allocates the worktree.

Composite primary key ``(device_id, repo)`` matches the UPSERT pattern
in ``crate::data::primary_trees::post_upsert``.

Index ``idx_primary_trees_dirty`` covers the stale-WIP watcher's
``WHERE dirty=true AND last_edit_at < now() - interval '24 hours'``
scan. (Re-checked 2026-08-07 and it does: the watcher scans
``WHERE dirty = true AND last_edit_at IS NOT NULL AND last_edit_at < $1``
(``stale_wip_watcher.rs``), which implies this partial index's
``WHERE dirty = true``. Unlike ``idx_primary_trees_stale`` — see
``coord_primary_trees_selfheal_backfill`` — this one is genuinely usable.)

Idempotency: ``CREATE TABLE IF NOT EXISTS`` and ``CREATE INDEX IF NOT
EXISTS``.

Corrected 2026-08-07: the paragraph above used to continue "Mirrors the
``qontinui-coord/src/primary_trees.rs::ensure_primary_trees_table`` runtime
self-heal — same posture as ``coord.alerts`` / ``coord.agent_worktrees``
(alembic canonical, runtime self-heal is the recovery path per
[[feedback_canonical_db_behind_alembic]])", and the primary-key sentence named
``crate::primary_trees::post_upsert``. Both were true when this revision was
authored and neither is now. ``ensure_primary_trees_table`` does not exist in
coord at all — every Rust ``coord.*`` self-heal was deleted (plan
``2026-05-29-delete-stale-rust-table-self-heals``), and the module moved under
``src/data/`` (coord ``34678c72``). More importantly the POSTURE has inverted:
runtime self-heal is no longer the recovery path. alembic is the SOLE author of
``coord.*`` schema (served policy ``production-and-cost``
``alembic-sole-authorship``), and coord's canonical-schema boot gate never
creates a missing table — it either hard-fails boot or degrades the dependent
routes. Read as live guidance, the old sentence pointed at a recovery mechanism
that no longer exists.

Which of those two this table gets, stated precisely because "asserts table
presence at boot" (the closing line of the sibling ``coord.primary_trees``
revisions) reads stronger than it is: ``primary_trees`` is a BEST-EFFORT
manifest entry, NOT in coord's ``CRITICAL_BOOT_TABLES`` allowlist
(``schema_manifest.rs`` — only ``agent_sessions`` / ``alerts`` / ``devices`` /
``leader_lease`` / ``tenants`` hard-fail). If this revision has not been applied,
coord BOOTS and degrades the tree-state routes to ``503
schema_migration_pending``; it does not refuse to start. Operationally that is
the quiet failure mode, not the loud one — worth knowing before assuming a
missing migration would announce itself at boot. (``COORD_BOOT_GATE_STRICT=1``
restores hard-fail-for-all as a kill switch.)

Scope note: 28 other applied revisions still name a deleted
``qontinui-coord`` ``::ensure_*`` self-heal in the same way. Only the
``coord.primary_trees`` family is corrected here — the table whose docstrings
were already under review in PR #945 — and the rest is left to a separate sweep
rather than bundled into this diff.

Chains off ``ud03_drop_remap_table`` (verified as the linear tip of
the ud-chain on origin/main 2026-05-19 per
``feedback_verify_origin_state_before_phase_start``). ``ud03`` itself
is operator-deferred (30-day soak) but its idempotent ``DROP IF EXISTS``
upgrade is a no-op when re-applied, so chaining off it is safe whether
ud03 has been applied yet or not.
"""

from collections.abc import Sequence

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "coord_primary_trees"
down_revision: str = "ud03_drop_remap_table"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create ``coord.primary_trees`` + indices. Idempotent."""
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.primary_trees (
            device_id          UUID NOT NULL
                REFERENCES coord.devices(device_id) ON DELETE CASCADE,
            repo               TEXT NOT NULL,
            branch             TEXT NOT NULL,
            head_sha           TEXT NOT NULL,
            dirty              BOOLEAN NOT NULL,
            dirty_files        TEXT[],
            last_observed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
            last_edit_at       TIMESTAMPTZ,
            last_edit_by_agent UUID,
            PRIMARY KEY (device_id, repo)
        )
        """
    )
    # Stale-WIP watcher's hot path: WHERE dirty=true AND last_edit_at < ...
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_primary_trees_dirty
            ON coord.primary_trees (dirty, last_edit_at)
            WHERE dirty = true
        """
    )
    # Dashboard's per-device lookup: GET /coord/trees/by-device/:id.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_primary_trees_device
            ON coord.primary_trees (device_id, last_observed_at DESC)
        """
    )


def downgrade() -> None:
    """Drop ``coord.primary_trees`` and its indices."""
    op.execute("DROP INDEX IF EXISTS coord.idx_primary_trees_device")
    op.execute("DROP INDEX IF EXISTS coord.idx_primary_trees_dirty")
    op.execute("DROP TABLE IF EXISTS coord.primary_trees")
