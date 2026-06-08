"""coord.commit_lineage tenant_id — tenant-scope the commit↔session lineage feed

Revision ID: coord_commit_lineage_tenant_id
Revises: lineage_recorded_at_idx_01
Create Date: 2026-06-08

Adds ``tenant_id UUID NULL`` to ``coord.commit_lineage`` so the lineage read
endpoints (``GET /coord/lineage/recent``, ``GET /coord/lineage/stats``,
``GET /coord/sessions/:id/commits``) can be filtered per tenant. Those
endpoints are ``FleetPrincipal``-gated (auth-only) but previously scanned the
WHOLE table — every operator saw every tenant's commits. A customer-facing
qontinui-web ``/commits`` page now surfaces this feed, so it must be
tenant-scoped.

This mirrors the established coord tenant-scoping pattern (denormalized
``tenant_id`` column populated on write, filtered on read) exemplified by
``coord_device_status_tenant_id`` — see that migration for the column STYLE.

Column is deliberately NULL-able:

* Pre-existing rows pre-date the column. The backfill below resolves a tenant
  for every attributed row via the session→device→tenant chain, but rows whose
  ``agent_session_id`` is NULL (unattributed commits) or whose session has no
  resolvable device/tenant legitimately stay NULL.
* New writes pick up ``tenant_id`` on INSERT (the Rust side in this same PR
  family: ``commit_lineage.rs::post_commits_report`` from the
  ``X-Qontinui-Tenant-Id`` header, and
  ``repo_branches.rs::record_merge_commit_lineage`` from the resolved
  worktree's device tenant).

Read scoping (Rust side): non-admin ``FleetPrincipal`` reads add
``WHERE tenant_id = $principal_tenant``; NULL-tenant rows are correctly
invisible to non-admins. Admin (staff) reads apply NO tenant filter and see the
whole fleet — matching the ``is_admin`` semantics in ``fleet_principal.rs``.

Partial index ``idx_commit_lineage_tenant`` on
``(tenant_id, recorded_at DESC) WHERE tenant_id IS NOT NULL`` so the per-tenant
``recent``/``stats`` scans (which order/limit by ``recorded_at DESC``) hit an
index.

Idempotency / authorship posture
================================

* DDL uses ``ADD COLUMN IF NOT EXISTS`` / ``CREATE INDEX IF NOT EXISTS`` /
  ``DROP ... IF EXISTS`` raw ``op.execute`` — matching the ``coord.*``
  migration house style. coord boots against this same schema, so re-running
  against an already-applied DB must be a no-op.
* **alembic is the SOLE author of the coord.* schema.** No Rust
  ``CREATE``/``ALTER`` self-heal — the Rust side only SELECTs / INSERTs.

Chains off the current single head ``lineage_recorded_at_idx_01`` (verified: no
other revision lists it as a ``down_revision`` as of 2026-06-08).
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_commit_lineage_tenant_id"
down_revision: str | Sequence[str] | None = "lineage_recorded_at_idx_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add ``coord.commit_lineage.tenant_id`` + partial index + backfill. Idempotent."""
    # ----------------------------------------------------------------
    # 1. ADD COLUMN IF NOT EXISTS tenant_id UUID NULL.
    #
    # No FK here: the sibling lineage columns (agent_session_id) carry a
    # coord-schema FK, but tenant attribution is a denormalized snapshot
    # (the same posture as the device → tenant resolve). A tenant deletion
    # should not cascade-wipe audit rows; leaving the cell as a plain UUID
    # keeps the historical fact intact. (coord_device_status_tenant_id adds
    # an ON DELETE SET NULL FK to coord.tenants; commit_lineage is an
    # append-only audit surface, so a bare nullable UUID is sufficient and
    # avoids coupling forensic rows to the tenants table lifecycle.)
    # ----------------------------------------------------------------
    op.execute(
        """
        ALTER TABLE coord.commit_lineage
            ADD COLUMN IF NOT EXISTS tenant_id UUID
        """
    )

    # ----------------------------------------------------------------
    # 2. Partial index on (tenant_id, recorded_at DESC) WHERE tenant_id
    #    IS NOT NULL. Supports the per-tenant `recent`/`stats` scans whose
    #    ORDER BY / window is recorded_at DESC.
    # ----------------------------------------------------------------
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_commit_lineage_tenant
            ON coord.commit_lineage (tenant_id, recorded_at DESC)
            WHERE tenant_id IS NOT NULL
        """
    )

    # ----------------------------------------------------------------
    # 3. Backfill existing rows from the session → device → tenant chain.
    #
    #    coord.commit_lineage.agent_session_id → coord.agent_sessions.id,
    #    coord.agent_sessions.device_id → coord.devices.device_id,
    #    coord.devices.tenant_id is the authoritative per-row tenant.
    #
    #    Only attributed rows (agent_session_id NOT NULL) with a resolvable
    #    device + tenant get filled; unattributed / device-less rows stay
    #    NULL (correctly invisible to non-admin reads).
    # ----------------------------------------------------------------
    op.execute(
        """
        UPDATE coord.commit_lineage cl
           SET tenant_id = d.tenant_id
          FROM coord.agent_sessions s
          JOIN coord.devices d ON d.device_id = s.device_id
         WHERE s.id = cl.agent_session_id
           AND cl.tenant_id IS NULL
        """
    )


def downgrade() -> None:
    """Drop the partial index + tenant_id column."""
    op.execute("DROP INDEX IF EXISTS coord.idx_commit_lineage_tenant")
    op.execute("ALTER TABLE coord.commit_lineage DROP COLUMN IF EXISTS tenant_id")
