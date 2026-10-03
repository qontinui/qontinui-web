"""coord.ci_runs: partial index for the red_main ``red_since`` walk-back.

Phase 2.1 of plan
``2026-09-12-red-main-alert-since-resets-mid-episode-and-a-non-required-gate-reds-main-through-the-fail-closed-arm``.

The reader this serves
======================

The paired qontinui-coord change for this phase (not yet landed at the time of
writing) computes the ``red_main`` alert's ``detail.red_since`` from GitHub's
run record rather than from the alert row's ``first_seen_at``. For every red
repo, on every red_main tick (120 s), and once per failing workflow, it walks
back through that workflow's completed push runs on the default branch,
newest first, until it meets a ``success``. As written in that change
(``data/ci_runs.rs`` ``completed_push_run_verdicts``)::

    SELECT run_id, conclusion, run_started_at, observed_at
      FROM coord.ci_runs
     WHERE repo = $1 AND head_branch = $2 AND workflow_name = $3
       AND event = 'push' AND status = 'completed'
     ORDER BY run_id DESC LIMIT $4

(plus a pre-``run_started_at`` fallback with the same ``WHERE`` and
``ORDER BY``, used only while ``coord_ci_runs_started_at_01`` is unapplied).

``coord.ci_runs`` has no retention, and its only indexes are the primary key
``(repo, run_id)`` and ``ix_ci_runs_inflight (repo, head_branch) WHERE status
IN ('queued', 'in_progress')``. The partial one is excluded by its predicate
(completed runs never match it), and the primary key can only narrow by repo:
it then has to read and filter the repo's whole run history, every event and
every workflow, to find the few rows the walk wants. That is a scan of an
ever-growing history, every 120 s, per red repo, per failing workflow.

The index
=========

``(repo, workflow_name, head_branch, run_id DESC) WHERE event = 'push' AND
status = 'completed'``: the three equality columns lead, and ``run_id DESC``
supplies the ``ORDER BY`` directly, so ``LIMIT`` stops after the rows the
fold consumes (usually a handful, since the walk stops at the first success).
The predicate is the reader's two literal conjuncts, spelled the same way.
PostgreSQL proves predicate implication syntactically, so rewriting either
conjunct on the reader side (a bind parameter for ``'push'``, an ``IN`` list)
silently loses the index. The behaviour test pins the reader SQL against it.

The predicate also keeps the index small: pull-request, schedule and
in-flight runs never enter it. ``run_started_at`` is not a key column: the
walk orders by ``run_id`` (monotonic per repo on GitHub) and reads
``run_started_at`` from the heap for the few rows it returns.

Building: locks, and why the upgrade carries no guards
======================================================

``CREATE INDEX CONCURRENTLY IF NOT EXISTS``, never the plain form:
``coord.ci_runs`` is written continuously by coord's ``ci_runs_watcher``
(webhook ingest plus poll backstop), and a plain build takes a ``SHARE`` lock
that blocks those writes. CONCURRENTLY takes ``SHARE UPDATE EXCLUSIVE`` only.
It cannot run inside a transaction, hence ``op.get_context().autocommit_block()``.
Precedents: ``coord_iops_idx_01``, ``coord_pg_overload_idx_01`` / ``_02``. On
the CI fresh database the table is empty and the build is instant.

No in-migration guards, for the reason ``coord_iops_idx_01`` records: coord's
migration classifier (``pr_merge/migration_classifier.rs``) is fail-closed and
rejects a read through ``op.get_bind().execute``, any ``DROP`` on the upgrade
path and a zero ``SET``. So there is no in-progress refusal and no automatic
rebuild of an INVALID leftover here, and no ``SET LOCAL lock_timeout`` either
(outside a transaction ``SET LOCAL`` has no effect, and a lock timeout that
fires mid-build is itself what leaves an INVALID index). The hazard is handled
after the deploy instead, by a check that must be run and recorded::

    SELECT c.relname, i.indisvalid
      FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
     WHERE c.relname = 'idx_ci_runs_push_completed_walk';

It must read ``indisvalid = true``. A killed build leaves an INVALID index,
which ``IF NOT EXISTS`` would skip on any later run, so it would never serve a
query. The recovery is a follow-up revision that runs
``DROP INDEX CONCURRENTLY IF EXISTS coord.idx_ci_runs_push_completed_walk``
and then this CREATE again, once ``pg_stat_progress_create_index`` shows no
build on the table. Never a plain ``DROP INDEX``.

Additive and expand-only: no table, column or existing index is altered. The
reader is correct WITHOUT this index, only slower, so there is no
column-before-migration hazard with coord. ``downgrade`` drops it
CONCURRENTLY.

Behaviour test: ``tests/test_coord_ci_runs_push_walk_idx_01_migration.py``.

Revision ID: coord_ci_runs_push_walk_idx_01
Revises: coord_ci_runs_started_at_01
Create Date: 2026-09-26

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_ci_runs_push_walk_idx_01"
down_revision: str | Sequence[str] | None = "coord_ci_runs_started_at_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """One additive CONCURRENTLY partial index; verify ``indisvalid`` after deploy."""
    with op.get_context().autocommit_block():
        # A plain literal, never an f-string: the alembic-schema-arg-gate
        # pre-commit hook parses the raw SQL to prove it names its schema.
        #
        # The predicate is the walk-back reader WHERE clause, conjunct for
        # conjunct. Postgres proves implication syntactically, so a divergence
        # silently disables the index.
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS
                idx_ci_runs_push_completed_walk
            ON coord.ci_runs (repo, workflow_name, head_branch, run_id DESC)
            WHERE event = 'push' AND status = 'completed'
            """
        )


def downgrade() -> None:
    """Drop the additive index. The table, its rows and other indexes survive."""
    with op.get_context().autocommit_block():
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS coord.idx_ci_runs_push_completed_walk"
        )
