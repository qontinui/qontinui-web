"""Drop ``idx_alerts_machine`` — never scanned, backs nothing, unusable anyway.

``coord.alerts`` carries a partial index created by
``row_9_phase_4_01_coord_alerts`` for *"per-machine drill-down + cascade-resolve
when a machine recovers"*::

    CREATE INDEX idx_alerts_machine ON coord.alerts USING btree (device_id)
        WHERE (device_id IS NOT NULL)

(originally on ``machine_id``; ``ud01_unify_devices_registry`` renamed the
column, and a column rename carries its index, so the live definition is the
``device_id`` form above — read back verbatim from prod's ``pg_get_indexdef``.)

It occupies 16 MB and has never been used. **``idx_scan = 0`` on its own would
not justify this drop** — that counter is relative to the last statistics reset,
so a recent reset makes a zero meaningless. Every one of the following was
established against coord prod on 2026-08-07 via a read-only throwaway ECS probe
before writing this revision.

1. The statistics window is real, and long
------------------------------------------------------------------------------
``pg_stat_database.stats_reset`` for ``qontinui_db`` is **NULL** — statistics
have never been reset for this database — and ``track_counts`` is ``on``.
``pg_stat_bgwriter.stats_reset`` is 2026-05-17, putting the window at ~82 days.

That is corroborated independently, because a NULL ``stats_reset`` could also be
read as "no information": the peer index ``idx_alerts_active_severity`` reports
``last_idx_scan = 2026-06-11``, a timestamp that **predates the postmaster start
of 2026-07-21**. Retained history older than the last restart proves the
statistics file survived it, so the window is bounded below by **57 days** on
directly observed evidence, independent of any reset field.

2. It has never been scanned — stronger than a zero counter
------------------------------------------------------------------------------
PG 16's ``pg_stat_user_indexes.last_idx_scan`` is **NULL** for this index, with
``idx_scan``/``idx_tup_read``/``idx_tup_fetch`` all 0. Every other index on the
table shows traffic (``uq_alerts_active_key`` 49.5M scans, ``alerts_pkey`` 2.0M,
``idx_alerts_tenant_id`` 787K), so the table is emphatically being read — this
index simply is not part of any plan.

3. It backs no constraint
------------------------------------------------------------------------------
``indisunique = false``, ``indisprimary = false``, ``indisexclusion = false``.
``pg_constraint`` on ``coord.alerts`` holds exactly three rows — ``alerts_pkey``
(p, backed by ``alerts_pkey``), ``alerts_severity_chk`` (c, no index), and
``alerts_tenant_id_fkey`` (f, whose ``conindid`` points at ``tenants_pkey`` on
the *referenced* side). None depends on this index, so it can be dropped
independently.

4. Nothing references it by name, and no query shape can use it
------------------------------------------------------------------------------
Grepped ``qontinui-coord`` ``origin/main`` (``c94a1143``): the only occurrence of
``idx_alerts_machine`` is ``src/fleet_health.rs:542``, inside
``create_alerts_for_test`` — a ``#[cfg(test)]`` fixture gated at ``:515``, not
production DDL. In this repo the name appears only in its own creating revision
and in a ``coord_alerts_flakeidx_01`` docstring.

Query shapes matter more than names, so those were swept too. The only
``coord.alerts … WHERE device_id = $1`` statements in coord are
``fleet_health.rs:2635`` and ``:2708`` — **both inside ``#[cfg(test)] mod
tests``**, which opens at ``:1723`` and, being the sole column-0 item after it,
runs to EOF at ``:3973``. Production code touches ``a.device_id`` only inside
correlated ``EXISTS (SELECT 1 FROM coord.tenant_devices td WHERE td.device_id =
a.device_id AND td.tenant_id = $1)`` subqueries (e.g. ``:1403``, ``:1678``,
``:1690``); those are served by an index on ``coord.tenant_devices``, with
``coord.alerts`` as the outer relation.

5. No replica read path
------------------------------------------------------------------------------
``pg_stat_replication`` and ``pg_replication_slots`` are both empty and
``pg_is_in_recovery()`` is false; RDS reports ``MultiAZ = false`` and an empty
``ReadReplicaDBInstanceIdentifiers``. ``qontinui-staging`` is a single instance,
so there is no standby whose reads could be missing from the primary's counters.

6. Its cardinality makes it useless even to a future reader
------------------------------------------------------------------------------
The decisive point. ``coord.alerts`` holds 249,927 rows, 96,082 with a non-NULL
``device_id``, across **6 distinct device_ids** — roughly 16,000 rows per key.

(That row count is a **post-prune** reading and deliberately disagrees with its
landed siblings: ``coord_alerts_pagedidx_01`` and ``coord_alerts_flakeidx_01``
both cite 1,474,452, measured before ``coord_alerts_retention_01`` pruned the
``stale_wip`` / ``stale_primary_tree`` burst. Reconciled here so the next reader
does not spend the time chasing an apparent contradiction. The cardinality
argument does not depend on which figure is used.)

A
b-tree equality lookup returning a sixth of the indexed rows loses to a bitmap
or sequential scan at any realistic cost setting. So this is not a useful index
that merely happens to be unused pending a feature: the "per-machine drill-down"
it was built for would not choose it either, at this cardinality.

Residual risk, stated plainly
------------------------------------------------------------------------------
Not zero. A planner *could* in principle pick a nested loop joining
``coord.alerts`` to ``coord.tenant_devices`` with this index on the inner side.
It has not done so once in a window of at least 57 days of production traffic,
and point 6 explains why it would not. Recovery, if that judgement is ever
wrong, is a single ``alembic downgrade`` — ``downgrade()`` below recreates the
index with a byte-identical definition.

Ordering / safety
------------------------------------------------------------------------------
``DROP INDEX CONCURRENTLY`` rather than a plain drop, following the
``coord_pg_overload_idx_02`` / ``_03`` precedent: ``coord.alerts`` is under live
production write load from ~72 ``FiredAlert`` producers, and a plain drop takes
an ``ACCESS EXCLUSIVE`` lock that would block them, where CONCURRENTLY takes
only ``SHARE UPDATE EXCLUSIVE``. CONCURRENTLY cannot run inside a transaction,
hence ``op.get_context().autocommit_block()``. On CI's fresh database the table
is empty and the drop is instant.

A cancelled CONCURRENTLY operation can leave an INVALID index of the same name.
``IF EXISTS`` / ``IF NOT EXISTS`` make both directions **re-runnable**, which is
not the same as idempotent and the difference matters here: ``IF NOT EXISTS``
*skipping* an invalid leftover is precisely a non-idempotent false success — the
statement reports OK while leaving an index no planner will ever use. (The
sibling ``coord_pg_overload_idx_03`` claims idempotence outright; that claim is
too strong for the same reason.) The accompanying test therefore asserts
``indisvalid`` on the restored index rather than mere existence. If a re-run
skips an invalid leftover, ``DROP INDEX`` it plainly and re-run.

Not actioned here
------------------------------------------------------------------------------
The same probe found substantially larger never-scanned indexes in ``coord`` —
``idx_test_results_observed_at`` (428 MB, ``idx_scan = 0``) most notably, plus
several primary keys whose zero counts reflect insert-only tables and which back
constraints regardless. Those are a separate question with a separate risk
profile and deliberately belong to their own plan, not to this cleanup.

Revision ID: coord_alerts_dropmachineidx_01
Revises: coord_pgss_ext_01
Create Date: 2026-08-07

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_alerts_dropmachineidx_01"
down_revision: str | None = "coord_pgss_ext_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Drop the never-scanned per-device partial index."""
    with op.get_context().autocommit_block():
        op.execute("DROP INDEX CONCURRENTLY IF EXISTS coord.idx_alerts_machine")


def downgrade() -> None:
    """Recreate it exactly as prod had it — ``(device_id) WHERE device_id IS NOT NULL``.

    The predicate is not decoration: without it the recreated index would cover
    the ~154k NULL-``device_id`` rows too, so a downgrade would silently restore
    a *different, larger* index than the one dropped. The definition here is
    transcribed from prod's ``pg_get_indexdef`` output, and the accompanying test
    asserts the round-trip is definitionally identical rather than merely
    same-named.
    """
    with op.get_context().autocommit_block():
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_alerts_machine
            ON coord.alerts (device_id)
            WHERE device_id IS NOT NULL
            """
        )
