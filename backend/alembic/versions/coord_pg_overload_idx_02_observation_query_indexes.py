"""coord PG overload fix #2: indexes for the hot observation/blast-radius reads.

LIVE PRODUCTION INCIDENT (2026-07-21). RDS (2 vCPU) pinned at 99.7% CPU with
**42.05 AAS** — ~21x the vCPU count, i.e. the instance was ~entirely CPU-bound
on a handful of unindexed reads. AWS Performance Insights "top SQL by DB load"
named six statements; this migration indexes all six. Every one of them is a
sort- or seq-scan-bound query over a continuously-growing append-only
``coord.*`` observation table, so the load grows with row count and does not
self-heal.

Why the PRIOR overload fix (``coord_pg_overload_idx_01_fanout_query_indexes``)
did not cover this
------------------------------------------------------------------------------
That migration added ``idx_pr_events_repo_pr_kind_created`` on
``(repo, pr_number, event_kind, created_at)`` for
``pr_merge::newest_block_reason_code``, whose predicate pins BOTH ``repo`` AND
``pr_number``. The two hot queries here
(``pr_merge/blast_radius_monitor.rs:140`` and ``:157``) are a genuinely
different shape:

* they have **no ``pr_number`` at all**, and
* ``repo`` is **optional** (``$3::text IS NULL OR repo = $3``) — the
  fleet-wide call passes NULL.

A ``repo``-led b-tree cannot serve a query whose leading column is unbound, so
the planner falls back to ``idx_pr_events_event_kind`` on
``(event_kind, created_at DESC)`` and scans **every** ``predicate_eval`` row
ever written (the single largest event kind), applying the
``payload->>'block_reason_code'`` and ``tenant_id`` filters row-by-row on the
heap. That is the 11.88 + 1.52 AAS. It is not a regression of the prior fix —
it is a shape the prior fix never looked at.

The six statements and the index each gets
------------------------------------------------------------------------------
1. **11.88 AAS** — ``blast_radius_monitor::list_blocks`` durable total::

       SELECT COUNT(*) FROM coord.pr_events
        WHERE event_kind = 'predicate_eval'
          AND payload->>'block_reason_code' = $1
          AND tenant_id = $2
          AND ($3::text IS NULL OR repo = $3)

5. **1.52 AAS** — the same predicate, paged::

       SELECT repo, pr_number, tenant_id, payload, created_at ...
        ORDER BY created_at DESC LIMIT $4

   Both are served by ONE index:
   ``(tenant_id, (payload->>'block_reason_code'), created_at DESC)``
   ``WHERE event_kind = 'predicate_eval'``.
   The two equality-bound columns form the leading prefix (so the COUNT is a
   bounded index range scan instead of a global heap sweep), and
   ``created_at DESC`` trailing makes query 5's ``ORDER BY … LIMIT`` an
   ordered index scan that stops after N rows — no sort node at all.
   ``event_kind`` is a **literal** in both statements, so it belongs in the
   partial predicate rather than the key: it costs zero key bytes and keeps
   the index restricted to the one kind these reads ever touch.

   **``repo`` is deliberately NOT a key column.** It is optional; putting it
   before ``created_at`` would break the ordered scan for query 5 whenever
   ``repo`` is NULL (the fleet-wide case), forcing the sort back. Putting it
   after ``created_at`` cannot filter before the ordering is consumed, so it
   would only bloat the index. The residual ``repo`` filter is applied on the
   already-narrow candidate rows — and the heap must be visited anyway for
   ``payload``, so an INCLUDE would not buy an index-only scan either.

2. **11.25 AAS** — ``coord.release_observations`` latest-per-target::

       SELECT DISTINCT ON (tenant_id, surface, target) …
        WHERE ($1::text IS NULL OR surface = $1)
          AND ($2::text IS NULL OR target = $2)
        ORDER BY tenant_id, surface, target, observed_at DESC

   Existing indexes: only ``observed_at DESC`` and a partial
   ``(tenant_id) WHERE tenant_id IS NOT NULL``. Neither supplies the
   ``DISTINCT ON`` ordering, so PG full-sorts the whole table on every call.
   New index ``(tenant_id, surface, target, observed_at DESC)`` matches the
   ``ORDER BY`` exactly — ``DISTINCT ON`` becomes an ordered index scan that
   skips to the first row of each group. ``tenant_id`` is nullable here, and
   the index's default ``ASC NULLS LAST`` on the leading three columns is
   precisely what ``ORDER BY tenant_id, surface, target`` requests, so the
   ordering is a true match (not merely a prefix).
   The two ``$n IS NULL OR col = $n`` filters are non-sargable and stay
   residual — that is fine; eliminating the sort is the entire win.

3. **4.54 AAS** — ``coord.config_observations`` latest-per-key::

       SELECT DISTINCT ON (kind, key) … WHERE surface = $1
        ORDER BY kind, key, observed_at DESC

   Existing: ``(surface, kind, key)`` and ``observed_at DESC`` as SEPARATE
   indexes. The first stops exactly where the ordering is needed, the second
   is led by the wrong column — so again, full sort. New index
   ``(surface, kind, key, observed_at DESC)`` binds ``surface`` by equality in
   the leading position and then yields rows already ordered by
   ``(kind, key, observed_at DESC)`` — an exact ``DISTINCT ON`` match.
   This SUPERSEDES ``idx_config_observations_surface_kind_key`` (which is now
   a strict prefix of it), but that index is left in place: dropping a live
   index during an active incident is a separate, riskier change and belongs
   in a follow-up cleanup, not in the mitigation.

4. **3.00 AAS** — ``coord.route_serving_observations`` latest-per-route::

       SELECT DISTINCT ON (host, route_path) …
        ORDER BY host, route_path, observed_at DESC

   Same shape, same cause: ``(host, route_path)`` and ``observed_at DESC``
   exist separately, neither serves the combined ordering. New index
   ``(host, route_path, observed_at DESC)``. Also supersedes
   ``idx_route_serving_observations_host_path``; likewise left in place.

6. **1.38 AAS** — ``coord.route_serving_observations`` error rollup::

       SELECT count(*) … WHERE drift_class = ?
         AND (actual_status >= ? OR actual_status IN (?, ?, ?))

   ``(drift_class, actual_status)`` gives an equality-bound leading column and
   evaluates the ``actual_status`` disjunction inside the index rather than on
   the heap. Lowest-value of the six, but a clean two-column b-tree on columns
   already present (``drift_class`` NOT NULL TEXT, ``actual_status`` nullable
   INTEGER — NULLs sort last and are simply never matched by either arm).

DO NOT "simplify" these away
------------------------------------------------------------------------------
Each of the four ``DISTINCT ON`` indexes looks redundant next to a shorter
existing index with the same leading columns. It is not: a ``DISTINCT ON``
query needs the *trailing* ``observed_at DESC`` in the SAME index to avoid a
sort, and a prefix index cannot provide it. Removing the trailing column, or
"deduplicating" against the shorter index, reproduces this incident.

``CREATE INDEX CONCURRENTLY`` (not plain ``CREATE INDEX``): these are hot
append-heavy tables under live production write load, and the instance is
already CPU-saturated — an in-transaction build would take a write-blocking
``SHARE`` lock and make the incident materially worse. CONCURRENTLY cannot run
inside a transaction, hence ``op.get_context().autocommit_block()`` (same
precedent as ``coord_pg_overload_idx_01`` / ``gate_action_02``). On the CI
fresh DB the tables are empty so the builds are instant. Additive /
forward-only / expand-only: ``upgrade`` creates each index ``IF NOT EXISTS``;
``downgrade`` drops ``IF EXISTS``. No table or column is altered.

Note on a killed CONCURRENTLY build: a partial build leaves an INVALID index of
the same name, which ``IF NOT EXISTS`` would then skip. If that happens,
manually ``DROP INDEX`` the invalid index and re-run.

Revision ID: coord_pg_overload_idx_02
Revises: coord_memory_vectors_01
Create Date: 2026-07-21

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_pg_overload_idx_02"
down_revision: str | None = "coord_memory_vectors_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Additive: five CONCURRENTLY composite/expression indexes. Idempotent."""
    with op.get_context().autocommit_block():
        # 1+5. blast_radius_monitor::list_blocks — COUNT (11.88 AAS) and the
        #      ORDER BY created_at DESC LIMIT page (1.52 AAS).
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS
                idx_pr_events_tenant_reason_created
            ON coord.pr_events (
                tenant_id,
                (payload->>'block_reason_code'),
                created_at DESC
            )
            WHERE event_kind = 'predicate_eval'
            """
        )
        # 2. release_observations DISTINCT ON (tenant_id, surface, target).
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS
                idx_release_observations_tenant_surface_target_observed
            ON coord.release_observations (
                tenant_id, surface, target, observed_at DESC
            )
            """
        )
        # 3. config_observations DISTINCT ON (kind, key) under surface = $1.
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS
                idx_config_observations_surface_kind_key_observed
            ON coord.config_observations (
                surface, kind, key, observed_at DESC
            )
            """
        )
        # 4. route_serving_observations DISTINCT ON (host, route_path).
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS
                idx_route_serving_observations_host_path_observed
            ON coord.route_serving_observations (
                host, route_path, observed_at DESC
            )
            """
        )
        # 6. route_serving_observations error rollup count.
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS
                idx_route_serving_observations_drift_status
            ON coord.route_serving_observations (drift_class, actual_status)
            """
        )


def downgrade() -> None:
    """Reverse the five additive indexes. Tables + all other indexes survive."""
    with op.get_context().autocommit_block():
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS "
            "coord.idx_route_serving_observations_drift_status"
        )
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS "
            "coord.idx_route_serving_observations_host_path_observed"
        )
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS "
            "coord.idx_config_observations_surface_kind_key_observed"
        )
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS "
            "coord.idx_release_observations_tenant_surface_target_observed"
        )
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS "
            "coord.idx_pr_events_tenant_reason_created"
        )
