"""consolidation phase2 v_17 DAG workflow columns

Revision ID: consolidation_phase2_v_17_dag_columns
Revises: consolidation_phase2_v_16_breakpoint_snapshots
Create Date: 2026-04-29

Phase 2, v17: add ``source_yaml`` to ``unified_workflows`` and
``dag_node_metrics`` to ``learning_outcomes`` for DAG workflows.

Source: ``mod.rs:771-778``.

On fresh canonical DB: NO-OP. Both columns folded into Phase 1
(batch 4 ``unified_workflows.source_yaml``, batch 5
``learning_outcomes.dag_node_metrics``).
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "consolidation_phase2_v_17_dag_columns"
down_revision: str = "consolidation_phase2_v_16_breakpoint_snapshots"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("SET search_path TO project, public")
    op.execute(
        """
        ALTER TABLE unified_workflows ADD COLUMN IF NOT EXISTS source_yaml TEXT;
        ALTER TABLE learning_outcomes ADD COLUMN IF NOT EXISTS dag_node_metrics TEXT;
        """
    )


def downgrade() -> None:
    op.execute("SET search_path TO project, public")
    op.execute(
        """
        ALTER TABLE learning_outcomes DROP COLUMN IF EXISTS dag_node_metrics;
        ALTER TABLE unified_workflows DROP COLUMN IF EXISTS source_yaml;
        """
    )
