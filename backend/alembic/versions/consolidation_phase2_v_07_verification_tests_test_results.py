"""consolidation phase2 v_07 verification_tests + test_results

Revision ID: consolidation_phase2_v_07_verification_tests_test_results
Revises: consolidation_phase2_v_06_task_runs_review_blocking
Create Date: 2026-04-29

Phase 2, v7: extend verification_tests with rich-test columns; ensure
test_results table.

Source: ``mod.rs:230-287``.

On fresh canonical DB: NO-OP. Phase 1 batches 13 and 19 created both
tables with the post-v7 column set.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "consolidation_phase2_v_07_verification_tests_test_results"
down_revision: str = "consolidation_phase2_v_06_task_runs_review_blocking"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("SET search_path TO project, public")
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS verification_tests (
            id                  TEXT PRIMARY KEY,
            name                TEXT NOT NULL,
            description         TEXT,
            workflow_id         TEXT,
            test_type           TEXT NOT NULL DEFAULT 'python_script',
            command             TEXT,
            expected_exit_code  INTEGER DEFAULT 0,
            expected_output     TEXT,
            timeout_seconds     INTEGER DEFAULT 60,
            enabled             BOOLEAN NOT NULL DEFAULT true,
            tags                TEXT DEFAULT '[]',
            created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        ALTER TABLE verification_tests ADD COLUMN IF NOT EXISTS category TEXT;
        ALTER TABLE verification_tests ADD COLUMN IF NOT EXISTS playwright_code TEXT;
        ALTER TABLE verification_tests ADD COLUMN IF NOT EXISTS vision_config TEXT;
        ALTER TABLE verification_tests ADD COLUMN IF NOT EXISTS python_code TEXT;
        ALTER TABLE verification_tests ADD COLUMN IF NOT EXISTS repo_test_config TEXT;
        ALTER TABLE verification_tests ADD COLUMN IF NOT EXISTS success_criteria TEXT;
        ALTER TABLE verification_tests ADD COLUMN IF NOT EXISTS config TEXT NOT NULL DEFAULT '{}';
        ALTER TABLE verification_tests ADD COLUMN IF NOT EXISTS is_critical BOOLEAN NOT NULL DEFAULT false;
        ALTER TABLE verification_tests ADD COLUMN IF NOT EXISTS ai_generated BOOLEAN NOT NULL DEFAULT false;
        ALTER TABLE verification_tests ADD COLUMN IF NOT EXISTS ai_generation_prompt TEXT;
        ALTER TABLE verification_tests ADD COLUMN IF NOT EXISTS creation_analysis TEXT;
        ALTER TABLE verification_tests ADD COLUMN IF NOT EXISTS source_file TEXT;
        ALTER TABLE verification_tests ADD COLUMN IF NOT EXISTS last_exported_at TIMESTAMPTZ;
        CREATE INDEX IF NOT EXISTS idx_verification_tests_category ON verification_tests(category) WHERE category IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_verification_tests_enabled ON verification_tests(enabled) WHERE enabled;

        CREATE TABLE IF NOT EXISTS test_results (
            id                  TEXT PRIMARY KEY,
            test_id             TEXT NOT NULL,
            task_run_id         TEXT,
            status              TEXT NOT NULL DEFAULT 'pending',
            started_at          TIMESTAMPTZ,
            completed_at        TIMESTAMPTZ,
            duration_ms         INTEGER,
            output              TEXT,
            error_message       TEXT,
            structured_output   TEXT,
            assertions_passed   INTEGER NOT NULL DEFAULT 0,
            assertions_failed   INTEGER NOT NULL DEFAULT 0,
            screenshots         TEXT NOT NULL DEFAULT '[]',
            visual_evidence     TEXT,
            ai_analysis         TEXT,
            created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_test_results_test_id ON test_results(test_id);
        CREATE INDEX IF NOT EXISTS idx_test_results_task_run_id ON test_results(task_run_id) WHERE task_run_id IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_test_results_status ON test_results(status);
        CREATE INDEX IF NOT EXISTS idx_test_results_created_at ON test_results(created_at);
        """
    )


def downgrade() -> None:
    op.execute("SET search_path TO project, public")
    op.execute("DROP TABLE IF EXISTS test_results CASCADE")
    op.execute("DROP TABLE IF EXISTS verification_tests CASCADE")
