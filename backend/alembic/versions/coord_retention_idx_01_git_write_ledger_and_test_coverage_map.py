"""coord.git_write_ledger / coord.test_coverage_map — indexes for the retention sweeps.

Adds three b-tree indexes, each ``CONCURRENTLY``::

    coord.git_write_ledger  (created_at)                         idx_git_write_ledger_created_at
    coord.git_write_ledger  (created_at)
                            WHERE initiator = 'outbound_mirror'  idx_git_write_ledger_mirror_created
    coord.test_coverage_map (repo, test_id, observed_at DESC)    idx_test_coverage_map_repo_test_observed

Why now
------------------------------------------------------------------------------
Neither table has ever shed a row. Measured on production 2026-10-31 (read-only
ECS probe, ``pg_stat_user_tables`` / ``pg_total_relation_size``):
``git_write_ledger`` is 27 GB total, 2.9 GB heap, ~5.4M rows, ``n_tup_del = 0``;
``test_coverage_map`` is 15 GB total, 9.5 GB heap, ~13.1M rows, ``n_tup_del = 0``.
That is up from 9.9 GB / 1.2M and 8.2 GB / 7.2M on 2026-09-25, when plan
``2026-09-25-coord-git-write-ledger-and-test-coverage-map-have-no-retention``
was written. The plan registers both in qontinui-coord's
``table_retention::REGISTERED_SWEEPS``. Rust authors no ``coord.*`` DDL (served
policy ``production-and-cost`` ``alembic-sole-authorship``), so the indexes those
sweeps need land here, and they must be APPLIED before the coord PR registering
the sweeps deploys.

What each index serves
------------------------------------------------------------------------------
1. ``git_write_ledger (created_at)``. The whole-table sweep's batch statement has
   the shape of ``prune_test_results``::

       DELETE FROM coord.git_write_ledger WHERE id IN (
         SELECT id FROM coord.git_write_ledger
         WHERE created_at < $cutoff ORDER BY created_at LIMIT $n)

   It binds NO ``repo``, so the only pre-existing time index —
   ``idx_git_write_ledger_repo_created`` ``(repo, created_at DESC)``
   (``twin_git_02_coord_git_write_ledger``) — cannot serve it: its leading
   column is unbound. Without a bare ``created_at`` btree each batch seq-scans
   the heap and top-N sorts it, up to 200 times per sweep. With it the batch is
   an ordered index scan that stops after ``$n``. Coord's companion sweep (same
   plan, Phase 2) additionally refuses to run when no such index is present (its
   deploy-order guard), so this revision must be applied before that sweep can
   do anything.

2. ``git_write_ledger (created_at) WHERE initiator = 'outbound_mirror'``. A 90-day
   window alone no longer bounds this table. The same 2026-10-31 reading sampled
   the ledger by initiator: ``outbound_mirror`` was 99.4% of the last 7 days
   (~124K rows/day in October, every one on a ``.git`` mirror repo, none carrying
   a ``proposal_id``), so 90 days steady-states at ~11M rows, about twice today's
   table. Coord's companion PR therefore adds a second, scoped sweep with a much
   shorter window (14 days) over exactly those rows. Its batch adds
   ``AND initiator = 'outbound_mirror'`` to the shape above with the literal
   inlined, so this partial index matches it, and the walk visits mirror rows only
   instead of stepping over every older row of the other initiators, which the
   longer window is deliberately keeping. The notification ``undo`` floor the plan
   pins for the ledger does not bind this slice: only ``mcp_push_tool`` writes emit
   a notification naming a ledger row.

3. ``test_coverage_map (repo, test_id, observed_at DESC)``. The table is keyed
   ``(repo, head_sha, test_id)`` and its sweep keeps the LATEST row per
   ``(repo, test_id)`` regardless of age (a test whose newest coverage row is old
   must not lose its only coverage record). At 13.1M rows and a 9.5 GB heap the
   companion PR emits that guard as coord's per-candidate index probe
   (``prune_latest_per_key_index_probe_sql``, ``GuardAccess::IndexProbe``)::

       EXISTS (SELECT 1 FROM coord.test_coverage_map n
               WHERE n.repo = o.repo AND n.test_id = o.test_id
                 AND n.observed_at > o.observed_at)

   rather than one whole-table ``GROUP BY`` per batch, the shape ``GuardAccess``'s
   own doc measures at 30-50 s per batch on another table of 22M rows, against a
   60 s ``statement_timeout``. This is the index that probe descends, and the same
   doc measures the probe as WORSE than the aggregate without one, so the companion
   PR's deploy-order guard refuses that sweep when this index is absent as well. A
   low ``idx_scan`` reading is therefore not evidence it can be retired. It also
   serves, exactly, the pre-existing per-test read at qontinui-coord
   ``credibility_scorer.rs``::

       SELECT ... FROM coord.test_coverage_map
        WHERE repo = $1 AND test_id = $2 ORDER BY observed_at DESC LIMIT 1

   which has had no serving index since the table was created: the unique
   constraint ``uq_test_coverage_map_repo_head_test`` leads
   ``(repo, head_sha, ...)`` with ``head_sha`` unbound. The batch's own
   ``ORDER BY observed_at LIMIT`` rides the pre-existing
   ``idx_test_coverage_map_observed_at`` (``runtests_effect_tables_01``)
   unchanged.

Nothing is dropped: no new index makes an existing one a strict prefix.

Building on large tables
------------------------------------------------------------------------------
Both tables take continuous production writes, so ``CREATE INDEX CONCURRENTLY IF
NOT EXISTS`` (``SHARE UPDATE EXCLUSIVE`` only) rather than an in-transaction
build's write-blocking ``SHARE`` lock for the whole build over several GB.
CONCURRENTLY cannot run in a transaction, hence
``op.get_context().autocommit_block()``. Precedents: ``coord_iops_idx_01``,
``route_serving_method_idx_01_host_path_method_observed``. On the CI fresh
database both tables are empty and every statement is instant. The coverage index
is built last because it is the largest build.

No in-migration guards, deliberately, on the ``coord_iops_idx_01`` reasoning:
coord's migration classifier (``pr_merge/migration_classifier.rs``) is fail-closed
and rejects a read through ``op.get_bind().execute``. A killed concurrent build
leaves an INVALID index that ``IF NOT EXISTS`` then skips and reports as success,
so ``indisvalid`` is checked AFTER the deploy instead::

    SELECT c.relname, i.indisvalid
      FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
     WHERE c.relname IN ('idx_git_write_ledger_created_at',
                         'idx_git_write_ledger_mirror_created',
                         'idx_test_coverage_map_repo_test_observed');

``false`` means: run ``DROP INDEX CONCURRENTLY coord.<name>`` and re-run the
revision's statement by hand. ``.github/workflows/migrate.yml``'s waiter never stops
the task, so its timeout does not mean a build died: a task still running is a build
still running, and that recovery must wait for it. The companion PR's sweeps also
refuse an invalid full index by themselves, recording
``coord_table_retention_sweeps_total{outcome="failed"}``.

Expected coord migration-classifier disposition: **AutoSafe**. The upgrade path is
three guarded ``CREATE INDEX CONCURRENTLY IF NOT EXISTS`` statements inside an
autocommit block, and every SQL string is a static literal.
``tests/test_coord_retention_idx_01_migration.py`` pins those shapes and asserts the
planner uses each index for its read.

Coord's companion PR adds live-catalog tests (``git_write_ledger_age_index_is_present``,
``git_write_ledger_mirror_index_matches_the_sweep_predicate``,
``index_probed_guards_are_served_by_an_index``), each waived for this revision's index
until coord's migrator pin passes it, and binding from then on. Retiring one of these
indexes is allowed only by replacing it with an index those tests accept. Coord
finding ``50ca1e91-4454-492c-b4a5-2f5002e0ac5f``.

Revision ID: coord_retention_idx_01
Revises: launch_budget_01
Create Date: 2026-10-31

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_retention_idx_01"
down_revision: str | None = "launch_budget_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# Every SQL string below is a STATIC literal: the coord merge-train migration
# classifier rejects an execute call whose argument it cannot read as one.


def upgrade() -> None:
    """Additive: three CONCURRENTLY indexes. Idempotent."""
    with op.get_context().autocommit_block():
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_git_write_ledger_created_at
            ON coord.git_write_ledger (created_at)
            """
        )
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_git_write_ledger_mirror_created
            ON coord.git_write_ledger (created_at)
            WHERE initiator = 'outbound_mirror'
            """
        )
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_test_coverage_map_repo_test_observed
            ON coord.test_coverage_map (repo, test_id, observed_at DESC)
            """
        )


def downgrade() -> None:
    """Drop all three indexes. The tables and their other indexes survive."""
    with op.get_context().autocommit_block():
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS coord.idx_test_coverage_map_repo_test_observed"
        )
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS coord.idx_git_write_ledger_mirror_created"
        )
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS coord.idx_git_write_ledger_created_at"
        )
