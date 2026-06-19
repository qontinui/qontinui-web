"""coord.work_units + coord.work_unit_status_history (generic work-unit primitive)

Revision ID: coord_workunits_01_work_units
Revises: coord_session_messages
Create Date: 2026-06-18

Phase 1 of plan
``D:/qontinui-root/plans/2026-06-18-coord-generic-work-unit-primitive.md``
("coord stops knowing about plans").

Additive schema for a generic ``coord.work_units`` primitive — a
slug-keyed, opaque-status work record that generalizes ``coord.plans``.
``status`` is a caller-supplied string; coord does NOT validate it
against any vocabulary, so there is intentionally NO CHECK constraint on
it. Global slug uniqueness is enforced by a partial-unique index (the
cross-tenant 409 guard added in Phase 2 relies on it), mirroring
``idx_plans_slug``. ``tenant_id`` is nullable — tenant-scoped resolution
comes from the JWT at DML time, mirroring ``coord.plans``.

alembic is the sole author of this schema. Rust (coord) only DMLs against
these tables and asserts them present at boot via ``state::require_table``
(see ``ALEMBIC_OWNED_TABLES`` in ``qontinui-coord/src/main.rs``); this web
migration MUST be applied to prod RDS BEFORE the coord image deploys, or
coord crash-loops on the boot gate (same deploy-order rule as
``work_plans`` / ``release_observations``).

Collision-safe raw ``IF NOT EXISTS`` — see ``coord_singleauthored_01_gates``.
"""

from collections.abc import Sequence

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "coord_workunits_01_work_units"
down_revision: str | Sequence[str] | None = "coord_session_messages"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create ``coord.work_units`` + ``coord.work_unit_status_history``. Idempotent."""
    op.execute("CREATE SCHEMA IF NOT EXISTS coord")

    # work_units — generic slug-keyed work record. status is opaque
    # (no CHECK); tenant_id nullable (resolved from JWT at DML time).
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.work_units (
            id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            slug        TEXT NOT NULL,
            tenant_id   UUID,
            status      TEXT NOT NULL,
            title       TEXT,
            metadata    JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    # Partial-unique index on slug — enforces global slug uniqueness
    # (Phase-2 cross-tenant 409 guard relies on it). Mirrors idx_plans_slug.
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS idx_work_units_slug
            ON coord.work_units(slug) WHERE slug IS NOT NULL
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_work_units_tenant
            ON coord.work_units(tenant_id)
        """
    )

    # work_unit_status_history — status-transition audit log.
    # FK against coord.work_units(id) PK, cascade on delete.
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.work_unit_status_history (
            history_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            work_unit_id     UUID NOT NULL
                REFERENCES coord.work_units(id) ON DELETE CASCADE,
            from_status      TEXT,
            to_status        TEXT NOT NULL,
            transitioned_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
            by_actor         TEXT,
            reason           TEXT
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_work_unit_status_history_unit
            ON coord.work_unit_status_history(work_unit_id)
        """
    )


def downgrade() -> None:
    """Reverse: drop history (FK child) first, then work_units + indexes."""
    op.execute(
        "DROP INDEX IF EXISTS coord.idx_work_unit_status_history_unit"
    )
    op.execute("DROP TABLE IF EXISTS coord.work_unit_status_history")
    op.execute("DROP INDEX IF EXISTS coord.idx_work_units_tenant")
    op.execute("DROP INDEX IF EXISTS coord.idx_work_units_slug")
    op.execute("DROP TABLE IF EXISTS coord.work_units")
