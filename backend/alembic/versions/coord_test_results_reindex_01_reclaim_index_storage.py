"""coord.test_results — rebuild three bloated indexes concurrently to reclaim storage

Revision ID: coord_test_results_reindex_01
Revises: coord_ci_runs_head_sha_idx_01
Create Date: 2026-11-08

Storage reclamation, Phase 1 of plan
``2026-11-08-coord-test-results-indexes-hold-21-gb-of-empty-pages``. DDL only:
no table, column, query or route changes, and nothing is created or removed
for good. Three existing indexes are rebuilt with ``REINDEX INDEX
CONCURRENTLY``; each comes back under the same name with the same definition,
without its empty pages.

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

The indexes
===========

* ``test_results_pkey`` ``(id)``: the table's primary key, created unnamed in
  ``runtests_effect_tables_01``, so it carries PostgreSQL's default name.
* ``idx_test_results_repo_observed`` ``(repo, observed_at DESC)`` and
  ``idx_test_results_repo_test_observed`` ``(repo, test_id, observed_at DESC)``,
  both from ``coord_test_results_idx_01``.

``REINDEX ... CONCURRENTLY`` keeps each index's definition and dependencies; the
primary key constraint moves to the rebuilt index.

Order and lock posture
======================

Smallest first: ``idx_test_results_repo_observed``, then ``test_results_pkey``,
then ``idx_test_results_repo_test_observed``. The two small rebuilds free about
3.7 GB before the large one needs its temporary space (its new index, its sort
spill and WAL), which is the peak of the whole revision. One index per
statement, never ``REINDEX TABLE CONCURRENTLY``: the table form keeps every new
index beside its old one until the end, so its peak is the sum of all of them.

Each rebuild takes ``SHARE UPDATE EXCLUSIVE`` on the table, so reads and writes
of ``coord.test_results`` carry on throughout and the old index serves until
the new one replaces it. ``REINDEX ... CONCURRENTLY`` and ``DROP INDEX
CONCURRENTLY`` cannot run inside a transaction, hence
``op.get_context().autocommit_block()``.

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

Each ``REINDEX`` is wrapped. On a database error the revision drops that
index's ``_ccnew`` and ``_ccold`` again, logs ONE line starting with
``FAILURE_MARKER`` (below) that names the index and the error, and goes on to
the next index; the revision then stamps. An unstamped maintenance revision
would be retried by every later migrator run, holding every later ``coord.*``
migration and every web deploy behind it, and re-spending transient space on a
nearly full volume each time. The cost is that a failure stamps anyway; the
plan's two signals catch it: free space does not rise, and that line is in the
migrator log. A KILLED task raises nothing, so its revision stays unstamped and
the next run's leftover drops clean up after it.

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

No in-revision free-space guard
===============================

SQL cannot read the volume's free space here, and coord's migration classifier
rejects a catalog read through ``op.get_bind()``, so the room check is made at
LAND time, from the database's free-storage metric read just before the land
(plan D4). At 22 GB or more, this revision lands as written. Below 22 GB the
large rebuild is no longer worst-case-safe, and before landing its ``REINDEX``
is replaced by::

    DROP INDEX CONCURRENTLY IF EXISTS coord.idx_test_results_repo_test_observed
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_test_results_repo_test_observed
        ON coord.test_results (repo, test_id, observed_at DESC)

The drop returns the old index's space before the build needs any; coord's
per-test history reads run without their ordered index until the build ends.

The existing handler does not cover that swap: a failed ``CREATE INDEX
CONCURRENTLY`` leaves an INVALID index under the LIVE name, which the handler's
``_ccnew`` / ``_ccold`` drops never touch. So the swap must do one of two
things. Either it leaves the ``CREATE`` outside the ``try``, so a failed build
fails the revision unstamped and the next migrate run's drop of the live name
clears the invalid index before building again. Or its handler also drops the
invalid index under the live name and logs the index as ABSENT, since per-test
history reads then run without it until a follow-up rebuilds it. That swap
makes a new head, so it needs its own review, and the statement list the test
pins moves with it.

How production applies it: expect UNKNOWN
=========================================

``.github/workflows/migrate.yml`` runs ``alembic upgrade head`` in a one-shot
migrator task. Three rebuilds scan the ~20 GB heap six times and write an
8-11 GB index, roughly 30-60+ minutes, which outlives that workflow's 900 s
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

A rebuilt index is the same index, so there is nothing to undo.
``migration-reversal.yml`` replays upgrade, downgrade -1, upgrade; the second
upgrade simply rebuilds again, instantly on CI's empty table.

Classifier disposition
======================

Expected coord migration-classifier verdict: **Reject**, so the PR takes the
escalate-evidence path rather than AutoSafe. The classifier admits no
session-level ``SET`` or ``RESET`` (it recognizes only ``SET LOCAL`` timeouts),
no ``DROP`` (destructive) and no ``REINDEX`` (unrecognized, fail-closed). Every
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
down_revision: str | None = "coord_ci_runs_head_sha_idx_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

logger = logging.getLogger("alembic.runtime.migration")

#: The start of the one line a failed rebuild logs (plan D3). Grep the migrator
#: log for it after the apply.
FAILURE_MARKER = "coord_test_results_reindex_01: REINDEX FAILED"


def _log_failed_rebuild(index_name: str, exc: DBAPIError) -> None:
    """Log ONE line naming the index, what was done, and the database error."""
    logger.error(
        "%s for coord.%s; dropped its _ccnew and _ccold leftovers, if any, and "
        "continued. Error: %s",
        FAILURE_MARKER,
        index_name,
        " ".join(str(exc.orig).split()),
    )


def upgrade() -> None:
    """Rebuild three indexes, smallest first; a failed one does not stop the rest.

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

        # 3 of 3: idx_test_results_repo_test_observed (16.29 GB reusable), last
        # because its rebuild needs the most temporary space.
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS "
            "coord.idx_test_results_repo_test_observed_ccnew"
        )
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS "
            "coord.idx_test_results_repo_test_observed_ccold"
        )
        try:
            op.execute(
                "REINDEX INDEX CONCURRENTLY coord.idx_test_results_repo_test_observed"
            )
        except DBAPIError as exc:
            op.execute(
                "DROP INDEX CONCURRENTLY IF EXISTS "
                "coord.idx_test_results_repo_test_observed_ccnew"
            )
            op.execute(
                "DROP INDEX CONCURRENTLY IF EXISTS "
                "coord.idx_test_results_repo_test_observed_ccold"
            )
            _log_failed_rebuild("idx_test_results_repo_test_observed", exc)

        # Back to the connection's configured value before alembic stamps.
        op.execute("RESET statement_timeout")


def downgrade() -> None:
    """No-op: a rebuilt index is the same index, so there is nothing to undo."""
