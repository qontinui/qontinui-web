"""Partial index for the not-a-verdict repair count's scan of coord.pr_events.

Plan ``2026-11-13-not-a-verdict-rerun-behaviour-probe``, Phase 2.

The plan's Phase 3 adds the count query
``repair_not_a_verdict_heads_without_rerun`` to qontinui-coord's
``crates/coord/src/count_query/merge_train.rs``, as
``REPAIR_NOT_A_VERDICT_HEADS_WITHOUT_RERUN_SQL``. It is not on coord's main as
of 2026-11-13: Phase 3 is qontinui-coord branch
``agent/eb2155ed4152-d2980fe1/not-a-verdict-count-query-phase-3``. The query
will be the behaviour anchor for the claim that a failure the CI itself
declared "not a verdict on this PR" is re-run before anything else. Over the
trailing 7 days it will count the PR heads the repair classifier decided
``not_a_verdict`` that stood past a settle bound without the scheduler spending
their one re-run. Its first step is the decided-set scan. In the plan's
candidate statement, which Phase 1 measured, that scan reads::

    FROM coord.pr_events e
    WHERE e.event_kind = 'repair_decision'
      AND e.payload->>'reason' = 'not_a_verdict'
      AND e.payload->>'cause' = 'flake_infra'
      AND e.created_at >= now() - interval '7 days'
      AND ...

Without this index the scan runs on
``idx_pr_events_event_kind (event_kind, created_at DESC)``
(``pr_merge_01_pr_state_extensions``), the index Phase 1's production plan
used. It visits EVERY ``repair_decision`` row in the window and filters the
JSON key on the heap.

Nothing evaluates the query until two more things land. The plan's Phase 4
cites it in a claim, and coord's anchor observer can read that claim only once
qontinui-coord#3827 (or a successor PR carrying the same phase) lands: plan
``2026-10-14-coord-review-numbers-are-sql-countable`` Phase 2′, the registry
door. As of 2026-11-13 #3827 is unlanded, and on coord's main a ``sql_count``
anchor refuses a registry id. Once both have landed, the observer will
evaluate the query on every pass (300 s), under the 5,000 ms server bound the
plan gives it. Evaluation stays per pass until that plan's Phase 2″
cross-tick cache lands, although the query declares a ``refresh_secs`` of
1,800.

The candidate statement's other two lookups are keyed for indexes that
already exist. The re-run lookup spells the literals of
``idx_pr_events_repair_rerun`` (``repair_rerun_01_partial_idx``). The
episode-reset lookup is keyed ``(repo, pr_number, event_kind, created_at)``,
which is ``idx_pr_events_repo_pr_kind_created``.

Measured on production on 2026-11-13 at 01:55Z (the plan's Phase 1, coord
finding ``bf08283e-82b1-4e72-9976-0a90b56ca1e4``, a read-only ECS probe of the
``web`` task): 106,477 ``repair_decision`` rows in the trailing 7 days (about
15k a day, 370,670 all-time), and **0** of them with
``reason = 'not_a_verdict'``. The candidate statement ran 3 times as a prepared
statement under ``plan_cache_mode = force_generic_plan``. Each run touched
**81,332 shared buffers** (all hits, none read) in about 297 ms, through a
``Bitmap Index Scan on idx_pr_events_event_kind`` over all 106,477 rows. Those
pages were warm: a cold 7-day count over the same rows had earlier exceeded a
60 s ``statement_timeout``. The plan's pre-registered rule asks for this index
above 8,000 buffers or a 2,500 ms first run (half the 5,000 ms bound), and it
fired. The scan's cost grows with the whole decision ledger, while the rows it
wants are a sliver of it.

Index shape
------------------------------------------------------------------------------
::

    (created_at)
    WHERE event_kind = 'repair_decision' AND payload->>'reason' = 'not_a_verdict'

The predicate keeps only the rows the scan wants, so the scan's cost follows
the not-a-verdict population instead of the ledger's growth. ``created_at`` as
the key serves the 7-day window as an index range. ``payload->>'cause' =
'flake_infra'`` stays a heap filter rather than a third conjunct.
``repair_cause.rs`` produces ``not_a_verdict`` only as ``flake_infra``, so that
conjunct would narrow nothing, and every literal in the predicate is one more
spelling coord must keep in step.

**The literals are a contract with coord.** Postgres uses a partial index only
when it can prove that the statement's ``WHERE`` implies the index's predicate.
It cannot prove that from a bound parameter under a generic plan. So the
statement must spell ``'repair_decision'`` and ``'not_a_verdict'`` as literals,
the same way ``RERUNS_SPENT_SQL`` spells ``'rerun'`` for
``idx_pr_events_repair_rerun``, and the plan's candidate statement does. If one
side changed a literal alone, coord would stay correct but walk the whole ledger
again, and nothing would report an error. Until Phase 3 (qontinui-coord branch
``agent/eb2155ed4152-d2980fe1/not-a-verdict-count-query-phase-3``) lands,
``tests/test_repair_not_a_verdict_01_partial_idx_migration.py`` pins the index
against a copy of the plan's candidate statement. Phase 3 adds coord's own
literal-pinning test, and the plan's Phase 4 then re-anchors the copy to
coord's commit.

Mechanics
------------------------------------------------------------------------------
``CREATE INDEX CONCURRENTLY`` runs inside ``autocommit_block()``.
``coord.pr_events`` is a hot, append-heavy table, and an in-transaction build
would take a write-blocking ``SHARE`` lock. The revision is additive and
forward-only: ``upgrade`` creates the index ``IF NOT EXISTS``, and
``downgrade`` drops it ``IF EXISTS``. The count will be correct without the
index, only slower. On a cold cache it could overrun its bound, and coord
reports a timed-out count as UNKNOWN, never as a number. So deploy order is not
load-bearing for correctness.

The index is small, but the build is not:

- ``CONCURRENTLY`` reads the whole ``coord.pr_events`` heap twice. The heap was
  4.3 GB on 2026-11-04. For a build on that volume, then near its IOPS cap,
  ``pr_events_mergeability_head_idx_01`` estimated 3 to 30+ minutes by
  arithmetic. That figure is an estimate, not a measurement. Reads are slower
  for the whole build.
- While it runs, the build holds back vacuum across the database (the xmin
  horizon) and blocks ``VACUUM coord.pr_events`` (``SHARE UPDATE EXCLUSIVE``).
- A partial index gets no "safe" concurrent treatment, so other concurrent
  index builds wait for this one too.
- A second migrator no longer kills a live build. Since 2026-11-07
  (``d0352af81``), ``alembic/env.py`` takes ``app.db.migration_lock``'s polled
  session advisory lock, so a second migrator waits until this one has stamped.

A killed build (the migrator task stopped mid-build, or a database failover)
leaves an INVALID index of the same name. ``IF NOT EXISTS`` then skips it and
reports success, so re-running alembic does NOT repair it. ``IF NOT EXISTS``
also keeps ANY index that already holds this name, whatever its definition. So
after the deploy, read the index's identity as well as its validity::

    SELECT i.indisvalid, pg_get_indexdef(i.indexrelid)
      FROM pg_index i
     WHERE i.indexrelid = to_regclass('coord.idx_pr_events_repair_not_a_verdict');

Expect one row: ``true``, and exactly the definition
``tests/test_repair_not_a_verdict_01_partial_idx_migration.py`` pins as
``_EXPECTED_DEFINITION``::

    CREATE INDEX idx_pr_events_repair_not_a_verdict ON coord.pr_events USING btree (created_at) WHERE ((event_kind = 'repair_decision'::text) AND ((payload ->> 'reason'::text) = 'not_a_verdict'::text))

No row, ``false``, or any other definition means the index needs repair. Do
the whole repair in ONE session, in autocommit mode, under ONE hold of the
migration lock. Take it in step 1. Release it in step 3 if you STOP there,
and otherwise in step 6. While you hold it, no migrator can build or drop
this index under you.

1. Take the lock. Poll until this returns ``t``, sleeping between attempts
   outside any transaction::

       SELECT pg_try_advisory_lock(8173873295031625586);

   The key is ``MIGRATION_LOCK_KEY`` in ``app/db/migration_lock.py``, the lock
   every migrator takes. Stop at the first ``t``: each further ``t`` stacks
   another hold, and each hold needs its own unlock. Never wait in the
   blocking ``pg_advisory_lock``: a session blocked inside it holds a
   snapshot that a live CONCURRENTLY build waits for, and the deadlock
   detector then usually kills the build. The lock is session-level, so it
   survives the internal commits of the CONCURRENTLY statements below and
   holds through every step.
2. Wait until this returns no row::

       SELECT 1 FROM pg_stat_progress_create_index
        WHERE relid IS NULL OR relid = 'coord.pr_events'::regclass;

   ``relid IS NULL`` is there on purpose. A role that has neither the
   builder's privileges nor ``pg_read_all_stats`` sees another session's
   build with ``relid`` NULL, so filtering on ``relid`` alone would hide
   exactly that build. The cost is that a build on another table also holds
   the wait, which only makes it longer.
3. Re-run the identity-and-validity read above. A live build also reads
   ``false``, so if it now reads ``true`` with the expected definition, that
   build finished VALID and nothing needs repair: release the lock with
   ``SELECT pg_advisory_unlock(8173873295031625586);`` and STOP. Only
   otherwise go on.
4. Run ``DROP INDEX CONCURRENTLY IF EXISTS
   coord.idx_pr_events_repair_not_a_verdict``. Never use a plain
   ``DROP INDEX``: its ACCESS EXCLUSIVE lock queues behind any long reader
   and stalls every coord read and write on the table behind it.
5. Run the ``CREATE INDEX CONCURRENTLY`` statement in ``upgrade()``.
6. Release the lock, whatever step 5 did::

       SELECT pg_advisory_unlock(8173873295031625586);

   A failed or cancelled build keeps the lock: a session-level advisory lock
   outlives a failed statement, and only ``pg_advisory_unlock`` or the end of
   the session releases it. If step 5 failed, or you are unsure how many
   ``t`` you took in step 1, end the session instead, which releases every
   hold at once. A failed build also leaves an INVALID index behind, so then
   start again from step 1 in a new session. Never leave a hold behind. Each
   extra ``t`` stacks one, and while any hold remains, every migrator waits
   out ``DEFAULT_WAIT_SECS`` (3600 s in ``app/db/migration_lock.py``, unless
   ``QONTINUI_MIGRATION_LOCK_WAIT_SECS`` overrides it) and then raises
   ``MigrationLockTimeout`` having applied nothing.
7. Re-run the identity-and-validity read above, and expect ``true`` with the
   definition above. If step 5 printed a ``skipping`` NOTICE, an index of
   that name was already there and step 5 built nothing, so the index you
   are checking is not one you built: start again from step 1.

The revision has no in-migration repair, on purpose. coord's migration
classifier (``pr_merge/migration_classifier.rs``) is fail-closed: it rejects a
read through ``op.get_bind()``, a ``DROP`` on the upgrade path and a zero
``SET``, and a Reject parks the PR on its author. The plan's Phase 2 gate
runs that identity-and-validity read on production after the deploy. It then
re-runs the Phase 1 ``EXPLAIN``, expecting the decided-set scan on this index
and under 8,000 buffers.

Revision ID: repair_not_a_verdict_01_partial_idx
Revises: coord_ci_runs_head_sha_idx_01
Create Date: 2026-11-13

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "repair_not_a_verdict_01_partial_idx"
down_revision: str | None = "coord_ci_runs_head_sha_idx_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Additive: one CONCURRENTLY partial index. Idempotent."""
    with op.get_context().autocommit_block():
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS
                idx_pr_events_repair_not_a_verdict
            ON coord.pr_events (created_at)
            WHERE event_kind = 'repair_decision'
              AND payload->>'reason' = 'not_a_verdict'
            """
        )


def downgrade() -> None:
    """Reverse the additive index. Table + all other indexes survive."""
    with op.get_context().autocommit_block():
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS coord.idx_pr_events_repair_not_a_verdict"
        )
