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
in ``crate::primary_trees::post_upsert``.

Index ``idx_primary_trees_dirty`` covers the stale-WIP watcher's
``WHERE dirty=true AND last_edit_at < now() - interval '24 hours'``
scan.

Idempotency: ``CREATE TABLE IF NOT EXISTS`` and ``CREATE INDEX IF NOT
EXISTS``. Mirrors the
``qontinui-coord/src/primary_trees.rs::ensure_primary_trees_table``
runtime self-heal — same posture as ``coord.alerts`` /
``coord.agent_worktrees`` (alembic canonical, runtime self-heal is the
recovery path per
[[feedback_canonical_db_behind_alembic]]).

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
