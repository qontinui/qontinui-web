"""coord.primary_trees — backfill the three columns the deleted Rust self-heal created

Revision ID: coord_primary_trees_selfheal_backfill
Revises: coord_tenant_repo_unenroll_01
Create Date: 2026-08-05

Plan ``2026-07-28-web-primary-trees-backfill-migration``.

Three ``coord.primary_trees`` columns — ``behind_count``, ``head_detached``,
``untracked_count`` — are written by coord's tree-report upsert
(``qontinui-coord/src/data/primary_trees.rs``, the ``POST /coord/trees/upsert``
path) and read back by the stale-WIP watcher, the pull-decision watcher and the
operator dashboard. They EXIST in the canonical RDS, but only because the Rust
``ALTER TABLE ... ADD COLUMN IF NOT EXISTS`` self-heal created them historically;
that self-heal was deleted from the production binary (plan
``2026-05-29-delete-stale-rust-table-self-heals``) and survives only as the
``#[cfg(test)]`` fixture ``create_primary_trees_for_test``. The alembic chain
never gained a migration for them.

So any FRESH database migrated to head — CI's migrator catalog, a new
environment, disaster recovery — lacks all three, and every tree-report
write/read 42703s there. coord's live-catalog read-contract gate found the gap
(coord PR #1271) and carries the three reads as deliberate ``KNOWN_MISSING``
leads (``schema_read_contract.rs``, reason const ``R_TREES_GAP``) until this
migration lands. This closes it.

Shapes match the live canonical catalog exactly (read 2026-08-05 via coord's
``schema_object`` probe against ``qontinui_db``), so applying this to prod is a
strict no-op:

* ``behind_count INT``          — nullable, no default. Commits HEAD is behind
  ``origin/<branch>``.
* ``head_detached BOOLEAN``     — nullable, no default. Detached-HEAD flag.
* ``untracked_count INT``       — nullable, no default. Untracked-file count.

Deliberately nullable-without-default, unlike the sibling ``local_ahead INT NOT
NULL DEFAULT 0`` (``coord_primary_trees_local_ahead``): the Rust reads decode
them as ``Option<i32>`` / ``Option<bool>``, and matching prod is what keeps this
migration a no-op there.

Also restores ``idx_primary_trees_stale``, the partial index that shipped from
the same deleted self-heal and is likewise absent from the whole alembic chain.
It covers the stale-tree scan predicate (``behind_count > 0 OR untracked_count >
0 OR head_detached = true``) that the primary-tree staleness watcher and the
pull-decision watcher run; without it a fresh database sequentially scans
``coord.primary_trees`` on every pass.

Idempotency: ``ADD COLUMN IF NOT EXISTS`` + ``CREATE INDEX IF NOT EXISTS``
throughout, matching the guarded-DDL house pattern
(``coord_policy_rules_tenant_override``). Re-applying is a strict no-op whether
or not the self-heal already created the objects.

alembic is the SOLE author of ``coord.*`` schema; the coord binary asserts table
presence at boot and never authors DDL in production. These columns are authored
here, not in Rust.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_primary_trees_selfheal_backfill"
down_revision: str = "coord_tenant_repo_unenroll_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the three self-heal columns + the stale-scan index. Idempotent."""
    # ----------------------------------------------------------------
    # 1. The three columns. Nullable, no default — matching the live
    #    canonical catalog so this is a no-op against prod.
    # ----------------------------------------------------------------
    op.execute(
        """
        ALTER TABLE coord.primary_trees
            ADD COLUMN IF NOT EXISTS behind_count INT
        """
    )
    op.execute(
        """
        ALTER TABLE coord.primary_trees
            ADD COLUMN IF NOT EXISTS head_detached BOOLEAN
        """
    )
    op.execute(
        """
        ALTER TABLE coord.primary_trees
            ADD COLUMN IF NOT EXISTS untracked_count INT
        """
    )

    # ----------------------------------------------------------------
    # 2. The stale-tree partial index, same origin as the columns and
    #    likewise missing from the chain. Predicate matches the staleness
    #    / pull-decision watchers' scan.
    # ----------------------------------------------------------------
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_primary_trees_stale
            ON coord.primary_trees (behind_count, untracked_count)
            WHERE behind_count > 0 OR untracked_count > 0 OR head_detached = true
        """
    )


def downgrade() -> None:
    """Drop the index first (it depends on all three columns), then the columns."""
    op.execute("DROP INDEX IF EXISTS coord.idx_primary_trees_stale")
    op.execute("ALTER TABLE coord.primary_trees DROP COLUMN IF EXISTS untracked_count")
    op.execute("ALTER TABLE coord.primary_trees DROP COLUMN IF EXISTS head_detached")
    op.execute("ALTER TABLE coord.primary_trees DROP COLUMN IF EXISTS behind_count")
