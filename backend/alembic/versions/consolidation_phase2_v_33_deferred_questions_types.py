"""consolidation phase2 v_33 drift fix: runner.deferred_questions type alignment

Revision ID: consolidation_phase2_v_33_deferred_questions_types
Revises: consolidation_phase2_v_32_drift_enum_columns
Create Date: 2026-04-29

Phase 2, v33: drift-fix migration that aligned 6 columns on
``runner.deferred_questions`` from TEXT to UUID/VARCHAR.

Source: ``mod.rs:1318-1395``.

On fresh canonical DB: TRUE NO-OP.

Source body's outermost guard checks for ``table_schema = 'runner'``.
Canonical DB has no ``runner`` schema, so the early ``RETURN``
short-circuits the entire DO block. Zero ALTER statements execute.

Ported verbatim. The canonical ``project.deferred_questions`` (created
by Phase 1 batch 8) was already declared with the correct types per
the schema mapping — no further alignment needed.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "consolidation_phase2_v_33_deferred_questions_types"
down_revision: str = "consolidation_phase2_v_32_drift_enum_columns"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


_V33_BODY = r"""
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'runner' AND table_name = 'deferred_questions'
    ) THEN
        RAISE NOTICE 'v33 skip: runner.deferred_questions does not exist';
        RETURN;
    END IF;

    IF (SELECT data_type FROM information_schema.columns
        WHERE table_schema='runner' AND table_name='deferred_questions' AND column_name='id') = 'text' THEN
        ALTER TABLE runner.deferred_questions
            ALTER COLUMN id TYPE uuid USING id::uuid,
            ALTER COLUMN id SET DEFAULT gen_random_uuid();
        RAISE NOTICE 'v33 fix: runner.deferred_questions.id text -> uuid (with gen_random_uuid default)';
    END IF;

    IF (SELECT data_type FROM information_schema.columns
        WHERE table_schema='runner' AND table_name='deferred_questions' AND column_name='task_run_id') = 'text' THEN
        ALTER TABLE runner.deferred_questions
            ALTER COLUMN task_run_id TYPE uuid USING task_run_id::uuid;
        RAISE NOTICE 'v33 fix: runner.deferred_questions.task_run_id text -> uuid';
    END IF;

    IF (SELECT data_type FROM information_schema.columns
        WHERE table_schema='runner' AND table_name='deferred_questions' AND column_name='status') = 'text' THEN
        ALTER TABLE runner.deferred_questions
            ALTER COLUMN status TYPE varchar(50);
        RAISE NOTICE 'v33 fix: runner.deferred_questions.status text -> varchar(50)';
    END IF;

    IF (SELECT data_type FROM information_schema.columns
        WHERE table_schema='runner' AND table_name='deferred_questions' AND column_name='risk_level') = 'text' THEN
        ALTER TABLE runner.deferred_questions
            ALTER COLUMN risk_level TYPE varchar(50);
        RAISE NOTICE 'v33 fix: runner.deferred_questions.risk_level text -> varchar(50)';
    END IF;

    IF (SELECT data_type FROM information_schema.columns
        WHERE table_schema='runner' AND table_name='deferred_questions' AND column_name='auto_decision_type') = 'text' THEN
        ALTER TABLE runner.deferred_questions
            ALTER COLUMN auto_decision_type TYPE varchar(100);
        RAISE NOTICE 'v33 fix: runner.deferred_questions.auto_decision_type text -> varchar(100)';
    END IF;

    IF (SELECT data_type FROM information_schema.columns
        WHERE table_schema='runner' AND table_name='deferred_questions' AND column_name='git_checkpoint') = 'text' THEN
        ALTER TABLE runner.deferred_questions
            ALTER COLUMN git_checkpoint TYPE varchar(255);
        RAISE NOTICE 'v33 fix: runner.deferred_questions.git_checkpoint text -> varchar(255)';
    END IF;
END $$;
"""


def upgrade() -> None:
    op.execute(_V33_BODY)


def downgrade() -> None:
    pass
