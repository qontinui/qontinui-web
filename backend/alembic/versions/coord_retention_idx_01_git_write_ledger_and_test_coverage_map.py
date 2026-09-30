"""coord.git_write_ledger / coord.test_coverage_map — indexes for the retention sweeps.

Adds two b-tree indexes, both ``CONCURRENTLY``::

    coord.git_write_ledger  (created_at)                         idx_git_write_ledger_created_at
    coord.test_coverage_map (repo, test_id, observed_at DESC)    idx_test_coverage_map_repo_test_observed

Why now
------------------------------------------------------------------------------
Neither table has ever shed a row. Measured on production 2026-09-25 (read-only
ECS probe, ``pg_stat_user_tables``): ``git_write_ledger`` is 9.9 GB /
1.2M rows with ``n_tup_del = 0``, ``test_coverage_map`` 8.2 GB / 7.2M rows with
``n_tup_del = 0`` — ~18 GB of an 81 GB database. Plan
``2026-09-25-coord-git-write-ledger-and-test-coverage-map-have-no-retention``
registers both in qontinui-coord's ``table_retention::REGISTERED_SWEEPS``. Rust
authors no ``coord.*`` DDL (served policy ``production-and-cost``
``alembic-sole-authorship``), so the indexes those sweeps need land here, and
they must be APPLIED before the coord PR registering the sweeps deploys.

What each index serves
------------------------------------------------------------------------------
1. ``git_write_ledger (created_at)``. The sweep's batch statement has the shape
   of ``prune_test_results``::

       DELETE FROM coord.git_write_ledger WHERE id IN (
         SELECT id FROM coord.git_write_ledger
         WHERE created_at < $cutoff ORDER BY created_at LIMIT $n)

   It binds NO ``repo``, so the only pre-existing time index —
   ``idx_git_write_ledger_repo_created`` ``(repo, created_at DESC)``
   (``twin_git_02_coord_git_write_ledger``) — cannot serve it: its leading
   column is unbound. Without a bare ``created_at`` btree each batch seq-scans
   and sorts 9.9 GB, which is coord's 60 s ``statement_timeout``, not merely
   slower. With it the batch is an ordered index scan that stops after ``$n``.

2. ``test_coverage_map (repo, test_id, observed_at DESC)``. The table is keyed
   ``(repo, head_sha, test_id)`` and its sweep keeps the LATEST row per
   ``(repo, test_id)`` regardless of age (a test whose newest coverage row is old
   must not lose its only coverage record). That guard is a per-key "newest row"
   probe, and so is the pre-existing read at qontinui-coord
   ``credibility_scorer.rs:516``::

       SELECT ... FROM coord.test_coverage_map
        WHERE repo = $1 AND test_id = $2 ORDER BY observed_at DESC LIMIT 1

   which has had no serving index since the table was created: the unique
   constraint ``uq_test_coverage_map_repo_head_test`` leads
   ``(repo, head_sha, ...)`` with ``head_sha`` unbound, so neither it nor
   ``idx_test_coverage_map_repo_head`` can deliver the ordered per-test probe
   without fetching and sorting every row of the repo.
   With ``repo`` and ``test_id`` bound by equality in the leading positions and
   ``observed_at DESC`` trailing, each probe is one index descent.
   The batch's own ``ORDER BY observed_at LIMIT`` rides the pre-existing
   ``idx_test_coverage_map_observed_at`` (``runtests_effect_tables_01``)
   unchanged.

Nothing is dropped: neither new index makes an existing one a strict prefix.

Ordering / safety
------------------------------------------------------------------------------
Same shape, and the same reasons, as ``coord_test_results_idx_01``: both tables
take continuous production writes, so ``CREATE INDEX CONCURRENTLY`` (``SHARE
UPDATE EXCLUSIVE`` only) rather than an in-transaction build's write-blocking
``SHARE`` lock for the whole build over several GB. CONCURRENTLY cannot run in a
transaction, hence ``op.get_context().autocommit_block()``. On the CI fresh
database both tables are empty and every statement is instant.

A killed CONCURRENTLY build (the Fargate migrator's watcher gives up after
~10 min; a task stop, an RDS failover or a re-dispatch all land on the re-run
path) leaves an INVALID index of the same name that ``IF NOT EXISTS`` then
SKIPS — a false success that would let the coord sweep deploy against an index
the planner will never use. So each CREATE is followed by an explicit
``indisvalid`` check that RAISES, naming the index and the recovery
(``DROP INDEX`` it plainly, re-run). Do not re-dispatch the migrator while a
first task may still be running: the second would skip the still-building
(invalid) index and trip that check — harmless, but a red for nothing.

Coord asserts the property the sweep depends on (a valid, full btree index
LEADING on the age column), not the index name, in copies of
``table_retention::db_tests::test_results_age_index_is_present`` — so retiring
``idx_git_write_ledger_created_at`` is allowed only by replacing it with an
index of that shape; a low ``idx_scan`` on it (the sweep is leader-only, a few
scans a day) is not evidence of idleness. Coord finding
``50ca1e91-4454-492c-b4a5-2f5002e0ac5f``.

Revision ID: coord_retention_idx_01
Revises: coordinput_01_operator_inputs
Create Date: 2026-09-30

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_retention_idx_01"
down_revision: str | None = "coordinput_01_operator_inputs"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_IDX_LEDGER_CREATED = "idx_git_write_ledger_created_at"
_IDX_COVERAGE_REPO_TEST_OBSERVED = "idx_test_coverage_map_repo_test_observed"


def _require_valid(index_name: str) -> None:
    """Refuse to continue unless ``coord.<index_name>`` exists and is ``indisvalid``.

    ``CREATE INDEX CONCURRENTLY IF NOT EXISTS`` reports success when it SKIPS an
    invalid leftover of a killed build. This turns that false success into a
    loud refusal (same check as ``coord_test_results_idx_01``).
    """
    valid = (
        op.get_bind()
        .execute(
            sa.text(
                "SELECT i.indisvalid FROM pg_index i "
                "JOIN pg_class c ON c.oid = i.indexrelid "
                "JOIN pg_namespace n ON n.oid = c.relnamespace "
                "WHERE n.nspname = 'coord' AND c.relname = :n"
            ),
            {"n": index_name},
        )
        .scalar()
    )
    if valid is not True:
        state = "INVALID" if valid is False else "absent"
        raise RuntimeError(
            f"coord.{index_name} is {state} after CREATE INDEX CONCURRENTLY IF NOT EXISTS "
            "— a killed concurrent build left it (IF NOT EXISTS skipped it). "
            f"Run `DROP INDEX coord.{index_name}` plainly and re-run this revision."
        )


def upgrade() -> None:
    """Create the two retention-sweep indexes, each checked valid."""
    with op.get_context().autocommit_block():
        op.execute(
            f"CREATE INDEX CONCURRENTLY IF NOT EXISTS {_IDX_LEDGER_CREATED} "
            "ON coord.git_write_ledger (created_at)"
        )
        _require_valid(_IDX_LEDGER_CREATED)
        op.execute(
            f"CREATE INDEX CONCURRENTLY IF NOT EXISTS {_IDX_COVERAGE_REPO_TEST_OBSERVED} "
            "ON coord.test_coverage_map (repo, test_id, observed_at DESC)"
        )
        _require_valid(_IDX_COVERAGE_REPO_TEST_OBSERVED)


def downgrade() -> None:
    """Drop both indexes."""
    with op.get_context().autocommit_block():
        op.execute(
            f"DROP INDEX CONCURRENTLY IF EXISTS coord.{_IDX_COVERAGE_REPO_TEST_OBSERVED}"
        )
        op.execute(f"DROP INDEX CONCURRENTLY IF EXISTS coord.{_IDX_LEDGER_CREATED}")
