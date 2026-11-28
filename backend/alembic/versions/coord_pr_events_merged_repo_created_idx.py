"""Partial index so coord's ``win_ev`` scan reads only merged pr_events rows.

Phase 2 of plan
``2026-11-28-repo-intake-read-is-intermittent-and-step-0-47-proceeds-on-one-unknown``
(qontinui-dev-notes). Source finding ``1d20f493``.

What fails without it
------------------------------------------------------------------------------
``coord_query_launch_budget repo=<r>`` serves a ``repo_intake`` verdict. On
2026-11-28 the read for ``qontinui/qontinui-coord`` answered
``UNKNOWN lands_unread`` on 3 of 7 calls in about 10 minutes. CloudWatch
``/ecs/qontinui-staging/coord`` over 2026-11-26 05:11Z .. 2026-11-28 05:11Z held
49 lines reading ``launch_budget: repo intake merged-PR read failed: SELECT all
landed PRs (coord.pr_events merged) x coord.pr_labels arming rows: ... canceling
statement due to statement timeout``. The statement is coord's
``ALL_LANDED_ARMING_SQL`` (``crates/coord/src/pr_merge/economics.rs``), run by
``all_landed_arming_rows_on`` under the intake's
``INTAKE_STATEMENT_TIMEOUT_MS = 4000``. When it misses, ``land_counts`` answers
``None`` for every repo and the verdict becomes ``lands_unread``.

Measured on production
------------------------------------------------------------------------------
``EXPLAIN (ANALYZE, BUFFERS)`` of ``ALL_LANDED_ARMING_SQL`` with
``repos = {qontinui/qontinui-coord}`` and ``cutoff = now() - 7 days``, two warm
runs (read-only, 2026-11-28):

* **388 ms and 365 ms**, every buffer a shared hit, **25,405 buffers** in total.
* The ``win_ev`` CTE is a Bitmap Heap Scan over
  ``idx_pr_events_event_kind (event_kind, created_at DESC)``. It reads 6,432
  ``ingest`` and 9,469 ``state_change`` rows in the window, visits **14,875
  heap blocks**, and keeps **187** rows (``Rows Removed by Filter: 15714``),
  because ``repo`` and ``state`` can only be applied as a heap filter.
* The ``ev_pr`` LATERAL adds about 4,000 buffers and the ``train`` CTE's
  ``merge_proposals`` seq scan about 2,775.

Warm, the statement fits in 4 s. Cold, about 25k random block reads from RDS
storage do not, which is why the miss is intermittent and why a re-read seconds
after a miss answers: the miss has just warmed the blocks.

Index shape
------------------------------------------------------------------------------
::

    (repo, created_at)
    WHERE (event_kind = 'ingest' AND state = 'merged')
       OR (event_kind = 'state_change' AND state = 'MERGED')

``win_ev`` filters ``repo = ANY($1) AND created_at >= $2 - interval '1 hour'``
plus the merged-row predicate, so the key is exactly its two range columns and
the predicate restricts the index to merged events — about 190 rows for that
read instead of about 15k events over 14,875 blocks.

**The predicate must stay textually equivalent to ``win_ev``'s WHERE** in
qontinui-coord ``crates/coord/src/pr_merge/economics.rs`` (``ALL_LANDED_ARMING_SQL``,
~:3824-3826 at coord ``77de964e0``)::

    AND ((e.event_kind = 'ingest' AND e.state = 'merged')
      OR (e.event_kind = 'state_change' AND e.state = 'MERGED'))

Postgres uses a partial index only when it can prove the query's predicate
implies the index predicate. Change one side without the other — reword an arm,
add a merged kind, change a state literal's case — and the planner silently
falls back to ``idx_pr_events_event_kind`` and the intake starts timing out
again. Coord pins this: Phase 3 of the plan adds the DB test
``all_landed_win_ev_predicate_implies_the_merged_partial_index``, which EXPLAINs
``ALL_LANDED_ARMING_SQL`` and ``TRAIN_ARMING_SQL`` against a copy of the table
carrying only this index and reds if ``win_ev`` stops naming it; index presence
rides coord's ``schema.manifest`` round-trip after the migrator pin bump.

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
build is instant. Write amplification is negligible: only merged events —
hundreds a day — enter the index.

Additive / forward-only / expand-only: ``upgrade`` creates the index
``IF NOT EXISTS``; ``downgrade`` drops it ``IF EXISTS``. No table, column or
existing index is altered, and no coord reader depends on a new column, so
deploy order is not load-bearing for correctness — every reader is correct
(just slower) without it.

Note on a killed CONCURRENTLY build: a partial build leaves an INVALID index of
the same name, which ``IF NOT EXISTS`` would then skip. If that happens,
``DROP INDEX CONCURRENTLY`` the invalid index and re-run; the post-deploy check
reads ``pg_index.indisvalid``.

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
