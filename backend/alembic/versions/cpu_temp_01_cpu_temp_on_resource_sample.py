"""coord.device_resource_samples — CPU package temperature

Revision ID: cpu_temp_01
Revises: coord_ci_runs_schedule_01
Create Date: 2026-10-13

Phase 1 of plan
``2026-10-13-cpu-temperature-in-fleet-resource-telemetry``.

coord authors **zero** DDL (``[policy: alembic-sole-authorship]``), so the one
column the Linux publishers write and coord ingests and reads lands here, in
qontinui-web, and this revision must merge AND DEPLOY **before** the coord PR
that writes it (the coord INSERT column list is unconditional until plan
Phase 2a; a missing column is 42703 and drops the whole push).
Hand-authored; ``alembic revision --autogenerate`` was not run and is never
run against ``coord.*``.

Why this column exists
=======================

A Linux CI host (msi, a laptop that throttles near 95 C) can be thermally
throttled while every load/memory/disk gauge reads healthy; the slow jobs look
like code failures. Fleet telemetry carried no temperature at all. This adds
one measured, nullable axis to the existing resource-sample pipe.

Semantics: degrees Celsius, the CPU PACKAGE sensor. NULL means UNMEASURED
(host type with no sensor, Windows/WSL in v1, a failed read) and must never
be read or rendered as 0 or "cool". The collector drops wire values outside
-20..150 before they reach this column. REPORTING ONLY: the value must not
feed ``lane_pressure`` / ``lane_saturation`` / headroom (plan D1).

Retention is unchanged: the column rides ``prune_samples``' rolling window on
``sampled_at`` (``COORD_DEVICE_RESOURCE_SAMPLE_RETENTION_DAYS``); it adds one
4-byte REAL per row.

The down_revision below is the single alembic head of ``origin/main`` at
authoring time. If ``alembic-heads-pr`` reports ``HEAD_COUNT=2`` after this
lands, re-point this line and ``_PARENT_REVISION_ID`` in
``tests/test_cpu_temp_01_cpu_temp_on_resource_sample_migration.py`` together.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "cpu_temp_01"
down_revision: str | Sequence[str] | None = "coord_ci_runs_schedule_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE = "coord.device_resource_samples"

# The one column, as data; the migration test pins name and DDL type against
# this tuple. The SQL below spells the same column as a STATIC literal because
# coord's migration classifier can only inspect static op.execute literals.
_CPU_TEMP_COLUMNS: tuple[tuple[str, str], ...] = (("cpu_temp_c", "REAL"),)


def upgrade() -> None:
    """Add the nullable cpu_temp_c REAL column to coord.device_resource_samples."""
    op.execute(
        """
        ALTER TABLE coord.device_resource_samples
            ADD COLUMN IF NOT EXISTS cpu_temp_c REAL
        """
    )

    op.execute(
        """
        COMMENT ON COLUMN coord.device_resource_samples.cpu_temp_c IS
            'CPU package temperature in degrees Celsius at sample time '
            '(plan 2026-10-13-cpu-temperature-in-fleet-resource-telemetry). '
            'Package sensor (x86_pkg_temp, or the hottest coretemp input); '
            'divided to Celsius once at the collector, so the wire is always '
            'Celsius. NULL = NOT MEASURED (Windows or WSL host in v1, a host '
            'with no sensor, a failed read, or a publisher build that '
            'predates this field) and must NEVER be read as 0 or as "cool"; '
            '0 is a legal real measurement and stays distinct from NULL. '
            'REPORTING ONLY: must not feed lane_pressure, lane_saturation or '
            'headroom.'
        """
    )


def downgrade() -> None:
    """Drop the cpu_temp_c column only. Exact reverse of upgrade().

    The COMMENT goes with the column. The DROP is a static literal inside
    this function body, out of the upgrade-path drop scan.
    """
    op.execute(
        """
        ALTER TABLE coord.device_resource_samples
            DROP COLUMN IF EXISTS cpu_temp_c
        """
    )
