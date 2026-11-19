"""coord.process_forecasts: index each forecast family's resolved rows by issue time.

Adds one partial index, ``CONCURRENTLY``::

    coord.process_forecasts (tenant_id, object_type, issued_at DESC)
                            WHERE resolved_at IS NOT NULL
                                      ix_process_forecasts_resolved_family_issued

Phase 1 of plan ``2026-11-05-forecast-ledger-phase-3-review-follow-ups`` (review
item 1), decisions D1 and D2.

What is slow
------------------------------------------------------------------------------
``coord_query_forecast_scores`` loads a tenant's most recent resolved forecasts of
one family. The statement is ``SCORED_ROWS_SQL`` in coord's
``crates/coord/src/forecast_ledger/mod.rs`` (lines 162-180 at qontinui-coord
``89909b161``)::

    SELECT ... FROM coord.process_forecasts f
     WHERE f.tenant_id = $1
       AND f.resolved_at IS NOT NULL
       AND left(f.question, length($2)) = $2
       AND ($3::timestamptz IS NULL OR f.issued_at >= $3)
       AND <predicted.forecasts carries the incumbent model and prior_only>
     ORDER BY f.issued_at DESC
     LIMIT $4                       -- MAX_SCORED_ROWS + 1 = 50,001

The table's only indexes today are the issue key ``uq_process_forecasts_issue``
``(tenant_id, question, object_type, object_id, issued_at)`` and the resolver's
queue ``ix_process_forecasts_unresolved`` (partial on ``resolved_at IS NULL``).
Neither delivers ``issued_at DESC`` order for one tenant's resolved rows, so the read
fetches every resolved row of the tenant, sorts them, and keeps the first 50,001,
under a 5 s ``statement_timeout``. Its cost grows with the 400-day window, the public
ingest and Phase 6b's second forecast family.

What this index does
------------------------------------------------------------------------------
The key is the read's equality columns and then its order: ``tenant_id``, then
``object_type`` (one forecast family), then ``issued_at DESC``. Partial on
``resolved_at IS NOT NULL``, the read's own conjunct, so the resolver's queue never
enters it. An ordered walk of it stops at the cap, and never walks another family's
or another tenant's rows (D1). The read as landed has no ``object_type`` equality.
Phase 6b's read adds one, and Phase 3 step 3.1 adds ``AND f.object_type =
'dev_action'`` (``OBJECT_TYPE``, ``mod.rs:45-46``) if 6b has not.

Why the planner needs Phase 3's setting to choose it
------------------------------------------------------------------------------
The read's ``jsonb @>`` and ``left(question, ...)`` conjuncts have no statistics, so
the planner's row estimate for them is a small default fraction. With a small
estimate a full fetch plus Sort looks cheaper than an ordered walk that may have to
read far into the index to fill the LIMIT, so the index alone does not make the plan
deterministic (D2, option A). Phase 3 therefore runs ``SET LOCAL enable_sort = off``
around ``SCORED_ROWS_SQL`` only, inside the read's own transaction (D2, option B1).
That only penalises Sort paths: with this index present the ordered walk wins; without
it the Sort is still the only path and the read plans exactly as today.
``tests/test_coord_forecast_scored_idx_01_migration.py`` asserts the B1 read plans on
this index with no Sort, and its test 6 records, without asserting, what the planner
picks without the setting, for the general and a 1 %-selective question prefix.

Test 6's result (2026-11-05, Postgres 17.11, 120,000 resolved rows of the scored family
beside 20,000 of another family, 5,000 of another tenant and 2,000 unresolved, ANALYZEd,
the index present): without the setting the planner estimated ``rows=1`` for the read's
conjuncts and chose a Parallel Seq Scan of the family rows, then a Sort (``external
merge``): 308 ms and 25,400 kB on disk for ``since`` NULL, 334 ms and 12,192 kB for a
``since`` 40 days back. That is D2's premise: the index alone is not chosen. For the 1 %
prefix (1,200 matching rows) the Sort plan took 79 ms and the B1 plan, a Parallel Index
Scan of this index walking the whole family partition with the prefix as a Filter,
88 ms. Under B1 the generic plan of the prepared read (``plan_cache_mode =
force_generic_plan``) also walks this index with no Sort, with ``tenant_id`` and
``object_type`` as its Index Cond and ``($3 IS NULL OR issued_at >= $3)`` left as a
Filter. It is a measurement on a synthetic table seeded in ``issued_at`` order, so it
decides nothing: Phase 3 applies B1 unconditionally.

Order against coord
------------------------------------------------------------------------------
None, in either direction. No coord code depends on the index: without it the read is
exactly as fast as it is today, and Phase 3 does not depend on it either, because under
``enable_sort = off`` with no usable index the Sort plan is still the one chosen.

Building
------------------------------------------------------------------------------
``CREATE INDEX CONCURRENTLY IF NOT EXISTS`` (``SHARE UPDATE EXCLUSIVE`` only) inside
``autocommit_block()``, so the build takes no lock that blocks coord's forecast writes
or the resolver's UPDATE. Precedents: ``coord_retention_idx_01``,
``pr_events_mergeability_head_idx_01``.

The cost is negligible: on 2026-11-05 ``coord_query_forecast_scores`` read 6
unresolved and 0 resolved system-tenant rows, so the build is instant and the index
holds nothing yet. It adds one index entry per resolved forecast, written by the
resolver's UPDATE.

No in-migration guards, deliberately, on the ``coord_iops_idx_01`` reasoning: coord's
migration classifier (``pr_merge/migration_classifier.rs``) is fail-closed, and
rejects a read through ``op.get_bind().execute`` and a ``DROP`` on the upgrade path. A
killed concurrent build leaves an INVALID index that ``IF NOT EXISTS`` then skips and
reports as success. So ``indisvalid`` is checked AFTER the deploy instead::

    SELECT c.relname, i.indisvalid
      FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
     WHERE c.relname = 'ix_process_forecasts_resolved_family_issued';

``false`` means: wait until ``pg_stat_progress_create_index`` is empty, because a live
build also reads ``false``, then run ``DROP INDEX CONCURRENTLY coord.<name>`` and
re-run ``upgrade()``'s ``CREATE INDEX CONCURRENTLY`` statement by hand. That repair is
production DDL.

**A second migrator kills a live build.** It waits on the first's lock, the deadlock
detector usually fires, and the FIRST dies while the second prints ``already exists,
skipping``, exits 0 and leaves the index INVALID (reproduced on Postgres 16.13 for
``pr_events_mergeability_head_idx_01``). ``.github/workflows/migrate.yml``'s
concurrency group covers only its waiter, never the task. On a table this small the
build ends long before a second run could start, but the rule stands as written there:
land this away from the 03:00 UTC cron, and merge no other PR touching
``backend/alembic/**``, ``backend/pyproject.toml`` or ``backend/poetry.lock`` until
``pg_stat_progress_create_index`` is empty.

Expected coord migration-classifier disposition: **AutoSafe**.
``migration_classifier.rs:950-958`` admits ``CONCURRENTLY`` only inside an autocommit
block, and the upgrade path is one guarded ``CREATE INDEX CONCURRENTLY IF NOT EXISTS``
there, as a static literal. The test file pins that shape.

Revision ID: coord_forecast_scored_idx_01
Revises: coord_agent_status_session_01
Create Date: 2026-11-05

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_forecast_scored_idx_01"
down_revision: str | Sequence[str] | None = "coord_agent_status_session_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Build the family-scoped partial index. Additive; no row changes."""
    with op.get_context().autocommit_block():
        # Plain literal, never an f-string: the `alembic-schema-arg-gate`
        # pre-commit hook and coord's migration classifier both read it statically.
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS
                ix_process_forecasts_resolved_family_issued
            ON coord.process_forecasts (tenant_id, object_type, issued_at DESC)
            WHERE resolved_at IS NOT NULL
            """
        )


def downgrade() -> None:
    """Drop the index concurrently. No row changes."""
    with op.get_context().autocommit_block():
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS "
            "coord.ix_process_forecasts_resolved_family_issued"
        )
