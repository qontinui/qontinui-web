"""coord.alerts: partial expression index for the red-main flake-heal aggregate.

Phase 5 of plan
``qontinui-dev-notes/plans/2026-08-06-coord-alert-heal-lateral-jsonb-aggregate.md``.
Additive, index-only, forward-only. No coord change accompanies it and none
should be made (see "How this index is silently defeated" below).

The statement this serves
==========================================================================

``qontinui-coord/src/red_main_metrics.rs`` ``compute_flake_healed`` — the
recompute behind ``coord_red_main_flake_healed_total{repo, workflow}``::

    SELECT COALESCE(NULLIF(detail->>'repo', ''),
                    regexp_replace(alert_key, '^red_main:', '')) AS repo,
           wf.workflow AS workflow,
           COUNT(*)::BIGINT AS healed
    FROM coord.alerts,
         LATERAL jsonb_array_elements_text(...) AS wf(workflow)
    WHERE kind = 'red_main' AND detail->>'suspected_flake' = 'true'
    GROUP BY 1, 2

``coord.alerts`` had no index able to serve that predicate. Its five indexes
are ``alerts_pkey (id)``, ``uq_alerts_active_key (alert_key) WHERE resolved_at
IS NULL``, ``idx_alerts_active_severity (severity, last_seen_at) WHERE
resolved_at IS NULL``, ``idx_alerts_machine (device_id) WHERE device_id IS NOT
NULL`` and ``idx_alerts_tenant_id (tenant_id) WHERE tenant_id IS NOT NULL``.
The two ``resolved_at IS NULL`` partials are excluded because this query
deliberately reads **resolved rows too** — the resolved row IS the durable
flake record; the other three cover neither ``kind`` nor any ``detail``
expression. So every candidate was excluded by construction and the statement
ran a full sequential scan of the whole heap.

What this index is actually worth — stated honestly
==========================================================================

**It is a small constant-factor removal, NOT a growth-curve fix, and it must
not be reported as the fix for the AAS incident.**

An earlier draft of the plan justified this index as turning an ``O(N)`` scan
into an ``O(K)`` probe "on an intrinsically expensive query". Measurement on
prod refuted that framing and it is withdrawn. ``kind = 'red_main'`` is a plain
text comparison and is evaluated FIRST, so the ``LATERAL``, the ``CASE``, the
``jsonb_typeof`` and the ``regexp_replace`` only ever run on the ~219 rows of
that kind. The statement's measured cost in isolation was **778 ms**, and every
millisecond of it was the sequential scan of ~1121 MB of heap — nothing more.

What this index removes is therefore **one of several concurrent whole-table
scans** from an instance measured in ``LWLock``-dominated congestion, on a
statement that after the Phase 2a memo repair recomputes at most once per 60 s
per replica. That is worth landing because it is very nearly free and because
it makes the statement structurally sublinear *before* ``K`` ever grows. It is
not a growth-curve fix.

``K = 0``, and why an index over zero rows is still the right thing to build
==========================================================================

Measured on prod 2026-08-07 (read-only ECS probe, throwaway task-def, since
deregistered), over **1,474,452** rows of ``coord.alerts``:

* ``kind = 'red_main' AND detail->>'suspected_flake' = 'true'`` → **0 rows**
* ``detail->>'suspected_flake' = 'true'`` (no kind guard) → **0 rows**
* ``detail ? 'suspected_flake'`` (key present at ANY value) → **0 rows**
* ``kind = 'red_main'`` → 219 rows, of which **0** carry ``flake_workflows``,
  ``rerun_records`` or ``last_rerun_workflow``

So the producer (``stuck_pr_watcher::stamp_suspected_flake_on_heal``) has never
landed a stamp in production. The reader is correct and correctly wired; the
rail UPSTREAM of it has simply never fired. ``K`` is zero, not merely small.

A partial index whose predicate currently matches no row is a perfectly
ordinary index, and all three properties that matter here hold:

1. ``CREATE INDEX CONCURRENTLY`` builds it empty and marks it **valid**.
2. The planner may use it as soon as it can prove the query's ``WHERE``
   *implies* the index predicate. That is a **syntactic implication proof** over
   the parsed expressions — it consumes no statistics, which is exactly why an
   empty index is still eligible to be chosen.
3. Postgres evaluates the predicate **per row on every INSERT/UPDATE**, so
   entries appear the moment a row starts matching. **No ``REINDEX`` and no
   rebuild is needed when the stamp path first fires.**

The one real consequence is diagnostic, and it will mislead anyone who does not
know to expect it: with no tuples to return, **``idx_scan`` climbing is the only
usable liveness signal**, and ``idx_tup_read`` / ``idx_tup_fetch`` will sit at
**0 legitimately**. Do NOT read a zero there as "the index is unused".

Legality of the expression in a partial predicate
==========================================================================

A partial-index predicate must be IMMUTABLE. ``detail->>'suspected_flake'``
desugars to ``pg_catalog.jsonb_object_field_text``, and
``SELECT provolatile FROM pg_proc WHERE proname='jsonb_object_field_text'``
returns **``i``** (verified on the prod instance, PostgreSQL 16.13, in the same
probe as the census above). So the predicate is legal, and the build will not
fail with "functions in index predicate must be marked IMMUTABLE".

Key column, and why there is no ``INCLUDE``
==========================================================================

The key is ``(kind)`` and there is deliberately no ``INCLUDE``. The partial
predicate does all of the selection, so the key contributes no filtering — it is
a single cheap column carried so the index is an ordinary b-tree. An index-only
scan is unreachable regardless, because the ``LATERAL`` must read ``detail``
from the heap on every surviving row; an ``INCLUDE`` would therefore only add
bytes without ever avoiding a heap visit. Same reasoning as
``coord_pg_overload_idx_02_observation_query_indexes``.

How this index is silently defeated
==========================================================================

Postgres must prove the query's ``WHERE`` implies this predicate, on the PARSED
expression. Rewriting ``detail->>'suspected_flake' = 'true'`` as
``detail->'suspected_flake' = 'true'::jsonb``, or moving ``kind`` into a bind
parameter, drops the index and silently restores the full sequential scan —
**with no error, no failing test, and no log line**. The Rust SQL literal and
this predicate must stay character-comparable.

Do not guard that with ``coord_metrics_render_seconds{leg="red_main"}``: Phase
2a moved the leg onto ``cached_swr``, and ``timed_leg`` times the CALLER, so
that timer now measures a memo hit and would never move. The in-process signal
that still responds is ``coord_metrics_refresh_seconds{key="red_main_held"}``,
which times the detached recompute.

``CONCURRENTLY``, and the INVALID-index trap
==========================================================================

``CREATE INDEX CONCURRENTLY`` rather than a plain build: ``coord.alerts`` is a
live table under a 2 s-tick writer, and a plain ``CREATE INDEX`` would take a
write-blocking ``SHARE`` lock — worsening the very saturation this plan exists
to relieve. CONCURRENTLY cannot run inside a transaction, and ``env.py`` wraps
the whole migration batch in one, hence ``op.get_context().autocommit_block()``
(same precedent as ``coord_pg_overload_idx_01`` / ``_02``). On a fresh CI
database the table is empty, so the build is instant.

Note on a killed CONCURRENTLY build: a partial build leaves an **INVALID** index
of the same name, which ``IF NOT EXISTS`` will then happily skip — producing a
migration that reports success while the index never serves a query. Verify with
``pg_index.indisvalid``, not mere existence; if it is invalid, ``DROP INDEX`` it
and re-run.

Revision ID: coord_alerts_flakeidx_01
Revises: coord_alerts_retention_01
Create Date: 2026-08-07

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_alerts_flakeidx_01"
down_revision: str | Sequence[str] | None = "coord_alerts_retention_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Additive: one CONCURRENTLY partial expression index. Idempotent."""
    with op.get_context().autocommit_block():
        # Written as a plain literal, never an f-string: the
        # `alembic-schema-arg-gate` pre-commit hook parses the raw SQL inside
        # `op.execute(...)` to prove every CREATE/DROP names its schema, and an
        # interpolated string is not statically analysable.
        #
        # The predicate is character-for-character the reader's WHERE clause
        # (red_main_metrics::compute_flake_healed). Postgres proves implication
        # syntactically, so any divergence here silently disables the index.
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS
                idx_alerts_red_main_flake_healed
            ON coord.alerts (kind)
            WHERE kind = 'red_main'
              AND detail->>'suspected_flake' = 'true'
            """
        )


def downgrade() -> None:
    """Reverse the additive index. The table and every other index survive."""
    with op.get_context().autocommit_block():
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS coord.idx_alerts_red_main_flake_healed"
        )
