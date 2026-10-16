"""coord.route_serving_observations: (host, route_path, method, observed_at DESC) index

Revision ID: route_serving_method_idx_01
Revises: ingcred_01
Create Date: 2026-10-16

A Phase 4 prerequisite (the "Depends-On (added 2026-10-16)" bullet) of plan
``qontinui-dev-notes/plans/2026-09-25-route-serving-observer-probes-mutating-routes-with-their-documented-verb.md``.
**coord authors zero ``coord.*`` DDL** (served policy ``production-and-cost``
``alembic-sole-authorship``), so the index lands here, hand-authored, and must
be DEPLOYED before the Phase 4 coord build merges.

The reads it serves
==========================================================================

``route_serving_host_passes_01`` added the nullable ``method`` column. Phase 4
writes one observation row per ``(route_path, method)`` and moves both of the
table's per-key reads from ``(host, route_path)`` to ``(host, route_path,
method)``:

1. **The per-key latest reader** (``route_serving_observer``)::

       SELECT DISTINCT ON (route_path, method) ...
         FROM coord.route_serving_observations
        WHERE host = $1
        ORDER BY route_path, method, observed_at DESC

2. **The ``table_retention`` latest-row guard**, whose fold key widens from
   ``(host, route_path)`` to ``(host, route_path, method)`` so a prune never
   deletes the newest row of any one method. It renders as a ``max(observed_at)
   ... GROUP BY host, route_path, method`` derived table correlated on the key.

The existing per-key index is ``idx_route_serving_observations_host_path_observed``
= ``(host, route_path, observed_at DESC)`` (``coord_pg_overload_idx_02``; the bare
``(host, route_path)`` index from ``twin_06`` was dropped as its prefix by
``coord_pg_overload_idx_03``). It serves today's ``(host, route_path)`` reads,
but neither read above once ``method`` is in the key: within one path its
``observed_at`` order interleaves the methods, so every sibling-method row has to
be fetched and sorted on ``(method, observed_at)``. That loses the index-served
property qontinui-coord#3300 (plan ``2026-10-14-coord-high-ingest-tables-are-unbounded``
Phase 2) gives the ``(host, route_path)`` guard. With ``method`` between the path
and ``observed_at DESC``, both reads are an ordered range scan with no Sort node.
``DESC`` is load-bearing: the reader orders ``route_path ASC, method ASC,
observed_at DESC``, which an all-ascending index cannot supply in either scan
direction. A b-tree stores NULLs as one group, so the legacy rows whose method
is NULL still form their own key and are read in the same pass.

``idx_route_serving_observations_host_path_observed`` is kept: the pre-Phase-4
coord build still reads ``DISTINCT ON (route_path) ... ORDER BY route_path,
observed_at DESC``, which the new index cannot order. Retiring it is a separate
revision for after Phase 4 is live, and a ``DROP`` on this upgrade path would
take the revision off the auto-land path anyway.

Building on a large table
==========================================================================

The table is about 17M rows / 5.7 GB in production, and the observer appends
to it every cycle. ``CREATE INDEX CONCURRENTLY IF NOT EXISTS`` takes ``SHARE
UPDATE EXCLUSIVE`` only, so the appends keep landing during the build; it
cannot run inside a transaction, hence ``op.get_context().autocommit_block()``.
Precedents: ``coord_iops_idx_01``, ``census_idx_01_device_repo_path_observed``,
``coord_obs_idx_01``.

No in-migration guards, deliberately, on the ``coord_iops_idx_01`` reasoning:
coord's migration classifier (``pr_merge/migration_classifier.rs``) is
fail-closed and rejects a read through ``op.get_bind().execute``. A killed
concurrent build leaves an INVALID index that ``IF NOT EXISTS`` then skips and
reports as success, so ``indisvalid`` is checked AFTER the deploy instead, and
the result recorded before the Phase 4 coord build merges::

    SELECT c.relname, i.indisvalid
      FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
     WHERE c.relname = 'idx_route_serving_observations_host_path_method_observed';

``false`` means: run ``DROP INDEX CONCURRENTLY
coord.idx_route_serving_observations_host_path_method_observed`` and re-run this
revision's statement by hand.

Expected coord migration-classifier disposition: **AutoSafe**. The upgrade path
is one guarded ``CREATE INDEX CONCURRENTLY IF NOT EXISTS`` inside an autocommit
block and one ``COMMENT ON INDEX`` with a plain literal body. Every SQL string
is a static literal. ``tests/test_route_serving_method_idx_01_migration.py``
pins those shapes and asserts the planner uses the index for both reads.

Downgrade drops only this index, concurrently. The table, its rows and its
other indexes survive.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "route_serving_method_idx_01"
down_revision: str | Sequence[str] | None = "ingcred_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Every SQL string below is a STATIC literal: the coord merge-train migration
# classifier rejects an execute call whose argument it cannot read as one. The
# comment body avoids apostrophes so no SQL escaping is needed.


def upgrade() -> None:
    """Additive: one CONCURRENTLY composite index, then its comment. Idempotent."""
    with op.get_context().autocommit_block():
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS
                idx_route_serving_observations_host_path_method_observed
            ON coord.route_serving_observations (
                host, route_path, method, observed_at DESC
            )
            """
        )
        op.execute(
            """
            COMMENT ON INDEX coord.idx_route_serving_observations_host_path_method_observed IS
                'Serves the per-(host, route_path, method) latest reader of route_serving_observer (DISTINCT ON (route_path, method) for one host, ORDER BY route_path, method, observed_at DESC) and the table_retention latest-row guard keyed on (host, route_path, method), so both stay index-served once rows carry a method. Plan 2026-09-25-route-serving-observer-probes-mutating-routes-with-their-documented-verb, Phase 4. Hand-authored by alembic revision route_serving_method_idx_01.'
            """
        )


def downgrade() -> None:
    """Drop only this index. The table and its other indexes survive."""
    with op.get_context().autocommit_block():
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS "
            "coord.idx_route_serving_observations_host_path_method_observed"
        )
