"""consolidation phase2 v_13 ui_bridge_baselines

Revision ID: consolidation_phase2_v_13_ui_bridge_baselines
Revises: consolidation_phase2_v_12_drop_orphan_tables
Create Date: 2026-04-29

Phase 2, v13: create ``project.ui_bridge_baselines`` (visual regression
baseline storage).

Source: ``mod.rs:652-671``.

On fresh canonical DB: NO-OP. Phase 1 batch 20 already created it.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "consolidation_phase2_v_13_ui_bridge_baselines"
down_revision: str = "consolidation_phase2_v_12_drop_orphan_tables"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("SET search_path TO project, public")
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS ui_bridge_baselines (
            id              TEXT PRIMARY KEY,
            target_scope    TEXT NOT NULL,
            fingerprint     TEXT,
            png_bytes       BYTEA NOT NULL,
            width           INTEGER NOT NULL,
            height          INTEGER NOT NULL,
            created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            metadata_json   TEXT,
            ttl_days        INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_ui_bridge_baselines_target
            ON ui_bridge_baselines(target_scope);
        """
    )


def downgrade() -> None:
    op.execute("SET search_path TO project, public")
    op.execute("DROP TABLE IF EXISTS ui_bridge_baselines CASCADE")
