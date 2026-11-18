"""coord.test_results — rebuild three bloated indexes concurrently to reclaim storage

Revision ID: coord_test_results_reindex_01
Revises: prcheckruns_suite_01
Create Date: 2026-11-08

Storage reclamation, Phase 1 of plan
``2026-11-08-coord-test-results-indexes-hold-21-gb-of-empty-pages``. DDL only:
no table, column, query or route changes, and nothing is created or removed
for good. Two existing indexes are rebuilt with ``REINDEX INDEX CONCURRENTLY``,
and the third, the large one, is dropped and built again concurrently (plan D4,
below). Each comes back under the same name with the same definition, without
its empty pages.

Why
===

The 2026-10-20 backlog drain took ``coord.test_results`` from ~89M live rows to
~31M, which emptied most of the pages of its b-tree indexes. VACUUM keeps an
emptied b-tree page in that index's own free space map: a later page split in
the SAME index may reuse it, no other relation can, and VACUUM never truncates
an index file. The table has since converged at ~35M rows, so these indexes
will not grow back into that space, and the volume never sees it again without
a rebuild. The table's 2026-11-06 autovacuum logged its six indexes at
33.92 GB, 21.34 GB of it deleted or reusable pages::

    index                                  pages      reusable pages
    idx_test_results_repo_test_observed    3,305,503  1,987,996 (16.29 GB)  rebuilt
    idx_test_results_repo_observed           305,443    267,032  (2.19 GB)  rebuilt
    test_results_pkey                        275,045    178,814  (1.46 GB)  rebuilt
    idx_test_results_observed_at             149,334    109,145  (0.89 GB)  left
    idx_test_results_repo_head               105,439     61,931  (0.51 GB)  left
    idx_test_results_correlation                   1          0             left

The three rebuilt here return at least ~19.9 GB, on a database volume that is
otherwise on course to fill this month. The two left alone hold 1.40 GB
between them, and every concurrent rebuild scans the ~20 GB heap twice (build,
then validate), so each would cost 10-20 minutes of saturated I/O for under
0.9 GB.

Sources for the production figures above and below: the RDS PostgreSQL log
``/aws/rds/instance/qontinui-staging/postgresql`` (the 2026-11-06T17:56:45Z
autovacuum line for ``coord.test_results``), CloudWatch ``FreeStorageSpace`` for
instance ``qontinui-staging``, and plan
``2026-11-08-coord-test-results-indexes-hold-21-gb-of-empty-pages`` in
qontinui-dev-notes, which re-derived each figure at vet time. Free storage has
fallen since: the minimum over the hour to 2026-11-18T01:04Z was 22.98 GB, after
a daily minimum of 21.54 GB on 11-17, falling about 2-4 GB a day. That is at or
under D4's 22 GB threshold by the time this lands, so the large index takes D4's
drop-then-create form (below).

The indexes
===========

* ``test_results_pkey`` ``(id)``: the table's primary key, created unnamed in
  ``runtests_effect_tables_01``, so it carries PostgreSQL's default name.
* ``idx_test_results_repo_observed`` ``(repo, observed_at DESC)`` and
  ``idx_test_results_repo_test_observed`` ``(repo, test_id, observed_at DESC)``,
  both from ``coord_test_results_idx_01``.

``REINDEX ... CONCURRENTLY`` keeps each index's definition and dependencies; the
primary key constraint moves to the rebuilt index. No constraint uses
``idx_test_results_repo_test_observed``, so dropping it and creating it again
with the definition ``coord_test_results_idx_01`` gave it leaves the same index.

Order and lock posture
======================

Smallest first: ``idx_test_results_repo_observed``, then ``test_results_pkey``,
then ``idx_test_results_repo_test_observed``. The two small rebuilds free about
3.7 GB and need far less temporary space than a rebuild of the large one would. One index per
statement, never ``REINDEX TABLE CONCURRENTLY``: the table form keeps every new
index beside its old one until the end, so its peak is the sum of all of them.

Each statement takes ``SHARE UPDATE EXCLUSIVE`` on the table, so reads and
writes of ``coord.test_results`` carry on throughout. For the two rebuilds the
old index serves until the new one replaces it; the large index is absent
between its drop and the end of its build (D4, below). ``REINDEX ...
CONCURRENTLY``, ``DROP INDEX CONCURRENTLY`` and ``CREATE INDEX CONCURRENTLY``
cannot run inside a transaction, hence ``op.get_context().autocommit_block()``.

Leftovers of an interrupted rebuild
===================================

A failed ``REINDEX ... CONCURRENTLY`` leaves one of two INVALID indexes behind:
``<name>_ccnew``, the new index, when the build or validate phase fails; or
``<name>_ccold``, the OLD index renamed, when it fails after the swap (for the
large index that is the full ~27 GB). So before each rebuild the revision runs
``DROP INDEX CONCURRENTLY IF EXISTS`` on both names for that index. That also
clears whatever a killed earlier attempt of this revision left.

A failed rebuild does not stop the revision
===========================================

This covers the two ``REINDEX`` statements. The large index's drop-then-create
is deliberately NOT wrapped (D4, below). Each ``REINDEX`` is wrapped. On a database error the revision drops that
index's ``_ccnew`` and ``_ccold`` again, logs ONE line starting with
``FAILURE_MARKER`` (below) that names the index and the error, and goes on to
the next index; the revision then stamps. An unstamped maintenance revision
would be retried by every later migrator run, holding every later ``coord.*``
migration and every web deploy behind it, and re-spending transient space on a
nearly full volume each time. The cost is that a failure stamps anyway; the
plan's two signals catch it: free space does not rise, and that line is in the
migrator log. A KILLED task raises nothing, so its revision stays unstamped and
the next run's leftover drops clean up after it.

One class of error is not swallowed: SQLSTATE class 42
(``PERMANENT_SQLSTATE_CLASS``), for example ``insufficient_privilege`` when the
migrator role does not own the table, or ``undefined_table`` (42P01) for a
renamed index. Such an error fails the same way on every attempt, and stamping
past it would record a revision that reclaimed nothing and never retries. So
after the leftover drops and the log line (which then says the revision is NOT
stamped), the handler re-raises it, and the revision fails UNSTAMPED until the
cause is fixed.

A caught error leaves the connection usable. Inside ``autocommit_block()``
every statement is its own transaction, so a failed one leaves no aborted
transaction behind, and the next statement and alembic's stamp run normally.
``tests/test_coord_test_results_reindex_01_migration.py`` drives a real failure
in the middle rebuild to prove it.

Bounded waits, and what to do about a stall
===========================================

The block opens with ``SET statement_timeout = '4h'`` and closes with
``RESET statement_timeout``. Every statement in it is then bounded by this
revision's own 4 h rather than by whatever the migrator's role sets: a role
``statement_timeout`` under about an hour would cancel the large rebuild, which
the catch above would then stamp with nothing reclaimed. The ``SET`` is
session-level because inside an autocommit block a ``SET LOCAL`` lasts only for
its own statement. ``lock_timeout`` is deliberately left alone: a short one
would turn the rebuilds' ordinary waits into stamps that reclaim nothing.

A rebuild waits for every transaction holding a lock on ``coord.test_results``,
and later for every transaction with an older snapshot, so a session left idle
in a transaction stalls it. The signal: the migrator's row in
``pg_stat_progress_create_index`` shows a ``waiting for ...`` ``phase`` that does
not move, with ``current_locker_pid`` naming the session it waits on; or
``SELECT pg_blocking_pids(<migrator pid>)`` names it. The remedy: end that
BLOCKING session (``pg_terminate_backend(<blocker pid>)``), never the migrator.
Left alone, the stalled statement is cancelled at 4 h. A cancelled ``REINDEX``
is caught like any other failure, but its leftover drops can wait on the same
blocker for up to 4 h more, and a statement that times out outside a
``REINDEX`` fails the revision unstamped, for the next run to retry.

The large index is dropped, then built (plan D4)
================================================

SQL cannot read the volume's free space here, and coord's migration classifier
rejects a catalog read through ``op.get_bind()``, so the plan made the room
check at LAND time, from CloudWatch ``FreeStorageSpace``. At 22 GB or more the
large index would be rebuilt with ``REINDEX``, whose worst-case peak (a new
~10.8 GB index beside the old one, plus its sort spill and WAL) is about 25 GB.
Below 22 GB that is no longer worst-case-safe on a volume where running out of
WAL space is a PANIC, and the reading above is at that threshold and falling, so
this revision uses the plan's fallback::

    DROP INDEX CONCURRENTLY IF EXISTS coord.idx_test_results_repo_test_observed
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_test_results_repo_test_observed
        ON coord.test_results (repo, test_id, observed_at DESC)

The drop returns the old index's ~27 GB before the build needs any. The cost:
coord's per-test history probe has no ordered index until the build ends, so it
falls back to ``idx_test_results_repo_head`` with a residual filter, and the
flakiness read and the duration predictor may time out (``history_read:
failed``) for that window. That is a bounded outage of a read, not a wrong
answer.

Neither statement is caught. A failed ``CREATE INDEX CONCURRENTLY`` leaves an
INVALID index under the LIVE name, which the ``_ccnew`` / ``_ccold`` drops never
touch, and stamping past it would leave the per-test probe without its index for
good. So a failed build fails the revision UNSTAMPED, and the next migrate run's
drop of the live name clears that invalid index before building again. The
``_ccnew`` / ``_ccold`` drops are kept for this index too, for the leftovers of
any earlier ``REINDEX`` of it.

How production applies it: expect UNKNOWN
=========================================

``.github/workflows/migrate.yml`` runs ``alembic upgrade head`` in a one-shot
migrator task. Two rebuilds and one build scan the ~20 GB heap five times and
write an 8-11 GB index, roughly 30-60+ minutes, which outlives that workflow's 900 s
waiter: expect the run to report the outcome as UNKNOWN and fail. That is not
a failed apply. Until a later migrate run succeeds, ``deploy-web.yml``'s
``schema-order`` job holds web deploys and coord's deploy drift gate holds coord
deploys.

Recovery: never stop or re-dispatch the migrator while its task runs (a second
one only waits on the migration lock and reports UNKNOWN too). Once the task has
stopped, dispatch ``migrate.yml`` once: at head it is a no-op that exits 0 and
lifts both holds. The 03:00Z nightly run does the same if nobody dispatches.
Confirm with two signals: alembic at head, and free storage up by 15 GB or more
across the apply.

Downgrade is a no-op
====================

A rebuilt or re-created index is the same index, so there is nothing to undo.
``migration-reversal.yml`` replays upgrade, downgrade -1, upgrade; the second
upgrade simply rebuilds again, instantly on CI's empty table.

Classifier disposition
======================

Expected coord migration-classifier verdict: **Reject**, so the PR takes the
escalate-evidence path rather than AutoSafe. The classifier admits no
session-level ``SET`` or ``RESET`` (it recognizes only ``SET LOCAL`` timeouts),
no ``DROP`` (destructive) and no ``REINDEX`` (unrecognized, fail-closed). The
guarded ``CREATE INDEX CONCURRENTLY IF NOT EXISTS`` is the one form it admits. Every
SQL string is still a static literal at its ``op.execute`` call site, with no
catalog read and no f-string, so those three verbs are the only reasons it has.

Hand-authored, never ``--autogenerate``d. Every statement is schema-qualified
``coord.``.
"""

