"""consolidation phase2 v_23 HTN planning columns

Revision ID: consolidation_phase2_v_23_htn_columns
Revises: consolidation_phase2_v_22_phase_results
Create Date: 2026-04-29

Phase 2, v23: add HTN planning columns to ``unified_workflows``.

Source: ``mod.rs:899-907``.

On fresh canonical DB: NO-OP. Phase 1 batch 4 already includes
``htn_enabled``, ``htn_ui_bridge_url``, ``htn_state_machine_path``.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "consolidation_phase2_v_23_htn_columns"
down_revision: str = "consolidation_phase2_v_22_phase_results"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("SET search_path TO project, public")
    op.execute(
        """
        ALTER TABLE unified_workflows ADD COLUMN IF NOT EXISTS htn_enabled BOOLEAN NOT NULL DEFAULT FALSE;
        ALTER TABLE unified_workflows ADD COLUMN IF NOT EXISTS htn_ui_bridge_url TEXT;
        ALTER TABLE unified_workflows ADD COLUMN IF NOT EXISTS htn_state_machine_path TEXT;
        """
    )


def downgrade() -> None:
    op.execute("SET search_path TO project, public")
    op.execute(
        """
        ALTER TABLE unified_workflows DROP COLUMN IF EXISTS htn_state_machine_path;
        ALTER TABLE unified_workflows DROP COLUMN IF EXISTS htn_ui_bridge_url;
        ALTER TABLE unified_workflows DROP COLUMN IF EXISTS htn_enabled;
        """
    )
