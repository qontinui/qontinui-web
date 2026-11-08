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
stays at the ~480 rows the read wants. ``head_sha`` rides as an expression
column, as in ``coord_pr_events_hydration_head_idx``, so ``SELECT DISTINCT``
needs no heap visit for the key (check ``EXPLAIN`` after deploy; the heap fetch is
bounded by the ~480 matching rows either way). The coord-side statement must spell ``'rerun'``
as a literal (a bound parameter cannot be proven to imply the predicate under a
generic plan); the coord change pins that with a test.

Mechanics
------------------------------------------------------------------------------
``CREATE INDEX CONCURRENTLY`` inside ``autocommit_block()``: ``coord.pr_events``
is a hot append-heavy table, and an in-transaction build would take a
write-blocking ``SHARE`` lock. Additive and forward-only: ``upgrade`` creates the
index ``IF NOT EXISTS``, ``downgrade`` drops it ``IF EXISTS``. Every reader is
correct, only slower, without it, so deploy order is not load-bearing for
correctness; the coord literal change is what turns the speed-up on.

Note on a killed CONCURRENTLY build: a partial build leaves an INVALID index of
the same name, which ``IF NOT EXISTS`` would then skip. If that happens,
manually ``DROP INDEX`` the invalid index and re-run.

Revision ID: repair_rerun_01_partial_idx
Revises: coord_test_result_runs_01
Create Date: 2026-11-08

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "repair_rerun_01_partial_idx"
down_revision: str | None = "coord_test_result_runs_01"
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
