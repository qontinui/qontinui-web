"""coord.worktree_census: (device_id, repo, path, observed_at DESC) index

Revision ID: census_idx_01_device_repo_path_observed
Revises: ci_read_token_01
Create Date: 2026-10-10

Phase 3 (index arm) of plan
``2026-09-20-allocation-budget-door-reads-the-whole-census-to-compute-three-scalars-so-it-times-out``
(``qontinui-dev-notes/plans``). **coord authors zero ``coord.*`` DDL** —
alembic is the sole author — so the index lands here, hand-authored.

The read it serves
------------------------------------------------------------------------------
Every single-device census read in coord
(``worktree_census::load_latest_census_with_window``, all three projection
tiers) is::

    SELECT DISTINCT ON (repo, path) <cols>
      FROM coord.worktree_census
     WHERE device_id = $1 AND observed_at > now() - <24h>
     ORDER BY repo, path, observed_at DESC

and its sibling ``TARGET_WINDOW_MAX_SQL`` groups the same rows
``GROUP BY device_id, repo, path``. The existing indexes are
``(device_id, observed_at DESC)``, ``(repo, path)`` and ``(observed_at)``; none
carries ``device_id`` AND the ``(repo, path, observed_at DESC)`` ordering.

Measured, not assumed
------------------------------------------------------------------------------
``EXPLAIN (ANALYZE, BUFFERS)`` of the full-tier read on production,
2026-10-10, device ``eb2155ed`` (merytshost): planner chose
``idx_worktree_census_repo_path`` → **Index Scan 349,695 rows (350 ms), 74,326
other-device rows removed by Filter → Incremental Sort on observed_at within
(repo, path) groups (~900 ms) → Unique → 4,306 rows; 1,305 ms total**, 429k
shared buffers. The sort is ~70% of the statement.

With ``device_id`` leading and ``observed_at DESC`` trailing, the ``DISTINCT
ON`` is an ordered range scan over this device only: the Sort node and the
other-device filter both disappear, and the ``GROUP BY`` becomes a
``GroupAggregate`` over presorted input.

**Stated precisely:** PostgreSQL has no loose index scan for ``DISTINCT ON``, so
the scan stays O(rows-in-window) — this is a constant-factor win, the same
caution ``coord_obs_idx_01`` records about itself. ``DESC`` is load-bearing:
the read orders ``repo ASC, path ASC, observed_at DESC``, which a plain
ascending index cannot supply in either scan direction.

Write cost: one more btree entry per census INSERT on an append-only table
pruned at 24h retention — acceptable for the read it removes a sort from.

Built ``CONCURRENTLY`` so the hot ingest path is never blocked. A killed
concurrent build leaves an INVALID index that ``IF NOT EXISTS`` would then skip
and report as success, so the create is followed by an ``indisvalid`` check
that raises with the recovery (the ``coord_test_results_idx_01`` precedent).
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "census_idx_01_device_repo_path_observed"
down_revision: str | None = "ci_read_token_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


INDEX_NAME = "idx_worktree_census_device_repo_path_observed"


def _require_valid() -> None:
    """Refuse unless ``coord.<INDEX_NAME>`` exists and is ``indisvalid``."""
    valid = (
        op.get_bind()
        .execute(
            sa.text(
                "SELECT i.indisvalid FROM pg_index i "
                "JOIN pg_class c ON c.oid = i.indexrelid "
                "JOIN pg_namespace n ON n.oid = c.relnamespace "
                "WHERE n.nspname = 'coord' AND c.relname = :n"
            ),
            {"n": INDEX_NAME},
        )
        .scalar()
    )
    if valid is not True:
        state = "INVALID" if valid is False else "absent"
        raise RuntimeError(
            f"coord.{INDEX_NAME} is {state} after CREATE INDEX CONCURRENTLY IF NOT EXISTS "
            "— a killed concurrent build left it (IF NOT EXISTS skipped it). "
            f"Run `DROP INDEX coord.{INDEX_NAME}` plainly and re-run this revision."
        )


def upgrade() -> None:
    """Additive: one CONCURRENTLY composite index. Idempotent."""
    with op.get_context().autocommit_block():
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS
                idx_worktree_census_device_repo_path_observed
            ON coord.worktree_census (
                device_id, repo, path, observed_at DESC
            )
            """
        )
        _require_valid()


def downgrade() -> None:
    """Reverse the additive index. Table and all other indexes survive."""
    with op.get_context().autocommit_block():
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS "
            "coord.idx_worktree_census_device_repo_path_observed"
        )
