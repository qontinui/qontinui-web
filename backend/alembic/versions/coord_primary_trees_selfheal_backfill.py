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

It is carried for PARITY with the canonical catalog, NOT for performance —
**no current query can use it.** Corrected 2026-08-06 (pre-PR review of this
migration): an earlier version of this docstring claimed the index "covers the
stale-tree scan predicate … the staleness and pull-decision watchers run". It
does not. A partial index is only usable when the query's predicate IMPLIES the
index's, and neither does:

* ``primary_tree_staleness_watcher.rs`` scans
  ``behind_count IS NOT NULL OR head_detached IS NOT NULL OR untracked_count IS
  NOT NULL OR behind_default_count IS NOT NULL OR branch <> $1``. ``IS NOT
  NULL`` is strictly broader than ``> 0`` (a row with ``behind_count = 0``
  matches the query and not the index), and the last two disjuncts are not
  covered at all.
* ``pull_decision_watcher.rs`` scans ``(behind_count IS NOT NULL AND
  behind_count > 0) OR (behind_default_count IS NOT NULL AND
  behind_default_count > 0)``. The ``behind_default_count`` disjunct admits
  rows the index predicate excludes, so the implication fails there too.

Both watchers sequentially scan ``coord.primary_trees`` with this index exactly
as they do without it. Keeping it is still right — prod carries it, and a fresh
database that silently differs from prod is the whole class of bug this
migration exists to close — but do not treat it as load-bearing. Making it
usable would require changing those two predicates first, not adding another
index.

Idempotency: ``ADD COLUMN IF NOT EXISTS`` + ``CREATE INDEX IF NOT EXISTS``
throughout, matching the guarded-DDL house pattern
(``coord_policy_rules_tenant_override``). Re-applying is a strict no-op whether
or not the self-heal already created the objects.

**The no-op property is one-directional — DO NOT downgrade past this revision
against the canonical RDS.** ``upgrade()`` is a no-op in prod precisely because
prod already has these objects; ``downgrade()`` is not conditioned on that and
drops all four unconditionally. On a fresh database that is symmetric and
correct. In prod it would DESTROY three live columns that the tree-report upsert
writes and both watchers read — reintroducing the exact ``42703`` this migration
exists to prevent, and losing the stored counts permanently, because alembic
never populated them and no backfill would restore them. This asymmetry is
inherent to backfilling objects that already exist and is why it is called out
here rather than "fixed": the sibling migrations
(``coord_primary_trees_local_ahead``, ``chkguard_01_behind_default_count``)
carry unconditional drops safely only because they genuinely authored their own
columns. Migrations are forward-only here in any case — see
``qontinui-web/.github/workflows/migrate.yml``, which states the deploy path
never auto-reverts a migration.

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
