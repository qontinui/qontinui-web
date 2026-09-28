"""coord.test_result_heads — a per-(repo, head_sha) ledger for the flakiness read.

Phase 2 (web migration) of plan
``2026-09-28-coord-test-flakiness-history-read-still-hits-the-statement-timeout``.
Creates one new, empty table and one index::

    coord.test_result_heads (id, repo, head_sha, first_observed_at,
                             last_observed_at, row_count)
        uq_test_result_heads_repo_head    UNIQUE (repo, head_sha)
        idx_test_result_heads_repo_last   (repo, last_observed_at DESC)

Why this table exists
=====================

``POST /coord/test-flakiness`` (and the declare-time duration predictor, both
through qontinui-coord ``test_run_effects::load_result_history``) scores each
test over its newest rows, restricted to the roster of tests carried by the
repo's TWO most recent ``head_sha``s. Today those two heads are found by
probing ``coord.test_results`` itself::

    latest   AS (SELECT head_sha FROM coord.test_results
                  WHERE repo = $1 AND head_sha IS NOT NULL
                  ORDER BY observed_at DESC LIMIT 1),
    previous AS (... AND head_sha <> latest.head_sha
                  ORDER BY observed_at DESC LIMIT 1)

Measured 2026-09-28 (coord finding ``1c1b9554``): the read for
``qontinui/qontinui-coord`` failed three times out of three at 60.35-60.42 s
with ``pg_code 57014`` (coord's ``statement_timeout``), on a quiet database,
while the runner's read took 3-11 s. That repo's own ingest has been starved by
an HTTP 413 since at least 2026-09-08, so its rows are sparse and stale. Two
shapes of those probes can each walk most of the ~28M-row table for such a repo:

* **(A) walks the bare time index.** ``repo = $1`` reduces
  ``ORDER BY observed_at`` to a single-column order, so the retained
  ``idx_test_results_observed_at`` is eligible, and ``coord_test_results_idx_01``
  recorded the planner PREFERRING it for this probe. For a repo whose newest row
  sits under days of the runner's ~2M rows/day, a backward walk with a residual
  ``repo`` filter covers most of the table. PostgreSQL has no plan hints, so no
  SQL-only rewrite can take that choice away from the planner.
* **``previous`` with no qualifying row scans its whole range.** A repo with at
  most one distinct non-null ``head_sha`` gives ``previous`` nothing to find, so
  its ``LIMIT 1`` exhausts every entry the chosen index offers. That is a
  deterministic timeout that needs no cost misestimate at all.

Even on the good plan, ``previous`` pays one random heap fetch per row of the
newest head (``(repo, observed_at DESC)`` does not carry ``head_sha``), which is
~22k rows on the runner and is exactly the load-sensitive cost that took the
runner's nightly dark from 2026-09-23 to 09-27 while RDS was IOPS-bound.

This ledger removes both probes. It holds one row per ``(repo, head_sha)``,
upserted by coord's ingest writer (``persist_test_results``) once per chunk it
persists, and the read takes its two heads from::

    SELECT head_sha FROM coord.test_result_heads
     WHERE repo = $1 ORDER BY last_observed_at DESC LIMIT 2

which touches only this small table, so no plan can walk ``test_results`` to
answer it. The ``roster`` DISTINCT and the per-test LATERAL probe are unchanged
and still ride the existing ``test_results`` indexes.

Schema
======

* ``id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY`` — a surrogate key, and
  deliberately not ``PRIMARY KEY (repo, head_sha)``. coord's retention sweep
  (``table_retention.rs`` ``prune_sql(table, pk_col, age_col)``) deletes in
  batches via ``WHERE {pk_col} IN (SELECT {pk_col} ... ORDER BY {age_col}
  LIMIT $2)`` over ONE key column, the shape every registered table uses. A
  single-column key lets this table reuse that shape instead of adding a
  composite-key prune variant.
* ``repo text NOT NULL`` — spelled exactly as ``coord.test_results.repo``
  (``qontinui/qontinui-runner``; the bare ``qontinui-coord`` coverage spelling is
  a separate key there and stays one here).
* ``head_sha text NOT NULL`` — only chunks that carry a head are recorded; the
  read already ignores ``head_sha IS NULL`` rows.
* ``first_observed_at`` / ``last_observed_at timestamptz NOT NULL`` — the
  head's first and most recent ingest chunk. The read orders by
  ``last_observed_at``, which keeps today's "two most recent heads" semantics,
  including the reason for TWO (an in-flight chunked ingest, or a subset
  ``ci_dispatch`` job landing last).
* ``row_count bigint NOT NULL DEFAULT 0`` — the running total of rows persisted
  under this head. Nothing reads it yet; it is recorded so a later change can
  make "complete head" explicit without another migration.
* ``uq_test_result_heads_repo_head UNIQUE (repo, head_sha)`` — the identity,
  and the ``ON CONFLICT (repo, head_sha)`` target of coord's upsert.
* ``idx_test_result_heads_repo_last (repo, last_observed_at DESC)`` — serves
  "the two newest heads for this repo" as an ordered probe that stops after two
  entries.

No backfill — deliberate
========================

This revision writes no rows. Deriving the ledger would be a
``GROUP BY repo, head_sha`` over the whole of ``coord.test_results`` (~28M rows,
the fleet's hottest append table) inside the production migrator, a Fargate
one-shot whose watcher gives up after ~10 min (see
``coord_test_results_idx_01``). That is the wrong risk for a table that fills by
itself: the runner ingests ~100 times a day, so its heads appear within minutes
of the coord change deploying.

Until a repo's first post-deploy ingest it has no ledger row, and coord reads
that as an empty roster, which is ``thin``. That is the honest answer for
"nothing ingested since the ledger began", and coord deliberately does NOT fall
back to the old walk for a repo with no row, because that would re-admit the
walk for exactly the repo that times out today. coord runs the old SQL only
while this TABLE is absent (``42P01``), which is the window between the coord
deploy and this revision applying.

Retention needs no age index here
=================================

coord will register this table in ``table_retention`` with the same 14-day
window as ``coord.test_results``, pruning by ``last_observed_at``: a head older
than that has no rows left to score. ``table_retention`` design note 2 expects
an age-leading index for the sweep's ``WHERE age_col < cutoff ORDER BY age_col
LIMIT n`` subquery, and this table deliberately has none. At about one row per
CI head, the table stays in the low thousands of rows under a 14-day window, so
that subquery's seq scan is sub-millisecond. An index would add write cost to
every ingest chunk for no read it could speed up.

The covering index is deferred, not rejected
============================================

The plan's D1 also names a conditional covering index for the per-test probe,
``(repo, test_id, observed_at DESC) INCLUDE (outcome, duration_seconds,
head_sha, shard)``, replacing ``idx_test_results_repo_test_observed``. That
index widens every entry on the hottest append table, so it ships only if the
plan's Phase 1 production measurement (``EXPLAIN (ANALYZE, BUFFERS)`` on the
live table) shows the per-test probe is heap-fetch-bound. Phase 1 could not run
from the authoring box (no AWS credentials, 2026-09-28), so this revision
carries the ledger alone: the plan's decision table puts the ledger in every
row. The covering index, if Phase 1 picks it, is a separate later revision with
the ``CONCURRENTLY`` + ``autocommit_block()`` + ``indisvalid`` shape of
``coord_test_results_idx_01``. This revision needs none of that, because it
builds on a new, empty table inside alembic's normal transaction.

Idempotency / authorship posture
================================

* ``CREATE TABLE IF NOT EXISTS`` / ``CREATE INDEX IF NOT EXISTS``, with a
  symmetric ``downgrade()`` that drops the index and then the table. This is the
  ``coord.*`` house style (cf. ``ptbe_01_primary_tree_branch_events``).
* **alembic is the SOLE author of the ``coord.*`` schema** (served policy
  ``production-and-cost`` ``alembic-sole-authorship``). coord only INSERTs,
  UPDATEs, SELECTs and prune-DELETEs this table.
* coord's upsert and read both treat ``42P01`` as "migration pending", so this
  revision and the coord change may land in either order without an error. It
  lands first so the coord change finds the table on arrival.

Chaining
========

``down_revision = "coordprio_01_queued_at_priority_tier"`` -- ``main``'s single
alembic head, measured 2026-09-29 with ``scripts/ci/count_alembic_heads.py``
(``HEAD_COUNT=1``, ``HEAD=coordprio_01_queued_at_priority_tier``) after
rebasing onto ``origin/main`` ``abf669755`` (first authored against
``cinode_03_dispatch_pr_head_base_sha``; re-pointed when ``coordprio_01`` landed). A re-point is three coupled edits:
``down_revision``, the ``Revises:`` line below, and ``_PARENT_REVISION_ID`` in
``tests/test_coord_test_results_heads_01_migration.py``.

Revision ID: coord_test_result_heads_01
Revises: coordprio_01_queued_at_priority_tier
Create Date: 2026-09-28

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_test_result_heads_01"
down_revision: str | None = "coordprio_01_queued_at_priority_tier"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create ``coord.test_result_heads`` and its newest-heads index. Idempotent."""
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.test_result_heads (
            -- Surrogate key: coord's retention prune_sql batches over ONE key
            -- column, so (repo, head_sha) is a UNIQUE constraint, not the PK.
            id                bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
            repo              text        NOT NULL,
            head_sha          text        NOT NULL,
            first_observed_at timestamptz NOT NULL,
            last_observed_at  timestamptz NOT NULL,
            -- Running total of rows persisted under this head. Unread today.
            row_count         bigint      NOT NULL DEFAULT 0,
            -- The ON CONFLICT target of coord's per-chunk ingest upsert.
            CONSTRAINT uq_test_result_heads_repo_head UNIQUE (repo, head_sha)
        )
        """
    )
    # "The two newest heads for this repo": an ordered probe stopping at 2.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_test_result_heads_repo_last
            ON coord.test_result_heads (repo, last_observed_at DESC)
        """
    )


def downgrade() -> None:
    """Drop ``coord.test_result_heads`` and its index."""
    op.execute("DROP INDEX IF EXISTS coord.idx_test_result_heads_repo_last")
    op.execute("DROP TABLE IF EXISTS coord.test_result_heads")
