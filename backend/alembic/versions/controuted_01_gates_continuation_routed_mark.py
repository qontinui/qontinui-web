"""coord.gates — continuation_routed_at / continuation_route, the durable routed mark

Revision ID: controuted_01_gates_continuation_routed_mark
Revises: coord_ci_runs_head_sha_idx_01
Create Date: 2026-11-10

Phase 0 (web slice, lands FIRST) of plan
``2026-11-10-a-cleared-gate-whose-clearance-fanout-never-ran-is-never-re-driven``,
design point D0. Authored by alembic in ``qontinui-web`` — coord authors zero
``coord.*`` DDL (served policy ``production-and-cost``
``alembic-sole-authorship``).

## What this is for

A gate that clears runs a clearance fanout (``route_cleared_continuation`` in
coord) that routes its continuation: spawn published, notify inserted, hold
stamped, ``merge_pr`` enqueued / prior-blocked / held, executor ``Dispatch``,
post-merge-scope ``Stop``, or moot-cancel. When that fanout never runs, the
gate reads ``never_dispatched`` forever with no holder, no hold stamp and no
notify — and nothing re-drives it. Several of those arms leave no stamp of
their own, so "was this cleared continuation routed?" cannot be inferred from
the existing columns; the plan's first draft tried and would have refilled
every ``LIMIT 25`` re-drive batch with already-routed rows.

Two nullable columns make it one durable fact:

- ``continuation_routed_at TIMESTAMPTZ NULL`` — when the fanout routed this
  gate's continuation. Every arm of ``route_cleared_continuation`` sets it (with
  ``continuation_route``) in one statement before returning. ``NULL`` means
  "never routed", which is the population the Phase 1 re-drive selects.
- ``continuation_route TEXT NULL`` — WHICH arm routed it, the value of
  ``ContinuationRoute::routed_label()`` in coord. Free text rather than a CHECK
  or enum: the label set is coord's to evolve, and a constraint here would turn
  a new coord arm into a cross-repo lockstep deploy.

## Why nullable, with no backfill

Unlike a counter read by ``<`` (``contspawn_01``), a NULL here MEANS something:
"no routed mark recorded". Existing gates predate the writer, so they have no
mark; the Phase 1 re-drive bounds its population by clearance age
(``cleared_at`` within 7 days) and the other unrouted predicates, not by this
column alone. The re-drive also CLAIMS a row by compare-and-set on
``continuation_routed_at IS NULL``, so the column carries no default: a default
would read as "already routed". A backfill would have to
guess a route for history, which is the inference D0 exists to replace.
``ADD COLUMN`` of a nullable column with no default is metadata-only on
PostgreSQL — no table rewrite on ``coord.gates``.

## NO index

The re-drive scan is anchored on ``verdict = 'cleared'`` within a 7-day
``cleared_at`` window and a set of continuation-lifecycle NULL tests;
``continuation_routed_at IS NULL`` is one more AND-term on that bounded set, at
``LIMIT 25`` per cycle. An index would cost a write on every routed stamp for a
predicate that is never the leading one — same posture as ``contstall_01`` and
``contspawn_01``. Phase 1 may add one if its measured shadow day says the scan
needs it.

## House conventions followed

Raw ``op.execute`` with ``ADD COLUMN IF NOT EXISTS`` / ``DROP COLUMN IF
EXISTS`` — mirrors ``contstall_01_gates_continuation_expiry``,
``contcancel_01_gates_continuation_cancel_outcome`` and
``contspawn_01_gates_continuation_spawn_attempts`` (collision-safe and
order-safe against the separate coord consumer PR). Every statement names the
``coord`` schema explicitly, as the ``alembic-schema-arg-gate`` pre-commit hook
(``.pre-commit-hooks/check_alembic_schema_args.py``) requires.

The coord side reads these columns only AFTER this migration is live (the "web
migration FIRST" rule in ``alembic-sole-authorship``): a missing COLUMN, unlike
a missing table, sails through coord's boot and fails at query time.

Chains off the current single head ``coord_ci_runs_head_sha_idx_01`` (computed
by ``scripts/ci/count_alembic_heads.py`` on this branch 2026-11-10: exactly one
head across 738 revisions). coord re-points ``down_revision`` at land time if
the head moves — no head reservation or stacked-on label needed.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "controuted_01_gates_continuation_routed_mark"
down_revision: str | Sequence[str] | None = "coord_ci_runs_head_sha_idx_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the durable routed mark to coord.gates."""
    # Both nullable: NULL is the meaningful "never routed" reading the Phase 1
    # re-drive selects on. Set together, in one statement, by every arm of
    # coord's route_cleared_continuation.
    op.execute("""
        ALTER TABLE coord.gates
            ADD COLUMN IF NOT EXISTS continuation_routed_at TIMESTAMPTZ NULL,
            ADD COLUMN IF NOT EXISTS continuation_route TEXT NULL
        """)


def downgrade() -> None:
    """Drop the routed mark."""
    op.execute("""
        ALTER TABLE coord.gates
            DROP COLUMN IF EXISTS continuation_route,
            DROP COLUMN IF EXISTS continuation_routed_at
        """)
