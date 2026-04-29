"""consolidation phase2 v_14 fix v10 default-NOW regression

Revision ID: consolidation_phase2_v_14_drop_default_fixes
Revises: consolidation_phase2_v_13_ui_bridge_baselines
Create Date: 2026-04-29

Phase 2, v14: v10 set ``DEFAULT NOW()`` on all 72 columns; 13 of those
should NOT have a default (event-completion timestamps where NULL means
"not yet"). This migration drops those defaults. Also: makes
``scheduler_history.success`` NOT NULL DEFAULT FALSE.

Source: ``mod.rs:672-726``.

On fresh canonical DB: NO-OP. Phase 1 created these columns without
DEFAULT NOW(); the DROP DEFAULT is harmless. ``scheduler_history.success``
in Phase 1 batch 20 is already NOT NULL DEFAULT FALSE.

DRIFT NOTE: ``coord.process_sessions.stopped_at`` is in coord schema,
not project. The v14 ``WHERE table_schema = current_schema()`` (=
project) won't match it, so it's skipped. Phase 1 batch 14 created it
without DEFAULT NOW() correctly.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "consolidation_phase2_v_14_drop_default_fixes"
down_revision: str = "consolidation_phase2_v_13_ui_bridge_baselines"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


_V14_BODY = r"""
DO $$
DECLARE
    r record;
BEGIN
    FOR r IN SELECT * FROM (VALUES
        ('check_results','completed_at'),
        ('comparison_runs','completed_at'),
        ('executions','ended_at'),
        ('known_issues','last_checked_at'),
        ('known_issues','last_detected_at'),
        ('known_issues','resolved_at'),
        ('mcp_servers','tools_cached_at'),
        ('process_sessions','stopped_at'),
        ('scheduler_history','ended_at'),
        ('shell_command_results','completed_at'),
        ('task_run_automation','ended_at'),
        ('task_runs','summary_generated_at'),
        ('workflow_step_checkpoints','completed_at')
    ) AS t(tbl, col) LOOP
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = current_schema()
              AND table_name = r.tbl
              AND column_name = r.col
        ) THEN
            EXECUTE format('ALTER TABLE %I ALTER COLUMN %I DROP DEFAULT', r.tbl, r.col);
        END IF;
    END LOOP;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'scheduler_history'
          AND column_name = 'success'
          AND is_nullable = 'YES'
    ) THEN
        UPDATE scheduler_history SET success = FALSE WHERE success IS NULL;
        ALTER TABLE scheduler_history ALTER COLUMN success SET NOT NULL;
        ALTER TABLE scheduler_history ALTER COLUMN success SET DEFAULT FALSE;
    END IF;
END $$;
"""


def upgrade() -> None:
    op.execute("SET search_path TO project, public")
    op.execute(_V14_BODY)


def downgrade() -> None:
    pass
