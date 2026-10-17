"""coord.fleet_machine_hourly - one row per machine per hour, kept 400 days

Revision ID: fpl_02
Revises: coord_ci_runner_probes_02
Create Date: 2026-10-17

Phase 3 of plan ``2026-10-17-fleet-work-placement-minimizes-time-to-merged-pr``
(D3, fact T3: long-horizon history).

## Why this table exists

``coord.device_resource_samples`` keeps 30 s samples for 7 days and
``coord.ci_job_observations`` keeps per-job rows for 30 days. Neither can
answer a question about last quarter. This table is the long-horizon store:
one row per machine per UTC hour, folded from those two ledgers (and from
``coord.verification_runs`` once plan Phase 4 ships it), kept 400 days.

## What writes it

The ``qontinui-coord`` module ``fleet_machine_hourly``: a leader-gated worker
that folds each completed hour into one row per machine and UPSERTs on the
primary key, so a re-fold after a leader change rewrites the same row. The same
worker deletes rows whose ``hour`` is older than 400 days. Reads:
``GET /coord/fleet/machine-hourly`` and the MCP twin
``coord_query_fleet_machine_hourly``.

## Column contract

* ``machine_key`` TEXT NOT NULL - the dispatch-roles key (``mdroles_01``):
  ``'<device uuid>/'`` for a workstation device, ``'/' || lower(host)`` for a
  CI host.
* ``hour`` TIMESTAMPTZ NOT NULL - the start of the UTC hour the row describes.
* ``tenant_id`` UUID - the tenant the machine's samples carry, else the single
  tenant owning the repos of the jobs it ran. NULL = not resolvable; a
  tenant-scoped read never shows a NULL-tenant row.
* ``coverage_pct`` REAL NOT NULL - the share (0 to 100) of the hour's minutes
  that carried at least one host-lane sample. An hour with no samples is 0, and
  every sample-derived column is then NULL. NULL is UNKNOWN, never zero.
* ``sample_count`` INTEGER NOT NULL - host-lane samples folded.
* ``sessions_p50`` / ``sessions_max`` - active terminal sessions.
* ``ci_jobs_c1`` / ``ci_jobs_c2`` / ``ci_jobs_c3_remote`` - jobs this machine
  ran in the hour by plan D1 class: C1 merge-candidate CI, C2 every other CI
  job, C3-remote verification builds it ran for another machine.
* ``mem_available_p5_bytes`` / ``mem_available_p50_bytes`` and
  ``commit_available_p5_bytes`` / ``commit_available_p50_bytes``.
* ``load_per_core_p50`` / ``load_per_core_p95`` - ``load_1m / cpu_cores``.
* ``swap_used_max_bytes``.
* ``verification_outcomes`` JSONB - ``{outcome: count}`` over the verification
  runs this machine requested in the hour.
* ``folded_at`` TIMESTAMPTZ NOT NULL DEFAULT now() - when the row was written.

Every metric column is nullable with no default: a default would write a 0
into a row the fold could not measure.

Primary key ``(machine_key, hour)``. ``ix_fleet_machine_hourly_tenant_hour``
serves the tenant-scoped read; ``ix_fleet_machine_hourly_hour`` serves the
retention DELETE and the fold's per-hour state read.

## No FK, no ORM model

No FK to ``coord.tenants`` or ``coord.devices``: a machine row must outlive a
device row's churn for 400 days. Coord-only table; web is its schema author,
never a reader.

## Two-repo ordering: this schema half lands and is APPLIED first

alembic in qontinui-web is the SOLE author of ``coord.*`` schema. The coord PR
that writes and reads this table lands after this revision is applied, and
degrades to a logged no-op on a missing relation in any case.

## Head choice

``down_revision`` is ``coord_ci_runner_probes_02``, the single head of
``origin/main`` at ``751b5d1a1`` when this revision was written. Sibling
revisions of the same plan (``fpl_01``, ``fpl_03``) were being authored at the
same time; whichever lands second re-points ``down_revision``, the
``Revises:`` header and ``_PARENT_REVISION_ID`` in the migration test at the
new single head. No ``alembic merge``: this repo keeps strict single-head
discipline.

## Merge-train classifier disposition

coord's migration classifier is expected to classify this revision Reject (a
non-concurrent ``CREATE INDEX``, ``COMMENT ON``, and ``DROP`` in
``downgrade()``), the same as the landed ``coord_ci_job_observations_01``.
Every SQL string is a static literal.

## Safety

A new empty table: ``CREATE TABLE IF NOT EXISTS``, ``CREATE INDEX IF NOT
EXISTS`` and re-runnable ``COMMENT ON``, so a partial apply re-runs cleanly.
No existing table is altered, so no lock on a hot table is taken.
``downgrade()`` drops the two indexes and the table, ``IF EXISTS``. Both
directions are pure static SQL, so they work under ``alembic ... --sql``.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "fpl_02"
down_revision: str | Sequence[str] | None = "coord_ci_runner_probes_02"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Every SQL string below is a STATIC literal. The coord merge-train migration
# classifier extracts string literals from each execute call and rejects a call
# with none as dynamic. Keep these comments free of apostrophes and of the
# op-dot-call spelling: the classifier lexer does not skip Python comments.


def upgrade() -> None:
    """Create coord.fleet_machine_hourly, its two indexes, and document it."""
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.fleet_machine_hourly (
            machine_key                 TEXT        NOT NULL,
            hour                        TIMESTAMPTZ NOT NULL,
            tenant_id                   UUID,
            coverage_pct                REAL        NOT NULL,
            sample_count                INTEGER     NOT NULL,
            sessions_p50                REAL,
            sessions_max                INTEGER,
            ci_jobs_c1                  INTEGER,
            ci_jobs_c2                  INTEGER,
            ci_jobs_c3_remote           INTEGER,
            mem_available_p5_bytes      BIGINT,
            mem_available_p50_bytes     BIGINT,
            commit_available_p5_bytes   BIGINT,
            commit_available_p50_bytes  BIGINT,
            load_per_core_p50           REAL,
            load_per_core_p95           REAL,
            swap_used_max_bytes         BIGINT,
            verification_outcomes       JSONB,
            folded_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT fleet_machine_hourly_pkey PRIMARY KEY (machine_key, hour),
            CONSTRAINT ck_fleet_machine_hourly_coverage
                CHECK (coverage_pct >= 0 AND coverage_pct <= 100)
        )
        """
    )

    # The tenant-scoped read: one tenant, newest hours first.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_fleet_machine_hourly_tenant_hour
            ON coord.fleet_machine_hourly (tenant_id, hour)
        """
    )
    # The retention DELETE and the per-hour fold-state read.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_fleet_machine_hourly_hour
            ON coord.fleet_machine_hourly (hour)
        """
    )

    op.execute(
        """
        COMMENT ON TABLE coord.fleet_machine_hourly IS
            'One row per machine per UTC hour, kept 400 days. Folded and pruned by the coord module fleet_machine_hourly from coord.device_resource_samples (7 days), coord.ci_job_observations (30 days) and coord.verification_runs; UPSERT on (machine_key, hour), so a re-fold rewrites the same row. Plan 2026-10-17-fleet-work-placement-minimizes-time-to-merged-pr, Phase 3 (D3, T3).'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.fleet_machine_hourly.machine_key IS
            'The dispatch-roles machine key: the device uuid followed by a slash for a workstation device, a slash followed by the lowercased host name for a CI host.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.fleet_machine_hourly.tenant_id IS
            'Tenant of the machine samples, else the single tenant owning the repos of the jobs it ran. NULL = not resolvable; a tenant-scoped read never shows a NULL-tenant row.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.fleet_machine_hourly.coverage_pct IS
            'Share (0 to 100) of the minutes of the hour that carried at least one host-lane sample. 0 = no samples: every sample-derived column is then NULL, which is UNKNOWN and never zero.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.fleet_machine_hourly.ci_jobs_c1 IS
            'Merge-candidate CI jobs (head branch merge-candidate, merge-candidate-batch or merge-candidate-spec) this machine ran that started in the hour. NULL = the job ledger was unreadable, or the machine had no samples and no observed job.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.fleet_machine_hourly.ci_jobs_c3_remote IS
            'Verification builds this machine ran for another machine (verification_runs outcome offloaded, received here). NULL = coord.verification_runs absent or unreadable, or the machine had no samples and no such run.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.fleet_machine_hourly.load_per_core_p50 IS
            'Median of load_1m divided by cpu_cores over the host-lane samples of the hour. NULL on a Windows host lane, which publishes no load average.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.fleet_machine_hourly.verification_outcomes IS
            'Outcome to count over the verification runs this machine requested in the hour. NULL = coord.verification_runs absent or unreadable, or the machine had no samples and no run; an empty object = readable, none recorded for a sampled machine.'
        """
    )


def downgrade() -> None:
    """Drop the two indexes and coord.fleet_machine_hourly."""
    op.execute("DROP INDEX IF EXISTS coord.ix_fleet_machine_hourly_hour")
    op.execute("DROP INDEX IF EXISTS coord.ix_fleet_machine_hourly_tenant_hour")
    op.execute("DROP TABLE IF EXISTS coord.fleet_machine_hourly")
