"""coord device_status tenant_id — add tenant scoping to machine activity surface

Revision ID: coord_device_status_tenant_id
Revises: pr_merge_04_merge_heads
Create Date: 2026-05-21

Phase 1.1 of the 2026-05-21 coordination-improvements rollout
(``D:/qontinui-root/plans/2026-05-21-coordination-improvements.md``).

Adds ``tenant_id UUID NULL`` to ``coord.device_status`` so the per-machine
"what is each agent doing right now" surface can be filtered by tenant. The
table was originally created as ``coord.machine_status`` in
``coordinator_phase_6_agent_coordination_hardening`` and was renamed to
``coord.device_status`` by ``ud01_unify_devices_registry``. Plan text uses
the original ``machine_status`` name; the actual physical table this
revision targets is ``coord.device_status``.

Column is deliberately NULL-able:

* Pre-existing rows pre-date the column and have no resolvable tenant
  without an explicit backfill — the Phase 1 default-tenant rollout
  already shipped device-side tenant resolution (``coord.devices.tenant_id``)
  but ``device_status`` rows are short-lived (1h ``prune_stale``) and a
  backfill would be obsolete before the next sweep.
* New writes pick up ``tenant_id`` from ``StatusUpsert.tenant_id``
  (Rust side change in this same PR family); a future migration can
  tighten to NOT NULL once every writer is upgraded.

Partial index ``idx_device_status_tenant`` on
``(tenant_id, updated_at DESC) WHERE tenant_id IS NOT NULL`` so the new
``GET /coord/status?tenant_id=<uuid>`` filter hits an index even at the
small row counts this table sees in practice.

Why parented off ``pr_merge_04_merge_heads``
--------------------------------------------
``pr_merge_04_merge_heads`` is the current single head after the
PR Merge Orchestrator Phase 4 + Phase 5 sibling-head merge. This revision
sits downstream of it as a fresh leaf. Per
``feedback_verify_origin_state_before_phase_start``, the worktree was
re-fetched immediately before writing this file to confirm no parallel
session moved the head between plan write and phase execution.

Why not parented off ``coord_devices_tenant_id``
------------------------------------------------
The default-tenant-propagation chain (``coord_tenant_scope_columns`` →
``coord_devices_tenant_id`` → ``coord_tenant_id_not_null``) already
folded into the linear chain via ``pr_merge_04_merge_heads``. Parenting
here matches the contemporary head and avoids re-introducing a sibling
fork.
"""

from collections.abc import Sequence

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "coord_device_status_tenant_id"
down_revision: str = "pr_merge_04_merge_heads"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add ``coord.device_status.tenant_id`` + partial index. Idempotent."""
    # ----------------------------------------------------------------
    # 1. ADD COLUMN IF NOT EXISTS tenant_id UUID NULL.
    #
    # FK to coord.tenants(tenant_id) ON DELETE SET NULL — matches the
    # ``coord_tenant_scope_columns`` posture for other scoped data
    # tables. A tenant deletion shouldn't cascade-wipe activity rows;
    # those age out via ``prune_stale()`` within an hour anyway.
    # ----------------------------------------------------------------
    op.execute(
        """
        ALTER TABLE coord.device_status
            ADD COLUMN IF NOT EXISTS tenant_id UUID
                REFERENCES coord.tenants(tenant_id) ON DELETE SET NULL
        """
    )

    # ----------------------------------------------------------------
    # 2. Partial index on (tenant_id, updated_at DESC) WHERE tenant_id
    #    IS NOT NULL. Supports the
    #    ``GET /coord/status?tenant_id=<uuid>`` filter; the ordering
    #    column matches the handler's ``ORDER BY updated_at DESC``.
    # ----------------------------------------------------------------
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_device_status_tenant
            ON coord.device_status (tenant_id, updated_at DESC)
            WHERE tenant_id IS NOT NULL
        """
    )


def downgrade() -> None:
    """Drop the partial index + tenant_id column."""
    op.execute("DROP INDEX IF EXISTS coord.idx_device_status_tenant")
    op.execute("ALTER TABLE coord.device_status DROP COLUMN IF EXISTS tenant_id")
