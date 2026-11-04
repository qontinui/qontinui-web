"""coord read-IOPS: a partial index for the continuation give-up scan's alert probe.

Plan ``2026-11-04-coord-postgres-read-iops-near-its-cap-again``, Phase 1.

Root cause
==========

coord's ``continuation_stall_watcher`` runs its give-up arm every 60 s on the
leader (``giveup_scan_sql``). It reads the reported give-ups from
``coord.gates`` and keeps only those that do not yet have an alert::

    SELECT gate_id, claim_kind, resource_key, phase_name, work_unit_id,
           continuation_consumed_at, continuation_consumed_by,
           continuation_consumed_outcome,
           continuation_spawn->>'action' AS continuation_action
      FROM coord.gates
     WHERE continuation_consumed_at IS NOT NULL
       AND (continuation_consumed_outcome = 'work_abandoned'
            OR continuation_consumed_outcome LIKE 'work_abandoned: %')
       AND archived_at IS NULL
       AND NOT EXISTS (
           SELECT 1 FROM coord.alerts a
            WHERE a.alert_key = 'gate:' || coord.gates.gate_id::text
              AND (a.kind = 'gate_continuation_abandoned'
                   OR a.detail ? 'giveup_raised'))
       AND NOT EXISTS (... coord.work_units ...)
     ORDER BY continuation_consumed_at ASC
     LIMIT $1

The alert probe has to see RESOLVED rows as well as open ones. That is the
point of it: a give-up whose alert somebody resolved must not be raised again
on the next tick. The only index on ``alert_key`` is ``uq_alerts_active_key``,
which is partial on ``resolved_at IS NULL`` and so cannot answer it. With no
other index, the planner runs a parallel sequential scan of the whole of
``coord.alerts`` and materializes the rows of the give-up kind or marker.

Measured on production on 2026-11-04 (PostgreSQL 16.13, finding
``b72e6d9d-14d2-4614-adfd-4111b5c9d7ee``): ``coord.alerts`` holds 637k live rows
in 1.1 GB of heap. Performance Insights put this statement (``0153B221``) at
0.49 average active sessions and 87,466 blocks read per call. An
``EXPLAIN (ANALYZE, BUFFERS)`` of it did not finish inside a 30 s
``statement_timeout``. The plan was ``Nested Loop Anti Join`` over
``Materialize -> Gather -> Parallel Seq Scan on alerts`` with the filter
``(kind = 'gate_continuation_abandoned') OR (detail ? 'giveup_raised')``. All
that, for a give-up population of 36 gates.

Why not a cheaper lever
=======================

Each cheaper lever was checked first, in the plan's order.

* **Run it less often.** The cost does not depend on how many gates are in the
  population, because the whole alerts heap is read for any non-empty one. A
  slower tick would also delay the page for a reported give-up, which is what
  this arm exists to deliver.
* **Bound a window.** The give-up population never drains, by design (see the
  coord module's "NO DRAIN" note), so bounding ``continuation_consumed_at``
  would drop give-ups that have not been alerted yet. Bounding the ALERTS side
  by time would re-raise a give-up whose alert is older than the bound. And
  either bound leaves the alerts read a full scan anyway.
* **Split the probe.** The kind arm alone already rides
  ``idx_alerts_kind_first_seen_at`` (2,371 rows of the kind, 39 buffers). The
  marker arm cannot. The marker lands on whatever row the give-up merged into,
  and that row keeps its own kind (``gate_continuation_pending`` most often),
  so neither a kind index nor the active-key index finds it once it is
  resolved. Dropping that arm would re-raise those give-ups, which changes what
  the reader means.
* **A counter.** There is no aggregate to replace.

The index
=========

``idx_alerts_giveup_raised_key ON coord.alerts (alert_key)
WHERE kind = 'gate_continuation_abandoned' OR detail ? 'giveup_raised'``.

The predicate is the probe's own disjunction, spelled the way coord spells it,
so PostgreSQL can prove that the probe implies it. That proof is syntactic: if
coord changes the disjunction, the index silently stops serving the probe.
coord pins its side with a unit test that names this index. With the index,
each give-up gate costs one descent of a ~2.5k-entry btree. There is no heap
scan of ``coord.alerts`` at all.

Existing indexes, and why none of them serves the probe:

* ``alerts_pkey (id)``: the probe has no ``id``.
* ``uq_alerts_active_key (alert_key) WHERE resolved_at IS NULL``: open rows
  only. The probe must see resolved rows.
* ``idx_alerts_kind_first_seen_at (kind, first_seen_at)``: serves the kind arm
  but not the marker arm. An OR of the two needs both arms indexed, or the
  planner falls back to the scan.
* ``idx_alerts_active_severity``, ``idx_alerts_claim_expiry``: partial on
  ``resolved_at IS NULL``.
* ``idx_alerts_first_seen_at``, ``idx_alerts_resolved_at``,
  ``idx_alerts_paged``, ``idx_alerts_tenant_id``,
  ``ix_proclog_alerts_claimed_at``: none leads with or contains ``alert_key``.
* ``idx_alerts_red_main_flake_healed``: partial on ``red_main`` rows.

Disk and write cost
===================

Only rows that satisfy the predicate get an entry. Production's planner
estimated 2,575 such rows. The kind arm alone counts 2,371, through an
index-only scan of ``idx_alerts_kind_first_seen_at``. An entry is about
56 bytes: a 41-byte ``gate:<uuid>`` key, the tuple header and the line pointer.
So the index is roughly 150-250 KB, against the 180 GB volume that
``2026-10-22-coord-rds-storage-ceiling-raise-before-it-fills`` budgets.
qontinui-web#2078's ``idx_pr_events_mergeability_head_created`` is counted in
that budget separately.

It adds no HOT-update loss. A predicate column blocks HOT for updates of that
column, and ``detail`` is already a predicate column of
``idx_alerts_red_main_flake_healed``, as ``kind`` is of the same index. Every
alert upsert rewrites ``detail``, so alerts updates were already non-HOT
whenever ``detail`` changed. Write amplification is one btree insert, and only
for rows inside the predicate.

The one-time cost is the ``CONCURRENTLY`` build. It makes two passes over the
1.1 GB heap, roughly what three calls of today's reader read, and then never
again.

Classifier-safe form
====================

The same form as ``coord_iops_idx_01``: ``CREATE INDEX CONCURRENTLY IF NOT
EXISTS`` in an ``autocommit_block``, written as a plain literal. It has no
build guards, because coord's fail-closed migration classifier
(``pr_merge/migration_classifier.rs``) admits only DDL it can prove.
``indisvalid`` is checked after the production deploy instead.

    SELECT indisvalid FROM pg_index
     WHERE indexrelid = 'coord.idx_alerts_giveup_raised_key'::regclass;

If a killed build left it INVALID, ``DROP INDEX CONCURRENTLY`` it and re-run
the upgrade. ``IF NOT EXISTS`` skips an INVALID index of the same name, so
re-running alone does not repair it.

Verify the reader rides it after deploy: ``pg_stat_user_indexes.idx_scan`` for
this index rises by about one per give-up gate per minute.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_iops_idx_02"
down_revision: str | Sequence[str] | None = "ci_job_res_02"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """One additive CONCURRENTLY index; verify ``indisvalid`` after deploy."""
    with op.get_context().autocommit_block():
        # Plain literal, never an f-string: the `alembic-schema-arg-gate`
        # pre-commit hook and coord's migration classifier both read it statically.
        # The predicate is the give-up probe's disjunction verbatim - the
        # planner's implication proof is syntactic.
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS
                idx_alerts_giveup_raised_key
            ON coord.alerts (alert_key)
            WHERE kind = 'gate_continuation_abandoned'
               OR detail ? 'giveup_raised'
            """
        )


def downgrade() -> None:
    """Drop the index concurrently. No row changes."""
    with op.get_context().autocommit_block():
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS coord.idx_alerts_giveup_raised_key"
        )
