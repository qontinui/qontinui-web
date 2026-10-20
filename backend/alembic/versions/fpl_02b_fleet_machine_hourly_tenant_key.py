"""coord.fleet_machine_hourly - key rows by tenant, machine and hour

Revision ID: fpl_02b
Revises: pr_fix_ctx_head_sha_01
Create Date: 2026-10-17

Phase 3 of plan ``2026-10-17-fleet-work-placement-minimizes-time-to-merged-pr``
(D3, fact T3). A follow-up to ``fpl_02``, which created the table.

## Why

``fpl_02`` keyed the table ``(machine_key, hour)`` with a nullable
``tenant_id``. ``machine_key`` is not unique across tenants: a CI host is keyed
``'/' || lower(host)``, so two tenants each running a host called ``runner-1``
(or one host serving both) share a key. With one row per key and hour, the
coord fold had to pick ONE tenant for the row, and that row then carried the
other tenant's resource samples, readable by the tenant that won it.

The coord writer (module ``fleet_machine_hourly``) therefore folds one row per
``(tenant, machine)`` and UPSERTs on ``(tenant_id, machine_key, hour)``. This
revision makes the table carry that key:

* ``tenant_id`` becomes NOT NULL. A row nobody's tenant-scoped read can show
  is not written at all.
* The primary key becomes ``(tenant_id, machine_key, hour)``, so a second
  tenant's row under the same machine key and hour is its own row.

``fpl_02`` is already on ``main`` and may already be applied, so it is not
edited: a revision alembic has recorded never re-runs.

## Data

No coord build writes this table before this revision lands: the coord writer
ships after it. Any row with a NULL ``tenant_id`` is unreadable by every
tenant-scoped read and is deleted before the column is made NOT NULL.

## Downgrade

Restores ``(machine_key, hour)`` and the nullable column. Rows that would
collide under the narrower key (two tenants on one key and hour) are reduced to
the row of the smallest ``tenant_id`` first, because the old key cannot hold
both. That loses the other tenant's rows for those hours, which is the shape
the old key forces.

## Merge-train classifier disposition

A ``DELETE``, an ``ALTER COLUMN ... SET NOT NULL`` and a primary-key swap on a
coord table: expected Reject, the same as ``fpl_02``. Every SQL string is a
static literal, and both directions work under ``alembic ... --sql``.

## Safety

The table holds no rows written by any landed coord build, so the
``ACCESS EXCLUSIVE`` lock the key swap takes is on an empty or near-empty table.
Each step is re-runnable: the DELETE is idempotent, SET NOT NULL on a NOT NULL
column is a no-op, and the constraint is dropped ``IF EXISTS`` before it is
re-added.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "fpl_02b"
down_revision: str | Sequence[str] | None = "pr_fix_ctx_head_sha_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Every SQL string below is a STATIC literal. The coord merge-train migration
# classifier extracts string literals from each execute call and rejects a call
# with none as dynamic. Keep these comments free of apostrophes and of the
# op-dot-call spelling: the classifier lexer does not skip Python comments.


def upgrade() -> None:
    """Make tenant_id NOT NULL and key the table by tenant, machine and hour."""
    op.execute("DELETE FROM coord.fleet_machine_hourly WHERE tenant_id IS NULL")
    op.execute(
        "ALTER TABLE coord.fleet_machine_hourly ALTER COLUMN tenant_id SET NOT NULL"
    )
    op.execute(
        "ALTER TABLE coord.fleet_machine_hourly "
        "DROP CONSTRAINT IF EXISTS fleet_machine_hourly_pkey"
    )
    op.execute(
        "ALTER TABLE coord.fleet_machine_hourly "
        "ADD CONSTRAINT fleet_machine_hourly_pkey "
        "PRIMARY KEY (tenant_id, machine_key, hour)"
    )
    op.execute(
        """
        COMMENT ON TABLE coord.fleet_machine_hourly IS
            'One row per tenant and machine per UTC hour, kept 400 days. Folded and pruned by the coord module fleet_machine_hourly from coord.device_resource_samples (7 days), coord.ci_job_observations (30 days) and coord.verification_runs; UPSERT on (tenant_id, machine_key, hour), so a re-fold rewrites the same row. Plan 2026-10-17-fleet-work-placement-minimizes-time-to-merged-pr, Phase 3 (D3, T3).'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.fleet_machine_hourly.tenant_id IS
            'The tenant whose data this row folds: only host-lane samples carrying this tenant, jobs of repos this tenant owns, and this tenant verification runs. A machine shared by two tenants, or two tenant hosts sharing a host name, gets one row per tenant; no tenant numbers are folded into another tenant row.'
        """
    )


def downgrade() -> None:
    """Restore the (machine_key, hour) key and the nullable tenant_id."""
    op.execute(
        """
        DELETE FROM coord.fleet_machine_hourly AS f
         USING coord.fleet_machine_hourly AS keep
         WHERE keep.machine_key = f.machine_key
           AND keep.hour = f.hour
           AND keep.tenant_id < f.tenant_id
        """
    )
    op.execute(
        "ALTER TABLE coord.fleet_machine_hourly "
        "DROP CONSTRAINT IF EXISTS fleet_machine_hourly_pkey"
    )
    op.execute(
        "ALTER TABLE coord.fleet_machine_hourly "
        "ADD CONSTRAINT fleet_machine_hourly_pkey PRIMARY KEY (machine_key, hour)"
    )
    op.execute(
        "ALTER TABLE coord.fleet_machine_hourly ALTER COLUMN tenant_id DROP NOT NULL"
    )
    op.execute(
        """
        COMMENT ON TABLE coord.fleet_machine_hourly IS
            'One row per machine per UTC hour, kept 400 days. Folded and pruned by the coord module fleet_machine_hourly from coord.device_resource_samples (7 days), coord.ci_job_observations (30 days) and coord.verification_runs; UPSERT on (machine_key, hour), so a re-fold rewrites the same row. Plan 2026-10-17-fleet-work-placement-minimizes-time-to-merged-pr, Phase 3 (D3, T3).'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.fleet_machine_hourly.tenant_id IS
            'Tenant of the machine samples, else the single tenant owning the repos of the jobs it ran. NULL = not resolvable; a tenant-scoped read never shows a NULL-tenant row. The row counts only this tenant jobs and verification runs, never another tenant activity on a shared machine.'
        """
    )
