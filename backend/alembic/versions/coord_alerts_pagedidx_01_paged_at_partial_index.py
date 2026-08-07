"""coord.alerts: partial index on ``paged_at`` for the alert-pageout counts.

Phase 3 (web side) of plan
``qontinui-dev-notes/plans/2026-08-06-coord-alert-heal-lateral-jsonb-aggregate.md``.
Additive, index-only, forward-only.

**This closes a half-deployed phase.** Phase 3 was specified in two parts, and
only the coord half shipped (qontinui-coord#1424, merged and deployed): the
``WHERE paged_at IS NOT NULL`` hoist and the ``cached_swr`` memo are live in
production right now, while this index — the other half, specified verbatim by
the plan as::

    CREATE INDEX CONCURRENTLY idx_alerts_paged
    ON coord.alerts (paged_at) WHERE paged_at IS NOT NULL

— had not landed. coord is explicitly waiting for it: the doc comment above
``COUNTS_SQL`` in ``alert_pageout_metrics.rs`` names this index by its exact
definition and says the hoist "only lets the planner skip the rows up front
(and, once ``idx_alerts_paged`` ... lands from qontinui-web alembic, use an
index instead of a 1121 MB seq scan)".

The plan's deploy-order note said to land the migration FIRST and hold the
coord PR as DRAFT. That is not what happened, and it does not matter here: the
plan's own 2026-08-07 clarification records that this coupling is
**one-directional and about magnitude, not correctness** — the coord change
does not READ the index and does not depend on it, so coord landing first is
safe; it simply under-delivers until the index arrives. This is NOT the
read-a-new-column class where shipping the consumer first is a hard error.

The statement this serves
==========================================================================

``alert_pageout_metrics::COUNTS_SQL``, as shipped on ``qontinui-coord``
``origin/main`` ``4f49f973``::

    SELECT
        count(*) FILTER (WHERE paged_at IS NOT NULL
              AND detail -> 'pageout' ->> 'state' = 'delivered')::bigint,
        count(*) FILTER (WHERE paged_at IS NOT NULL
              AND detail -> 'pageout' ->> 'state' = 'undeliverable')::bigint,
        count(*) FILTER (WHERE paged_at IS NOT NULL
              AND detail -> 'pageout' ->> 'state' IS DISTINCT FROM 'delivered'
              AND detail -> 'pageout' ->> 'state' IS DISTINCT FROM 'undeliverable')::bigint
    FROM coord.alerts
    WHERE paged_at IS NOT NULL

Phase 1 measured it at **7.906 AAS — the largest single statement on the prod
instance** — with a 7,163 ms isolated ``EXPLAIN`` and 4,228 leg timeouts, back
when it had no ``WHERE`` and no memo at all.

What this index is worth NOW — the honest accounting
==========================================================================

**The two shipped halves already captured most of the win. This index is the
residual — but it is a residual worth having, for a reason that is about
buffers rather than CPU.** Phase 3 has three independent levers and it is worth
being precise about which one did what:

1. **The ``cached_swr`` memo (shipped) removed the FREQUENCY.** The statement
   went from running on every assemble — with ~8 concurrent copies in flight at
   the measured peak — to at most one recompute per 60 s TTL per replica. This
   is by far the largest factor, and it is already banked.

2. **The ``WHERE paged_at IS NOT NULL`` hoist (shipped) removed the PER-ROW
   JSONB COST.** Before the hoist, ``detail -> 'pageout' ->> 'state'`` was
   evaluated inside three separate ``count(*) FILTER`` clauses on **all**
   1.47 M rows. After it, the outer predicate cuts the input to the aggregates
   down to the paged rows first, so the jsonb traversal runs on **3,699 rows**
   (measured 2026-08-07: 3,699 of 1,474,452 carry a non-NULL ``paged_at`` —
   **0.25%**). That is the difference between the plan's 10.7 s
   jsonb-on-every-row shape and a plain NULL check.

3. **This index removes what is left: THE SCAN ITSELF.** Without it the hoisted
   predicate is still evaluated by walking all 143,535 pages / 1121 MB of heap.
   The plan measured a bare seq scan of this table at ~778 ms, so that is
   roughly the size of the remaining cost, against the 7,163 ms it started at.
   In CPU terms this is therefore a **~10% residual, not the headline** — and
   it must not be reported as the fix for the 7.906 AAS.

So why land it? Two reasons that survive the small CPU number:

* **It is the only thing that removes the 1.1 GB of buffer traffic.** The
  plan's leading (explicitly unproven) hypothesis for the instance's collapse is
  ``LWLock`` contention from concurrent GB-scale seq scans thrashing each other
  out of ``shared_buffers``. Under that reading the interesting quantity is
  pages touched, not CPU seconds — and this index is the whole win for this
  statement, taking it from 143,535 pages to a handful.
* **The sibling retention prune does NOT help here, by construction.** Its own
  migration says so: a ``DELETE`` frees tuples but does not shrink the relation
  file, and no ``pg_repack`` is reachable from a migration. So after the prune
  this statement would still walk the same 1121 MB. **This index is the only
  change in this branch that removes that read for this query.**

A third, smaller reason: it makes the statement's cost independent of table
size, so a cold memo, an SWR refresh storm, or any future regression that
re-widens the frequency cannot put a GB-scale scan back on the box.

Key column, and why there is no ``INCLUDE``
==========================================================================

The key is ``(paged_at)`` and there is no ``INCLUDE``, exactly as the plan
specifies. Note honestly that the key does **no selection work** for this
query: the query has no range or ordering on ``paged_at``, so the partial
predicate does all of it and the key is along for the ride (it does leave the
index usable for a future time-ranged page-out read). An index-only scan is
unreachable regardless, because all three buckets must read ``detail`` from the
heap — the same reasoning ``coord_pg_overload_idx_02`` used to skip ``INCLUDE``.

At 0.25% selectivity the index holds ~3,699 entries and is a few tens of KB.

``CONCURRENTLY``, and the INVALID-index trap
==========================================================================

``CREATE INDEX CONCURRENTLY`` rather than a plain build: ``coord.alerts`` is a
live table under a 2 s-tick writer, and a plain ``CREATE INDEX`` would take a
write-blocking ``SHARE`` lock — worsening the very saturation this phase exists
to relieve. CONCURRENTLY cannot run inside a transaction and ``env.py`` wraps
the whole migration batch in one, hence ``op.get_context().autocommit_block()``
(same precedent as ``coord_pg_overload_idx_01`` / ``_02``). On a fresh CI
database the table is empty, so the build is instant.

Note on a killed CONCURRENTLY build: a partial build leaves an **INVALID** index
of the same name, which ``IF NOT EXISTS`` will then happily skip — producing a
migration that reports success while the index never serves a query. Verify with
``pg_index.indisvalid``, not mere existence; if it is invalid, ``DROP INDEX`` it
and re-run.

Revision ID: coord_alerts_pagedidx_01
Revises: coord_alerts_flakeidx_01
Create Date: 2026-08-07

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_alerts_pagedidx_01"
down_revision: str | Sequence[str] | None = "coord_alerts_flakeidx_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Additive: one CONCURRENTLY partial index on ``paged_at``. Idempotent."""
    with op.get_context().autocommit_block():
        # Plain literal, never an f-string: the `alembic-schema-arg-gate`
        # pre-commit hook parses the raw SQL inside `op.execute(...)` to prove
        # every CREATE/DROP names its schema, and an interpolated string is not
        # statically analysable.
        #
        # The predicate is character-for-character the outer WHERE that
        # alert_pageout_metrics::COUNTS_SQL now issues.
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS
                idx_alerts_paged
            ON coord.alerts (paged_at)
            WHERE paged_at IS NOT NULL
            """
        )


def downgrade() -> None:
    """Reverse the additive index. The table and every other index survive."""
    with op.get_context().autocommit_block():
        op.execute("DROP INDEX CONCURRENTLY IF EXISTS coord.idx_alerts_paged")
