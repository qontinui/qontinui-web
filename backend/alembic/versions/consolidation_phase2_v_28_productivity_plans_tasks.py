"""consolidation phase2 v_28 productivity stack: plans + tasks (CROSS-SCHEMA)

Revision ID: consolidation_phase2_v_28_productivity_plans_tasks
Revises: consolidation_phase2_v_27_int4_to_bigint_drift
Create Date: 2026-04-29

Phase 2, v28: create ``plans`` and ``tasks`` tables in ``coord``.

Source: ``mod.rs:1031-1080``.

DEVIATION FROM "EVERYTHING → PROJECT" DEFAULT:
Per the schema mapping in the plan, productivity-stack plans/tasks
coordinate work across runner instances → coord schema. Phase 1 batch
20 created ``coord.plans`` and ``coord.tasks``. To match Phase 1's
canonical end-state this port targets ``coord``.

Style: schema-qualified raw SQL via op.execute (Option 2B variant,
without alembic-op translation).

On fresh canonical DB: NO-OP. ``CREATE TABLE IF NOT EXISTS`` on the
Phase-1-created tables is idempotent.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "consolidation_phase2_v_28_productivity_plans_tasks"
down_revision: str = "consolidation_phase2_v_27_int4_to_bigint_drift"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.plans (
            id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            markdown_path   TEXT NOT NULL,
            version_hash    TEXT NOT NULL,
            status          TEXT NOT NULL DEFAULT 'draft',
            title           TEXT,
            summary         TEXT,
            created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_plans_path ON coord.plans(markdown_path);
        CREATE INDEX IF NOT EXISTS idx_plans_status ON coord.plans(status);

        CREATE TABLE IF NOT EXISTS coord.tasks (
            id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            plan_id                 UUID NOT NULL REFERENCES coord.plans(id) ON DELETE CASCADE,
            plan_version_hash       TEXT NOT NULL,
            phase_name              TEXT NOT NULL,
            sequence_in_phase       INTEGER NOT NULL,
            description             TEXT NOT NULL,
            expected_file_claims    TEXT[] NOT NULL DEFAULT '{}',
            expected_dirs           TEXT[] NOT NULL DEFAULT '{}',
            depends_on              UUID[] NOT NULL DEFAULT '{}',
            status                  TEXT NOT NULL DEFAULT 'pending',
            assigned_session_id     TEXT,
            started_at              TIMESTAMPTZ,
            completed_at            TIMESTAMPTZ,
            created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            notes                   TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_tasks_plan ON coord.tasks(plan_id);
        CREATE INDEX IF NOT EXISTS idx_tasks_status ON coord.tasks(status);
        CREATE INDEX IF NOT EXISTS idx_tasks_assigned_session
            ON coord.tasks(assigned_session_id) WHERE assigned_session_id IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_tasks_phase
            ON coord.tasks(plan_id, phase_name, sequence_in_phase);
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS coord.tasks CASCADE")
    op.execute("DROP TABLE IF EXISTS coord.plans CASCADE")
