"""Partial index for repair_cause's re-run ledger read on coord.pr_events.

``qontinui-coord`` ``pr_merge/repair_cause.rs`` ``RERUNS_SPENT_SQL`` asks, for
every open PR, which heads already spent their one re-run: the
``repair_decision`` rows whose ``payload->>'action'`` is ``rerun``. Without an
index it walks every ``repair_decision`` row of each PR (about 245 per PR, 13k
new rows a day fleet-wide, ``skip`` and ``classified`` rows dominating) and
filters on the JSON key. Measured in production on 2026-11-02 that is about 180k
buffers per run: 0.3 to 0.9 s with warm pages, 55 s cold against coord's 60 s
``statement_timeout``, so the read failed about 12 times an hour and
``rerun_spent_on_head`` read UNKNOWN. The fleet holds only about 480 ``rerun``
rows.

Index shape
------------------------------------------------------------------------------
::

    (repo, pr_number, (payload->>'head_sha'))
    WHERE event_kind = 'repair_decision' AND payload->>'action' = 'rerun'

The partial predicate holds the two literals every reader spells, so the index
holds only the ~480 rows the read wants. ``head_sha`` rides as an expression
column, as in ``coord_pr_events_hydration_head_idx``, but that does NOT make the
read index-only. The statement selects ``payload->>'head_sha'``, which needs the
whole ``payload`` column, and an expression column cannot supply it. So
``EXPLAIN`` after deploy shows this index used through an ``Index Scan`` or a
bitmap scan (with ~718 keys a merge join over it is also possible), never an
``Index Only Scan``, with one heap fetch per matching row. That is expected,
not a broken index: the fetches are bounded by the ~480 matching rows, against
~245 rows walked per PR without it. The coord-side statement must spell
``'rerun'`` as a literal (a bound parameter cannot be proven to imply the
predicate under a generic plan); the coord change pins that with a test.

Mechanics
------------------------------------------------------------------------------
``CREATE INDEX CONCURRENTLY`` inside ``autocommit_block()``: ``coord.pr_events``
is a hot append-heavy table, and an in-transaction build would take a
write-blocking ``SHARE`` lock. Additive and forward-only: ``upgrade`` creates the
index ``IF NOT EXISTS``, ``downgrade`` drops it ``IF EXISTS``. Every reader is
correct, only slower, without it, so deploy order is not load-bearing for
correctness; the coord literal change is what turns the speed-up on.

The index is small, but the build is not. ``CONCURRENTLY`` reads the whole
``coord.pr_events`` heap twice. While it runs it holds back vacuum and blocks
``VACUUM coord.pr_events``, and a second migrator starting meanwhile can kill it
(see ``pr_events_mergeability_head_idx_01`` for both).

A killed build leaves an INVALID index of the same name. ``IF NOT EXISTS`` then
skips it and reports success, so re-running alembic does NOT repair it. Check
``indisvalid`` after the deploy instead::

    SELECT c.relname, i.indisvalid
      FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
     WHERE c.relname = 'idx_pr_events_repair_rerun';

``false`` means:

1. Wait until ``pg_stat_progress_create_index`` is empty (a live build also
   reads ``false``).
2. Run ``DROP INDEX CONCURRENTLY coord.idx_pr_events_repair_rerun``. Never use a
   plain ``DROP INDEX``: its ACCESS EXCLUSIVE lock queues behind any long reader
   and stalls every coord read and write on the table behind it.
3. Re-run the ``CREATE INDEX CONCURRENTLY`` statement in ``upgrade()`` by hand.

Revision ID: repair_rerun_01_partial_idx
Revises: fpl_02b
Create Date: 2026-11-08

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "repair_rerun_01_partial_idx"
down_revision: str | None = "fpl_02b"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Additive: one CONCURRENTLY partial expression index. Idempotent."""
    with op.get_context().autocommit_block():
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS
                idx_pr_events_repair_rerun
            ON coord.pr_events (
                repo,
                pr_number,
                (payload->>'head_sha')
            )
            WHERE event_kind = 'repair_decision'
              AND payload->>'action' = 'rerun'
            """
        )


def downgrade() -> None:
    """Reverse the additive index. Table + all other indexes survive."""
    with op.get_context().autocommit_block():
        op.execute("DROP INDEX CONCURRENTLY IF EXISTS coord.idx_pr_events_repair_rerun")
