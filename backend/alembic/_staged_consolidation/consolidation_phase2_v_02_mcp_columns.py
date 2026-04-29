"""consolidation phase2 v_02 mcp_servers columns

Revision ID: consolidation_phase2_v_02_mcp_columns
Revises: consolidation_phase2_v_01_baseline
Create Date: 2026-04-29

Phase 2, v2: add connection_state / last_error / last_connected_at to
``project.mcp_servers``.

Source: ``mod.rs:124-132``.

On fresh canonical DB: NO-OP. Phase 1 batch 7 already created
``project.mcp_servers`` with these columns. ``ADD COLUMN IF NOT EXISTS``
is idempotent. On legacy DB: applies the columns as the historical
v2 did.

Style: Option 2A (raw ``op.execute`` with ``SET search_path`` prefix)
for SQL fidelity to the source.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "consolidation_phase2_v_02_mcp_columns"
down_revision: str = "consolidation_phase2_v_01_baseline"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("SET search_path TO project, public")
    op.execute(
        """
        ALTER TABLE mcp_servers ADD COLUMN IF NOT EXISTS connection_state TEXT NOT NULL DEFAULT 'disconnected';
        ALTER TABLE mcp_servers ADD COLUMN IF NOT EXISTS last_error TEXT;
        ALTER TABLE mcp_servers ADD COLUMN IF NOT EXISTS last_connected_at TIMESTAMPTZ;
        """
    )


def downgrade() -> None:
    op.execute("SET search_path TO project, public")
    op.execute(
        """
        ALTER TABLE mcp_servers DROP COLUMN IF EXISTS last_connected_at;
        ALTER TABLE mcp_servers DROP COLUMN IF EXISTS last_error;
        ALTER TABLE mcp_servers DROP COLUMN IF EXISTS connection_state;
        """
    )
