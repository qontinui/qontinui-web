"""coord.test_results — per-table autovacuum thresholds so pruned space is reused.

Sets two table storage parameters::

    ALTER TABLE coord.test_results SET (
        autovacuum_vacuum_scale_factor = 0.01,
        autovacuum_vacuum_threshold    = 10000)

Precedent
------------------------------------------------------------------------------
No prior revision under ``backend/alembic/versions`` sets a TABLE storage
parameter — the only ``WITH (...)`` / ``SET (...)`` options before this one are
index build options (ivfflat ``lists``, hnsw). So this revision is the
precedent: a per-table autovacuum override is a plain ``ALTER TABLE ... SET``,
reversed by ``ALTER TABLE ... RESET`` of the same keys (which returns them to
the server-wide defaults rather than to any remembered value — there was none).

Lock
------------------------------------------------------------------------------
``ALTER TABLE ... SET/RESET`` of autovacuum storage parameters takes only a
``SHARE UPDATE EXCLUSIVE`` lock — the same lock autovacuum itself and
``CREATE INDEX CONCURRENTLY`` take. It does not block reads or INSERT/UPDATE/
DELETE, and it rewrites nothing, so it is instant and safe on the live table
under continuous CI ingest. (It waits behind a running autovacuum or a
concurrent index build on the table, and briefly queues writers behind itself
only while it waits for that lock.) No ``autocommit_block`` is needed: unlike
CONCURRENTLY, it is legal inside the migration transaction.

Rationale
------------------------------------------------------------------------------
``coord.test_results`` holds ~63.5M rows (production, 2026-09-25) and is pruned
by qontinui-coord's 14-day ``table_retention`` sweep at up to ~4M deletes/day
(1M per six-hourly sweep once the retention-cadence fix, qontinui-coord#2484,
deploys). Autovacuum triggers at ``threshold + scale_factor * reltuples`` dead
tuples. With the server defaults (``0.2`` / ``50``) that is ~12.7M dead tuples —
at 4M deletes/day, one vacuum every ~3 days. Until a vacuum runs, the space the
sweep frees is NOT reusable, so ~2M rows/day of ingest keeps extending the heap
instead of filling the holes, and the table never gets smaller in practice.

``0.01`` / ``10000`` puts the trigger at ~0.6M dead tuples — about every
four sweeps' worth of deletes at full capacity — so freed pages are marked
reusable within hours. The ``10000`` floor keeps a near-empty table (CI fresh
databases, a much smaller future steady state) from vacuuming on every handful
of deletes. This does not shrink the file (only ``VACUUM FULL`` / ``pg_repack``
return space to the OS); it stops the growth.

Verify on production by reading ``n_dead_tup`` and ``last_autovacuum`` from
``pg_stat_user_tables`` before and after: ``last_autovacuum`` should advance at
least daily once the sweep runs at cadence. Plan
``2026-09-25-coord-git-write-ledger-and-test-coverage-map-have-no-retention``
Phase 3. Deliberately NOT extended to ``git_write_ledger`` /
``test_coverage_map`` without a measurement: their steady-state delete rate is a
small fraction of their size, which the default scale factor already handles.

Revision ID: coord_test_results_autovac_01
Revises: coord_retention_idx_01
Create Date: 2026-09-30

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_test_results_autovac_01"
down_revision: str | None = "coord_retention_idx_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Lower coord.test_results' autovacuum trigger to ~1% dead tuples."""
    op.execute(
        "ALTER TABLE coord.test_results SET ("
        "autovacuum_vacuum_scale_factor = 0.01, "
        "autovacuum_vacuum_threshold = 10000)"
    )


def downgrade() -> None:
    """Return coord.test_results to the server-wide autovacuum defaults."""
    op.execute(
        "ALTER TABLE coord.test_results RESET ("
        "autovacuum_vacuum_scale_factor, autovacuum_vacuum_threshold)"
    )
