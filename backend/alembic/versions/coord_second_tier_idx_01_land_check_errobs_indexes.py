"""coord second-tier reads: index coord lands, check-run detail links, error fingerprints.

Adds three indexes, each ``CONCURRENTLY``::

    coord.pr_events (repo, created_at DESC)
        WHERE event_kind = 'state_change' AND state = 'MERGED'
          AND COALESCE(payload->>'source','coord_land') = 'coord_land'
                                            idx_pr_events_coord_land_repo_created
    coord.pr_check_runs (repo, updated_at DESC)
        WHERE details_url IS NOT NULL AND name IS DISTINCT FROM 'Qontinui merge gate'
                                            idx_pr_check_runs_repo_updated_details
    coord.error_observations (surface, fingerprint, window_start)
                                            idx_error_observations_surface_fp_window

Phase 2 of plan ``2026-11-27-coord-second-tier-db-load-consumers-have-no-owner``
(decision D3: one hand-authored revision, landed before any coord change that
depends on it). What gets built is the plan's D2a table, which records Phase 1's
read-only production measurements, findings
``dae863c0-c628-4506-9107-62d915635f44`` and
``452a3052-5bbc-41b0-a441-a3327bf2adb6`` (2026-11-28).

Rank 7: coord's "last coord land" reads
------------------------------------------------------------------------------
``land_status.rs`` ``last_coord_land_at_for_repo_sql`` and its fleet twin
``last_coord_land_at_sql`` take ``MAX(created_at)`` over ``coord.pr_events``
rows matching ``COORD_LAND_EVENT_WHERE``. Measured: 817 ms mean per call, the
twin 8.4 s and 61.6k blocks read. The ``pr_events`` arm carries about 97 % of it,
a bitmap scan of ``(repo, event_kind)`` that heap-filters about 27k rows.

**The predicate is a contract with coord.** It is ``COORD_LAND_EVENT_WHERE``
(``crates/coord/src/land_status.rs``) verbatim, so both statements can prove it
as they stand, with no coord change: the per-repo ``MAX`` becomes a one-entry
backward walk, the twin a scan of about 9k entries. Changing either side alone
leaves coord correct and slow. ``tests/test_coord_second_tier_idx_01_migration.py``
holds a literal copy of coord's constant and reddens if this side moves.

Write cost: ``pr_events`` takes about 5,345 inserts and 19,576 updates an hour
(none HOT). This index is partial, so it is maintained only for the coord-land
``state_change`` / ``MERGED`` rows, a small fraction of the inserts. Because no
``pr_events`` update is HOT, any update of a matching row adds an entry whichever
column changed (coord does update ``payload`` by ``event_id``, a predicate column);
land rows are rarely updated, so the cost stays small.

Rank 9: ``latest_details_url``
------------------------------------------------------------------------------
``api/ci_routes.rs`` ``latest_details_url`` reads a repo's newest check run with
a details link, excluding coord's own gate row. Measured: 1,031 ms mean, about
45k buffer hits, a CPU-bound top-1 sort over 237k entries, because no index
orders a repo's check runs by ``updated_at``. With this index it is a walk that
stops at the first entry.

The partial predicate keeps coord's own ``Qontinui merge gate`` row out, whose
``updated_at`` is restamped every evaluation cycle. coord binds that name as
``$2`` today, which a generic plan cannot match to a literal predicate; Phase 3
of the plan inlines ``CHECK_RUN_NAME`` as a literal so the predicate is provable
in every plan.

Write cost: ``pr_check_runs`` takes about 975 inserts and 3,233 updates an hour,
3,021 of them HOT. Because ``updated_at`` becomes an indexed column, about 3.0k
updates an hour (those 3,021 HOT ones) stop being HOT. Recorded in D2a and accepted there.

Rank 10: ``first_seen_by_fingerprint``
------------------------------------------------------------------------------
``error_observer.rs`` ``first_seen_by_fingerprint`` takes the earliest
``window_start`` per fingerprint of a surface. Measured: 4,710 ms mean, a
parallel seq scan of 35k pages; the existing ``(surface, window_start DESC)``
index carries no fingerprint. With ``(surface, fingerprint, window_start)`` the
earliest entry per fingerprint is the first entry of a range, but only through
the per-fingerprint ``LATERAL`` probe that Phase 3 ships once this index is
confirmed in ``pg_indexes`` (the ``GROUP BY ... = ANY`` form cannot use the
min/max shortcut, and the ``LATERAL`` form without the index is worse).

Write cost: ``error_observations`` takes about 266 inserts an hour, no updates.

Order against coord
------------------------------------------------------------------------------
This revision may land at any time. Rank 7's readers use the index as they
stand. Rank 9 plans on the index whenever the planner builds a CUSTOM plan with
``$2`` folded to a constant, which coord's tokio-postgres per-call prepare gets
today (the migration test pins both arms: custom plan uses it, a generic plan
cannot); Phase 3's inlined literal makes it hold for generic plans too. Rank 10's
``= ANY`` form may gain an index qual on ``(surface, fingerprint)``; only Phase 3's
``LATERAL`` rewrite gets the one-entry walk per fingerprint.

Building on busy tables
------------------------------------------------------------------------------
``CREATE INDEX CONCURRENTLY IF NOT EXISTS`` (``SHARE UPDATE EXCLUSIVE`` only)
inside ``autocommit_block()``, so no build blocks coord's writes. Precedents:
``coord_pg_overload_idx_01``, ``pr_events_mergeability_head_idx_01``.

A killed concurrent build leaves an INVALID index that ``IF NOT EXISTS`` then
skips and reports as success. No in-migration guard, because coord's migration
classifier rejects a read through ``op.get_bind().execute`` and a ``DROP`` on the
upgrade path. So ``indisvalid`` is checked AFTER the deploy instead::

    SELECT c.relname, i.indisvalid
      FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
     WHERE c.relname IN ('idx_pr_events_coord_land_repo_created',
                         'idx_pr_check_runs_repo_updated_details',
                         'idx_error_observations_surface_fp_window');

``false`` means: wait until ``pg_stat_progress_create_index`` is empty (a live
build also reads ``false``), then ``DROP INDEX CONCURRENTLY coord.<name>`` and
re-run that index's statement below by hand. A second migrator started while a
build runs can kill it the same way (``pr_events_mergeability_head_idx_01``'s
docstring has the mechanism), so land this away from the 03:00 UTC migrate cron.

Expected coord migration-classifier disposition: **AutoSafe**. The upgrade path
is three static ``CREATE INDEX CONCURRENTLY IF NOT EXISTS`` literals inside an
autocommit block, which the migration test pins.

Revision ID: coord_second_tier_idx_01
Revises: coord_wt_volume_read_only_01
Create Date: 2026-11-28

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_second_tier_idx_01"
down_revision: str | Sequence[str] | None = "coord_wt_volume_read_only_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Build the three indexes concurrently. Additive; no row changes."""
    with op.get_context().autocommit_block():
        # Plain literals, never f-strings: the `alembic-schema-arg-gate`
        # pre-commit hook and coord's migration classifier both read them statically.
        # 1. Rank 7: coord's last-land reads. Predicate = COORD_LAND_EVENT_WHERE.
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS
                idx_pr_events_coord_land_repo_created
            ON coord.pr_events (repo, created_at DESC)
            WHERE event_kind = 'state_change' AND state = 'MERGED' AND COALESCE(payload->>'source','coord_land') = 'coord_land'
            """
        )
        # 2. Rank 9: latest_details_url, newest non-gate check run with a link.
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS
                idx_pr_check_runs_repo_updated_details
            ON coord.pr_check_runs (repo, updated_at DESC)
            WHERE details_url IS NOT NULL
              AND name IS DISTINCT FROM 'Qontinui merge gate'
            """
        )
        # 3. Rank 10: first_seen_by_fingerprint, earliest window per fingerprint.
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS
                idx_error_observations_surface_fp_window
            ON coord.error_observations (surface, fingerprint, window_start)
            """
        )


def downgrade() -> None:
    """Drop the three indexes concurrently, in reverse order. No row changes."""
    with op.get_context().autocommit_block():
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS "
            "coord.idx_error_observations_surface_fp_window"
        )
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS "
            "coord.idx_pr_check_runs_repo_updated_details"
        )
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS "
            "coord.idx_pr_events_coord_land_repo_created"
        )
