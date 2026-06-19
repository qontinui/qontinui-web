"""coord.work_units.owner_actor_key (work-unit authz: actor identity)

Revision ID: coord_workunits_03_work_unit_owner_actor
Revises: machine_display_names_01
Create Date: 2026-06-18

Phase 2 (§7.2/§7.7) of plan
``D:/qontinui-root/plans/2026-06-18-coord-workunit-authz-graduated-trust.md``
("work-unit authz: evidence-based + graduated trust").

Additive: adds a server-derived ``owner_actor_key`` to ``coord.work_units``.
The column is NULLABLE — coord stamps it server-side (never caller-supplied,
mirroring how ``tenant_id`` is lifted from the verified JWT) on the FIRST
implementing transition (``→ in_progress``) if unset. It records
``device_id[:agent_id]`` from the auth context so the separation-of-duties
check (``attester_key != owner_actor_key``) and the per-actor graduation
domain can key off a non-forgeable identity.

A supporting index on ``(tenant_id, owner_actor_key)`` backs the Phase-3
graduation domain queries, which evaluate ``lifecycle_autonomy`` per
``(tenant_id, owner_actor_key)``.

alembic is the sole author of this schema. Rust (coord) only DMLs against
these tables and asserts them present at boot via ``state::require_table``;
this web migration MUST be applied to prod RDS BEFORE the coord image
deploys, or coord crash-loops on the boot gate (same deploy-order rule as
``coord_workunits_01_work_units``).

Collision-safe raw ``IF NOT EXISTS`` — see ``coord_singleauthored_01_gates``.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_workunits_03_work_unit_owner_actor"
down_revision: str | Sequence[str] | None = "machine_display_names_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add ``owner_actor_key`` + supporting index. Idempotent."""
    op.execute("CREATE SCHEMA IF NOT EXISTS coord")

    # Nullable, server-stamped on the first implementing transition.
    op.execute(
        """
        ALTER TABLE coord.work_units
            ADD COLUMN IF NOT EXISTS owner_actor_key TEXT
        """
    )
    # Backs the Phase-3 graduation domain queries, which evaluate
    # lifecycle_autonomy per (tenant_id, owner_actor_key).
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_work_units_owner_actor
            ON coord.work_units(tenant_id, owner_actor_key)
        """
    )


def downgrade() -> None:
    """Reverse: drop the index first, then the column."""
    op.execute("DROP INDEX IF EXISTS coord.idx_work_units_owner_actor")
    op.execute("ALTER TABLE coord.work_units DROP COLUMN IF EXISTS owner_actor_key")
