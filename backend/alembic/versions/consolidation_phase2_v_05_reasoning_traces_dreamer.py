"""consolidation phase2 v_05 reasoning_traces + dreamer columns

Revision ID: consolidation_phase2_v_05_reasoning_traces_dreamer
Revises: consolidation_phase2_v_04_entity_profiles
Create Date: 2026-04-29

Phase 2, v5: create ``project.reasoning_traces`` and add Dreamer
columns to ``project.memory_consolidation_log``.

Source: ``mod.rs:191-218``.

On fresh canonical DB: NO-OP. Phase 1 batch 20 created
``project.reasoning_traces`` and added the Dreamer columns to
``memory_consolidation_log``.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "consolidation_phase2_v_05_reasoning_traces_dreamer"
down_revision: str = "consolidation_phase2_v_04_entity_profiles"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("SET search_path TO project, public")
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS reasoning_traces (
            id BIGSERIAL PRIMARY KEY,
            reasoning_type TEXT NOT NULL,
            premise_ids BIGINT[] NOT NULL,
            conclusion TEXT NOT NULL,
            confidence DOUBLE PRECISION NOT NULL DEFAULT 0.5,
            evidence_json TEXT,
            created_observation_id BIGINT REFERENCES observations(id),
            dreamer_run_id BIGINT,
            is_valid BOOLEAN NOT NULL DEFAULT true,
            invalidated_by BIGINT REFERENCES reasoning_traces(id),
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_rt_type ON reasoning_traces(reasoning_type);
        CREATE INDEX IF NOT EXISTS idx_rt_run ON reasoning_traces(dreamer_run_id);
        CREATE INDEX IF NOT EXISTS idx_rt_created ON reasoning_traces(created_at);
        CREATE INDEX IF NOT EXISTS idx_rt_valid ON reasoning_traces(is_valid) WHERE is_valid;

        ALTER TABLE memory_consolidation_log ADD COLUMN IF NOT EXISTS is_dreamer BOOLEAN NOT NULL DEFAULT false;
        ALTER TABLE memory_consolidation_log ADD COLUMN IF NOT EXISTS inductive_traces INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE memory_consolidation_log ADD COLUMN IF NOT EXISTS deductive_traces INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE memory_consolidation_log ADD COLUMN IF NOT EXISTS abductive_traces INTEGER NOT NULL DEFAULT 0;
        """
    )


def downgrade() -> None:
    op.execute("SET search_path TO project, public")
    op.execute(
        """
        ALTER TABLE memory_consolidation_log DROP COLUMN IF EXISTS abductive_traces;
        ALTER TABLE memory_consolidation_log DROP COLUMN IF EXISTS deductive_traces;
        ALTER TABLE memory_consolidation_log DROP COLUMN IF EXISTS inductive_traces;
        ALTER TABLE memory_consolidation_log DROP COLUMN IF EXISTS is_dreamer;
        DROP TABLE IF EXISTS reasoning_traces CASCADE;
        """
    )
