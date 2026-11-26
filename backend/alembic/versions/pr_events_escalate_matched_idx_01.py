"""coord.pr_events: a covering partial index of the escalate-path-matched evaluations.

Adds one index, ``CONCURRENTLY``::

    coord.pr_events (repo, pr_number)
                    WHERE event_kind = 'predicate_eval'
                      AND payload->>'block_reason_code' = 'escalate-path-matched'
                                                 idx_pr_events_escalate_matched_repo_pr

Phase 2a of plan
``2026-11-26-devops-stuck-pr-watcher-detector-3-query-hits-the-statement-timeout-every-tick``.
Phase 2b, the qontinui-coord half, rewrites the rest of the statement and
does not wait for this revision.

What is slow
------------------------------------------------------------------------------
coord's ``stuck_pr_watcher`` detector 3 (``ESCALATE_BLOCKED_DWELL_SQL`` in
``crates/coord/src/stuck_pr_watcher.rs``) starts from every PR that has ever
had an escalate-path evaluation::

    escalate_prs AS (
        SELECT DISTINCT repo, pr_number
        FROM coord.pr_events
        WHERE event_kind = 'predicate_eval'
          AND payload->>'block_reason_code' = 'escalate-path-matched'
    )

No index fits that read. The nearest is ``idx_pr_events_tenant_reason_created``
(``coord_pg_overload_idx_02``): ``(tenant_id, (payload->>'block_reason_code'),
created_at DESC) WHERE event_kind = 'predicate_eval'``. It leads with
``tenant_id``, and this read has no tenant predicate, so the planner scans the
whole index. It then fetches the heap for ``repo`` and ``pr_number``, which the
index does not carry.

Measured read-only in production on 2026-11-26, at a quiet minute, with
``coord.pr_events`` about 9.04 M rows and 744 k heap pages, and
``idx_pr_events_tenant_reason_created`` 1.21 M entries in 39.8 k pages
(coord finding ``494ebef8``):

- ``escalate_prs`` took 14.3 s of a 23.9 s ``EXPLAIN (ANALYZE, BUFFERS)``. The
  parallel scan read 49,134 blocks from disk (16.0 s of I/O summed over its
  workers) to keep 12,888 rows, which came to 1,038 PRs after the DISTINCT.
- A cold ``count(*)`` over ``escalate_prs`` ran past a 180 s timeout.

coord's own ``statement_timeout`` is 60 s, so detector 3 has failed
intermittently since at least 2026-11-18, at a rising rate: 6 of 24 hourly
ticks on 11-19, 19 of 24 on 11-25 and 19 of 21 on 11-26, unbroken since about
2026-11-26T05:48Z (coord finding ``494ebef8``, read from
``coord.leader_worker_runs``; alert ``280068623``). The cost grows with every
``predicate_eval`` row in history, not with the escalate population.

What this index does
------------------------------------------------------------------------------
The predicate is exactly ``escalate_prs``' ``WHERE``, so the index holds the
escalate rows and nothing else (12,888 today). The read's clauses are all
implied by the predicate, and ``repo`` and ``pr_number`` are the key. So the
planner can answer the read with an ``Index Only Scan`` in key order, and the
``DISTINCT`` follows from that order. The heap is visited only for pages the
visibility map has not yet marked all-visible. The cost now follows the
escalate evaluations, not the event history.

**The predicate is a contract with coord.** Postgres uses a partial index only
when it can prove that the query's clauses imply the predicate. coord spells
both values as literals, and its
``hourly_detectors_2_3_4_9_never_take_a_fleet_wide_newest_event`` test pins
that spelling (``ESCALATE_PRS_READ``). If either side changes its literals,
coord stays correct but slow again. This revision's test pins this side
against a copy of coord's read.

One other coord read can prove the predicate. ``window_clearances`` in
``pr_merge/escalate_evidence_watch.rs`` binds the code as ``$3``
(``ESCALATE_BLOCK_CODE``), and coord sends it as a one-shot statement, which
Postgres plans with the value known. Its per-marker lateral is pinned to one PR
by ``repo`` and ``pr_number``. On this index it would read only that PR's
escalate rows, a subset of the PR's ``predicate_eval`` rows that
``idx_pr_events_repo_pr_kind_created`` gives it. This index cannot bound that
lateral by ``created_at`` the way ``idx_pr_events_repo_pr_kind_created`` can,
so it visits every escalate row the PR ever had; the planner chooses between
the two on cost. Every
other coord read that filters on the block code uses a different code, bound
or literal (``'none'``, ``'main-red'``), or an ``IS DISTINCT FROM`` test, so
none of them can use this index.

Rejected alternatives:

- A tenant-bounded seek on the existing index still fetches the heap once per
  row.
- A recursive skip scan costs one probe per distinct PR ever seen.
- A time window would silently drop a PR blocked for longer than the window,
  and that PR is the alert this detector exists to raise.

Order against coord
------------------------------------------------------------------------------
This revision may land at any time. An index changes no result, and the
planner uses it in coord's read whenever it is valid, before or after Phase
2b. That phase leaves ``escalate_prs``' ``WHERE`` unchanged. No coord read of a
new column is involved, so the deploy-ordering rule of served policy
``production-and-cost`` ``alembic-sole-authorship`` does not apply.

Building on a large, busy table
------------------------------------------------------------------------------
``CREATE INDEX CONCURRENTLY IF NOT EXISTS`` takes ``SHARE UPDATE EXCLUSIVE``
only, so it never blocks coord's writes. It runs inside ``autocommit_block()``
because a concurrent build cannot run in a transaction. Precedents on this
table are ``repair_rerun_01_partial_idx`` and
``pr_events_mergeability_head_idx_01``.

What it costs:

- It reads the whole ``coord.pr_events`` heap twice (about 6 GB at 744 k
  pages), and reads are slower while it runs.
- It holds back vacuum across the database while it runs, and it blocks
  ``VACUUM coord.pr_events``.
- The index itself is small: about 12.9 k entries of two short keys, under
  1 MB (about 100 pages). Only writes of an escalate-path-matched evaluation
  maintain it, including coord's per-tick in-place UPDATE of a PR's newest
  ``predicate_eval`` row (non-HOT, since ``created_at`` is indexed).

``alembic/env.py``'s migration lock (``app/db/migration_lock.py``) stops a
second migrator from planning until this one has stamped. Its waiter polls
rather than blocks, so it holds no snapshot that the build's last phase would
wait on.

No in-migration guards, deliberately, for the reason ``coord_iops_idx_01``
gives. coord's migration classifier (``pr_merge/migration_classifier.rs``) is
fail-closed. It rejects a read through ``op.get_bind().execute``, a ``DROP`` on
the upgrade path and a zero ``SET``. A killed concurrent build leaves an
INVALID index, which ``IF NOT EXISTS`` then skips while reporting success. So
check ``indisvalid`` AFTER the deploy::

    SELECT c.relname, i.indisvalid
      FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
     WHERE c.relname = 'idx_pr_events_escalate_matched_repo_pr';

If it reads ``false``, first wait until ``pg_stat_progress_create_index`` is
empty (a live build also reads ``false``). The recovery is then a follow-up
alembic revision, never hand DDL in production (alembic is the sole author of
``coord.*`` schema): it runs
``DROP INDEX CONCURRENTLY IF EXISTS coord.idx_pr_events_escalate_matched_repo_pr``
and then this revision's ``CREATE INDEX CONCURRENTLY`` again, each in an
autocommit block, as ``coord_iops_idx_01`` prescribes. Never a plain
``DROP INDEX``: its ACCESS EXCLUSIVE lock queues behind any long reader and
stalls every coord read and write on the table behind it. That follow-up
carries a DROP on its upgrade path, so coord's migration classifier holds it
for review, which is the right control for a re-build.

Expected coord migration-classifier disposition: **AutoSafe**. The upgrade path
is one guarded ``CREATE INDEX CONCURRENTLY IF NOT EXISTS`` inside an autocommit
block, and the SQL is a static literal.
``tests/test_pr_events_escalate_matched_idx_01_migration.py`` pins that shape,
the predicate's literals, and that coord's read rides the index.

Revision ID: pr_events_escalate_matched_idx_01
Revises: overview_07_schedule_last_known
Create Date: 2026-11-26

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "pr_events_escalate_matched_idx_01"
down_revision: str | None = "overview_07_schedule_last_known"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# down_revision is the single alembic head of this branch at authoring time.
# If `alembic-heads-pr` reports two heads after another revision lands first,
# re-point this line, the `Revises:` line above and `_PARENT_REVISION_ID` in
# tests/test_pr_events_escalate_matched_idx_01_migration.py together.


def upgrade() -> None:
    """Additive: one CONCURRENTLY partial index. Idempotent."""
    with op.get_context().autocommit_block():
        # Plain literal, never an f-string: the `alembic-schema-arg-gate`
        # pre-commit hook and coord's migration classifier both read it
        # statically. The predicate spells coord's `escalate_prs` WHERE.
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS
                idx_pr_events_escalate_matched_repo_pr
            ON coord.pr_events (repo, pr_number)
            WHERE event_kind = 'predicate_eval'
              AND payload->>'block_reason_code' = 'escalate-path-matched'
            """
        )


def downgrade() -> None:
    """Drop the index concurrently. The table and every other index survive."""
    with op.get_context().autocommit_block():
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS "
            "coord.idx_pr_events_escalate_matched_repo_pr"
        )