import logging
from collections.abc import Sequence

from sqlalchemy.exc import DBAPIError

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_test_results_reindex_01"
down_revision: str | None = "prcheckruns_suite_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

logger = logging.getLogger("alembic.runtime.migration")

#: The start of the one line a failed rebuild logs (plan D3). Grep the migrator
#: log for it after the apply.
FAILURE_MARKER = "coord_test_results_reindex_01: REINDEX FAILED"


#: SQLSTATE class 42, "syntax error or access rule violation". It covers
#: ``insufficient_privilege`` (42501: the migrator role does not own
#: ``coord.test_results``) and ``undefined_table`` (42P01, which is what
#: ``REINDEX INDEX`` raises for a renamed or missing index). An error in this
#: class happens again on every attempt, so the revision must not stamp past it.
#: Every other class can come out differently next time: a timeout or cancel
#: (57014), a lock wait (55P03), a uniqueness failure while building (23505), or
#: a disconnect (08).
PERMANENT_SQLSTATE_CLASS = "42"


def _is_permanent(exc: DBAPIError) -> bool:
    """True when the error would fail the same way on every attempt."""
    pgcode = getattr(exc.orig, "pgcode", None)
    return isinstance(pgcode, str) and pgcode.startswith(PERMANENT_SQLSTATE_CLASS)


