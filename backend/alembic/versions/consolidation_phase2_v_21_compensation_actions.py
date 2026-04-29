"""consolidation phase2 v_21 compensation_actions

Revision ID: consolidation_phase2_v_21_compensation_actions
Revises: consolidation_phase2_v_20_consolidate_runner_schema_noop
Create Date: 2026-04-29

Phase 2, v21: create ``project.compensation_actions`` (LIFO
compensation stack for restate-port-part-a).

Source: ``mod.rs:858-875``.

On fresh canonical DB: NO-OP. Phase 1 batch 20 created it.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "consolidation_phase2_v_21_compensation_actions"
down_revision: str = "consolidation_phase2_v_20_consolidate_runner_schema_noop"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("SET search_path TO project, public")
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS compensation_actions (
            id              BIGSERIAL PRIMARY KEY,
            execution_id    TEXT NOT NULL,
            action_index    INT NOT NULL,
            action_json     JSONB NOT NULL,
            executed        BOOLEAN NOT NULL DEFAULT FALSE,
            result_json     JSONB,
            created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            executed_at     TIMESTAMPTZ
        );
        CREATE INDEX IF NOT EXISTS idx_ca_execution ON compensation_actions(execution_id);
        CREATE INDEX IF NOT EXISTS idx_ca_pending ON compensation_actions(execution_id) WHERE NOT executed;
        """
    )


def downgrade() -> None:
    op.execute("SET search_path TO project, public")
    op.execute("DROP TABLE IF EXISTS compensation_actions CASCADE")
