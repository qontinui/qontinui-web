"""consolidation phase2 v_18 workflow_event_log

Revision ID: consolidation_phase2_v_18_workflow_event_log
Revises: consolidation_phase2_v_17_dag_columns
Create Date: 2026-04-29

Phase 2, v18: create ``project.workflow_event_log`` for DAG durable
execution.

Source: ``mod.rs:779-795``.

On fresh canonical DB: NO-OP. Phase 1 batch 20 created it.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "consolidation_phase2_v_18_workflow_event_log"
down_revision: str = "consolidation_phase2_v_17_dag_columns"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("SET search_path TO project, public")
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS workflow_event_log (
            id              BIGSERIAL PRIMARY KEY,
            execution_id    TEXT NOT NULL REFERENCES task_runs(id) ON DELETE CASCADE,
            node_id         TEXT NOT NULL,
            event_type      TEXT NOT NULL,
            event_data      TEXT,
            cursor          BIGINT NOT NULL,
            created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_event_log_execution ON workflow_event_log(execution_id, cursor);
        CREATE INDEX IF NOT EXISTS idx_event_log_node ON workflow_event_log(execution_id, node_id);
        """
    )


def downgrade() -> None:
    op.execute("SET search_path TO project, public")
    op.execute("DROP TABLE IF EXISTS workflow_event_log CASCADE")