def _log_failed_rebuild(index_name: str, exc: DBAPIError) -> None:
    """Log ONE line naming the index, what was done, and the database error."""
    outcome = (
        "re-raising it, so the revision is NOT stamped"
        if _is_permanent(exc)
        else "continued"
    )
    logger.error(
        "%s for coord.%s; dropped its _ccnew and _ccold leftovers, if any, and "
        "%s. Error: %s",
        FAILURE_MARKER,
        index_name,
        outcome,
        " ".join(str(exc.orig).split()),
    )


def _raise_if_permanent(exc: DBAPIError) -> None:
    """Re-raise an error that would fail the same way on every attempt.

    The handler has already dropped the leftovers and logged the failure. A
    re-raise here fails the revision UNSTAMPED, so the next migrate run tries
    again once the cause (an ownership or a name) is fixed, rather than
    stamping a revision that rebuilt nothing.
    """
    if _is_permanent(exc):
        raise exc


def upgrade() -> None:
    """Rebuild two indexes and re-create the large one, smallest first.

    A failed ``REINDEX`` does not stop the rest; a failed drop-then-create of the
    large index fails the revision unstamped.

    Every statement is spelled out as a literal at its ``op.execute`` call site,
    never looped over a table: coord's migration classifier and the
    schema-argument hook only read a literal there.
    """
    with op.get_context().autocommit_block():
        # This revision's own bound on every statement below, whatever the
        # migrator's role sets ("Bounded waits" above). Session-level, so it
        # outlives each autocommit statement; reset at the end of the block.
        op.execute("SET statement_timeout = '4h'")

        # 1 of 3: idx_test_results_repo_observed (2.19 GB reusable).
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS "
            "coord.idx_test_results_repo_observed_ccnew"
        )
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS "
            "coord.idx_test_results_repo_observed_ccold"
        )
        try:
            op.execute(
                "REINDEX INDEX CONCURRENTLY coord.idx_test_results_repo_observed"
            )
        except DBAPIError as exc:
            op.execute(
                "DROP INDEX CONCURRENTLY IF EXISTS "
                "coord.idx_test_results_repo_observed_ccnew"
            )
            op.execute(
                "DROP INDEX CONCURRENTLY IF EXISTS "
                "coord.idx_test_results_repo_observed_ccold"
            )
            _log_failed_rebuild("idx_test_results_repo_observed", exc)
            _raise_if_permanent(exc)

        # 2 of 3: test_results_pkey (1.46 GB reusable).
        op.execute("DROP INDEX CONCURRENTLY IF EXISTS coord.test_results_pkey_ccnew")
        op.execute("DROP INDEX CONCURRENTLY IF EXISTS coord.test_results_pkey_ccold")
        try:
            op.execute("REINDEX INDEX CONCURRENTLY coord.test_results_pkey")
        except DBAPIError as exc:
            op.execute(
                "DROP INDEX CONCURRENTLY IF EXISTS coord.test_results_pkey_ccnew"
            )
            op.execute(
                "DROP INDEX CONCURRENTLY IF EXISTS coord.test_results_pkey_ccold"
            )
            _log_failed_rebuild("test_results_pkey", exc)
            _raise_if_permanent(exc)

        # 3 of 3: idx_test_results_repo_test_observed (16.29 GB reusable), last.
        # Plan D4's drop-then-create form, not a REINDEX ("The large index is
        # dropped, then built" above): the drop returns the old index's ~27 GB
        # before the build needs any. Neither statement is caught, so a failed
        # build fails the revision UNSTAMPED and the next run's drop of the live
        # name clears the INVALID index it left before building again.
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS "
            "coord.idx_test_results_repo_test_observed_ccnew"
        )
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS "
            "coord.idx_test_results_repo_test_observed_ccold"
        )
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS coord.idx_test_results_repo_test_observed"
        )
        op.execute(
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_test_results_repo_test_observed "
            "ON coord.test_results (repo, test_id, observed_at DESC)"
        )

        # Back to the connection's configured value before alembic stamps.
        op.execute("RESET statement_timeout")


def downgrade() -> None:
    """No-op: a rebuilt index is the same index, so there is nothing to undo."""
