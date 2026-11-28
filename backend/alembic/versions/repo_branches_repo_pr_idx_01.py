"""coord.repo_branches: index each PR's rows by (repo, pr_number).

Adds one index, ``CONCURRENTLY``::

    coord.repo_branches (repo, pr_number) WHERE pr_number IS NOT NULL
                                                 idx_repo_branches_repo_pr

Phase 3 (qontinui-web half) of plan
``2026-11-27-coord-work-unit-realizations-read-burns-two-db-cores``, section D3.

What is slow
------------------------------------------------------------------------------
``coord.repo_branches`` is keyed ``PRIMARY KEY (repo, branch)``, and no index covers
``(repo, pr_number)``: the others are ``idx_repo_branches_pr_state``,
``idx_repo_branches_refreshed``, ``idx_repo_branches_touched_files`` (GIN),
``idx_repo_branches_correlation_id``, ``idx_repo_branches_merged_at`` and
``ix_proclog_repo_branches_author_bound_at``. Every coord read that resolves a PR to
its branch rows therefore reads the whole table.

The costliest of them is the work-unit realizations read (``realizations_sql`` in
coord's ``work_unit_pr_citations.rs``), which joins every citation of a unit to its
PR's rows through ``REALIZATIONS_ROW_SOURCE_WITH_ARCHIVE``
(``displaced_pr_rows.rs``). It ran at a mean of about 303 ms a call and about 9.7
calls a second, about 2.6 average active sessions of database load on its own.
Phase 1 of the plan measured where that time goes and confirmed hypothesis H1: the
``repo_branches`` row source carries about **94.5 %** of the statement's time (coord
finding ``9a63cee3-86ed-49f9-ad98-0e568346513a``). The plan's target for this
phase is a mean under 50 ms.

Consumers
------------------------------------------------------------------------------
Every one filters on ``repo = <x> AND pr_number <op> <y>``, whose strict operator
proves ``pr_number IS NOT NULL``, so the partial predicate holds for each:

- coord's realizations row source (``REALIZATIONS_ROW_SOURCE_WITH_ARCHIVE``, joined
  on the citation's ``(repo, pr_number)``). Its comment says it is deliberately not
  ``LATERAL`` *because* this index is missing; coord's half of Phase 3 rewrites that
  comment, and switches to a per-citation probe only if a re-run ``EXPLAIN`` shows
  the join still off the index. **Expect it to:** in this revision's test, on
  PostgreSQL 16, a reduced copy of that row source sent as today's plain ``LEFT
  JOIN`` stays a hash join over a sequential scan even with the index built, because
  the join clause is not pushed into a ``UNION ALL`` member that carries its own
  anti-join. The same row source as a per-citation ``LATERAL`` probe rides the index
  in both halves. So this index alone does not move the realizations read; it is the
  prerequisite for coord's ``LATERAL`` rewrite, and is immediately useful to the
  three reads below.
- ``gates.rs`` ``FRESHEST_PR_BRANCH_ROW_SQL``: ``WHERE repo = $1 AND pr_number = $2
  ORDER BY last_refreshed_at DESC ... LIMIT 1``, the PR-merged gate evaluator and
  ``pr_state/landed.rs``.
- ``pr_merge/author_feedback.rs``: ``SELECT branch ... WHERE repo = $1 AND pr_number =
  $2 LIMIT 1``.
- ``land_status.rs`` ``resolve_land_status_batch`` Query A: ``WHERE repo = $1 AND
  pr_number = ANY($2)``, whose docstring records this gap as a known cost.

The key is the two equality columns and nothing more. A PR has a handful of rows at
most (one per branch it was opened from), so ordering them by ``last_refreshed_at``
after the probe is a sort of a few rows, and a wider key would only add write cost.

What it costs on writes
------------------------------------------------------------------------------
Measured on production for the plan: ``coord.repo_branches`` held 32,332 rows and
took about 10,230 row writes an hour, and about 1,400 updates in a 27-minute window
were HOT. One more btree adds a per-write cost: an insert gains an index
entry, and an update that changes ``repo`` or ``pr_number`` gains one too. An update
touching neither stays HOT as far as this index is concerned, since the key and
predicate columns are unchanged. The partial predicate leaves out every row without a
PR (a branch the fleet saw pushed but never opened), so those rows pay nothing.

Order against coord
------------------------------------------------------------------------------
This revision may land at any time. It changes no row and no query, so every coord
build is correct whichever deploys first, and simply faster once the index is valid.
coord's half of Phase 3 runs only after ``pg_indexes`` on production shows it.

Building on a busy table
------------------------------------------------------------------------------
``CREATE INDEX CONCURRENTLY IF NOT EXISTS`` (``SHARE UPDATE EXCLUSIVE`` only) inside
``autocommit_block()``, so the build takes no lock that blocks coord's UPSERTs.
Precedents: ``merged_count_01_merged_at_idx``, ``pr_events_mergeability_head_idx_01``.
The table is small (32k rows), so the build is seconds, not minutes; while it runs it
holds back vacuum's xmin horizon and blocks ``VACUUM coord.repo_branches``.

No in-migration guards, deliberately: coord's migration classifier
(``pr_merge/migration_classifier.rs``) is fail-closed, and rejects a read through
``op.get_bind().execute`` and a ``DROP`` on the upgrade path. A killed concurrent
build leaves an INVALID index that ``IF NOT EXISTS`` then skips and reports as
success. So ``indisvalid`` is checked AFTER the deploy instead::

    SELECT c.relname, i.indisvalid
      FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
     WHERE c.relname = 'idx_repo_branches_repo_pr';

``false`` means: wait until ``pg_stat_progress_create_index`` is empty, because a live
build also reads ``false``, then run ``DROP INDEX CONCURRENTLY
coord.idx_repo_branches_repo_pr`` and re-run the statement below by hand. The
second-migrator hazard described in ``pr_events_mergeability_head_idx_01`` applies in
principle, but a build of seconds cannot outlast ``migrate.yml``'s 900 s waiter.

Expected coord migration-classifier disposition: **AutoSafe**. The upgrade path is one
``CREATE INDEX CONCURRENTLY IF NOT EXISTS`` static literal inside an autocommit block.
``tests/test_repo_branches_repo_pr_idx_01_migration.py`` pins that shape and asserts
the three point reads (as generic plans) and the ``LATERAL`` realizations shape plan
on the index.

Revision ID: repo_branches_repo_pr_idx_01
Revises: coord_second_tier_idx_01
Create Date: 2026-11-28

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "repo_branches_repo_pr_idx_01"
down_revision: str | Sequence[str] | None = "coord_second_tier_idx_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Build the partial index. Additive; no row changes."""
    with op.get_context().autocommit_block():
        # Plain literal, never an f-string: the `alembic-schema-arg-gate`
        # pre-commit hook and coord's migration classifier both read it statically.
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_repo_branches_repo_pr
            ON coord.repo_branches (repo, pr_number)
            WHERE pr_number IS NOT NULL
            """
        )


def downgrade() -> None:
    """Drop the index concurrently. No row changes."""
    with op.get_context().autocommit_block():
        op.execute("DROP INDEX CONCURRENTLY IF EXISTS coord.idx_repo_branches_repo_pr")
