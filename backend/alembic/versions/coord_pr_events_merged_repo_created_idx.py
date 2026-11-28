"""Partial index so coord's ``win_ev`` scan reads only merged pr_events rows.

Phase 2 of plan
``2026-11-28-repo-intake-read-is-intermittent-and-step-0-47-proceeds-on-one-unknown``
(qontinui-dev-notes). Source finding ``1d20f493``.

What fails without it
------------------------------------------------------------------------------
``coord_query_launch_budget repo=<r>`` serves a ``repo_intake`` verdict, and on
2026-11-28 it intermittently answered ``UNKNOWN lands_unread`` (coord finding
``1d20f493-b715-4d31-8c43-6382667a4e35``). The failing statement is coord's
``ALL_LANDED_ARMING_SQL`` (``crates/coord/src/pr_merge/economics.rs``), run by
``all_landed_arming_rows_on`` under the intake's
``INTAKE_STATEMENT_TIMEOUT_MS = 4000``; when it times out, ``land_counts``
answers ``None`` for every repo and the verdict becomes ``lands_unread``.

Measured per the plan's §Why
------------------------------------------------------------------------------
The CloudWatch warn-line counts and the production ``EXPLAIN (ANALYZE,
BUFFERS)`` of that statement are recorded in the plan's §Why
(qontinui-dev-notes ``plans/2026-11-28-repo-intake-read-is-intermittent-and-step-0-47-proceeds-on-one-unknown.md``)
and in finding ``1d20f493``; they are cited there rather than copied here. In
outline: the ``win_ev`` CTE is a Bitmap Heap Scan over
``idx_pr_events_event_kind (event_kind, created_at DESC)`` that visits every
``ingest`` and ``state_change`` row in the window and discards nearly all of
them, because ``repo`` and ``state`` can only be applied as a heap filter. Warm,
the statement fits its 4 s bound; cold, the random block reads do not, which is
why the miss is intermittent.

Index shape
------------------------------------------------------------------------------
::

    (repo, created_at)
    WHERE (event_kind = 'ingest' AND state = 'merged')
       OR (event_kind = 'state_change' AND state = 'MERGED')

``win_ev`` filters ``repo = ANY($1) AND created_at >= $2 - interval '1 hour'``
plus the merged-row predicate, so the key is exactly its two range columns and
the predicate restricts the index to merged events: the scan reads the asked
repos' merged rows in the window, not every event in it.

**The predicate must stay textually equivalent to ``win_ev``'s WHERE** in
qontinui-coord ``crates/coord/src/pr_merge/economics.rs`` (``ALL_LANDED_ARMING_SQL``,
~:3824-3826 at coord ``77de964e0``)::

    AND ((e.event_kind = 'ingest' AND e.state = 'merged')
      OR (e.event_kind = 'state_change' AND e.state = 'MERGED'))

Postgres uses a partial index only when it can prove the query's predicate
implies the index predicate. Change one side without the other — reword an arm,
add a merged kind, change a state literal's case — and the planner silently
falls back to ``idx_pr_events_event_kind`` and the intake starts timing out
again. coord's Phase 3 test
(``all_landed_win_ev_predicate_implies_the_merged_partial_index``, plan
``2026-11-28-repo-intake-read-is-intermittent-and-step-0-47-proceeds-on-one-unknown``)
pins this once it lands: it EXPLAINs ``ALL_LANDED_ARMING_SQL`` and
``TRAIN_ARMING_SQL`` against a copy of the table carrying only this index and
reds if ``win_ev`` stops naming it; index presence rides coord's
``schema.manifest`` round-trip after the migrator pin bump.

The same predicate is repeated by ``TRAIN_ARMING_SQL`` (``win_head``) and by the
per-kind arms of ``ev_pr`` / ``ARMING_LIBRARY_LANDED_PRS_SQL``, so those reads
may also benefit; that is to be confirmed by the post-deploy EXPLAIN, not
claimed here.

Mechanics
------------------------------------------------------------------------------
``CREATE INDEX CONCURRENTLY`` (not plain ``CREATE INDEX``): ``coord.pr_events``
is a hot append-heavy table under live production write load, and an
in-transaction build would take a write-blocking ``SHARE`` lock. CONCURRENTLY
cannot run inside a transaction, hence ``op.get_context().autocommit_block()``
— same precedent as ``coord_pr_events_hydration_head_idx`` and
``coord_pg_overload_idx_01``. On the CI fresh DB the table is empty, so the
build is instant there. **On production it is not:** CONCURRENTLY scans all of
``coord.pr_events``, the fleet's largest append-only table, twice, and then
waits for every transaction older than the build to finish. Its duration is not
measured here; read ``pg_stat_progress_create_index`` while it runs. Only
merged events enter the index, a small fraction of the table's writes.

**A second migrator kills a live build.** It waits on the first's lock, the
deadlock detector usually fires, and the FIRST dies while the second prints
``already exists, skipping``, exits 0 and closes any open ``migration-failure``
issue, leaving the index INVALID (reproduced on Postgres 16.13, per
``pr_events_mergeability_head_idx_01``). ``.github/workflows/migrate.yml``'s
concurrency group covers only its 900 s waiter, which never stops the task, so
this needs a build that outlasts the waiter and a later run: its 03:00 UTC cron,
a push touching ``backend/alembic/**``, ``backend/pyproject.toml`` or
``backend/poetry.lock``, or coord's gate executor or a manual dispatch. Nothing
in that workflow or in ``alembic/env.py`` takes an advisory lock, and a blocking
one would not help: the session waiting on it holds a snapshot that the first
build's last phase waits for, and the deadlock still fires. So **land this away
from 03:00 UTC, merge no other PR touching those paths until
``pg_stat_progress_create_index`` is empty, and read ``indisvalid`` after the
deploy** (the plan's Phase 2 post-deploy step owns that read and the repair
below).

Additive / forward-only / expand-only: ``upgrade`` creates the index
``IF NOT EXISTS``; ``downgrade`` drops it ``IF EXISTS``. No table, column or
existing index is altered, and no coord reader depends on a new column, so
deploy order is not load-bearing for correctness — every reader is correct
(just slower) without it.

A killed CONCURRENTLY build — no in-migration repair, deliberately
------------------------------------------------------------------------------
A killed build leaves an INVALID index of the same name, which ``IF NOT EXISTS``
then skips while alembic stamps the revision as applied. The usual repair (read
``pg_index.indisvalid`` through ``op.get_bind().execute``, then ``DROP INDEX
CONCURRENTLY`` before the CREATE) is NOT carried here, on the
``pr_events_mergeability_head_idx_01`` / ``coord_iops_idx_01`` reasoning: coord's
migration classifier (``pr_merge/migration_classifier.rs``) is fail-closed and
rejects SQL run through ``op.get_bind().execute``, any ``DROP`` on the upgrade
path, and ``REINDEX``. A ``Reject`` becomes ``MigrationDispositionOutcome::Blocked``
(the ``migrations`` escalate path), so the repair would trade a rare failure for
a certain escalation. ``tests/test_coord_pr_events_merged_repo_created_idx_migration.py``
pins both the single-CREATE upgrade path and the "INVALID is kept" behaviour.

So ``indisvalid`` is checked AFTER the deploy instead (Phase 2's post-deploy
step)::

    SELECT c.relname, i.indisvalid
      FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
     WHERE c.relname = 'idx_pr_events_merged_repo_created';

``false`` means: wait until ``pg_stat_progress_create_index`` is empty (a live
build also reads ``false``), then run ``DROP INDEX CONCURRENTLY
coord.idx_pr_events_merged_repo_created`` and re-run the CREATE below by hand.

Revision ID: coord_pr_events_merged_repo_created_idx
Revises: cinode_06_ci_node_directives
Create Date: 2026-11-28

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_pr_events_merged_repo_created_idx"
down_revision: str | None = "cinode_06_ci_node_directives"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Additive: one CONCURRENTLY partial index. Idempotent."""
    with op.get_context().autocommit_block():
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS
                idx_pr_events_merged_repo_created
            ON coord.pr_events (repo, created_at)
            WHERE (event_kind = 'ingest' AND state = 'merged')
               OR (event_kind = 'state_change' AND state = 'MERGED')
            """
        )


def downgrade() -> None:
    """Reverse the additive index. Table + all other indexes survive."""
    with op.get_context().autocommit_block():
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS coord.idx_pr_events_merged_repo_created"
        )
