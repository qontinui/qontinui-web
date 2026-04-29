"""consolidation phase2 v_27 12 INT4->BIGINT drift fixes

Revision ID: consolidation_phase2_v_27_int4_to_bigint_drift
Revises: consolidation_phase2_v_26_runs_included_bigint
Create Date: 2026-04-29

Phase 2, v27: 12 INT4->BIGINT drift fixes across 7 tables (sister bugs
of v26).

Source: ``mod.rs:981-1029``.

On fresh canonical DB: NO-OP. Phase 1 already created all these
columns as BIGINT. Each ALTER is wrapped in a per-column idempotency
guard so it's a clean no-op when the column type is already INT8.

Tables touched:
- step_progress_markers (current_value, total_value)
- task_run_automation (iteration_number)
- pipeline_agent_traces (duration_ms, tokens_in, tokens_out)
- generation_pipeline_artifacts (total_duration_ms)
- check_results (issues_found, issues_fixed, files_checked)
- orchestrator_checkpoints (iteration)
- exploration_stats (search_duration_ms)
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "consolidation_phase2_v_27_int4_to_bigint_drift"
down_revision: str = "consolidation_phase2_v_26_runs_included_bigint"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("SET search_path TO project, public")
    op.execute(
        """
        DO $$
        DECLARE
            r record;
        BEGIN
            FOR r IN SELECT * FROM (VALUES
                ('step_progress_markers', 'current_value'),
                ('step_progress_markers', 'total_value'),
                ('task_run_automation', 'iteration_number'),
                ('pipeline_agent_traces', 'duration_ms'),
                ('pipeline_agent_traces', 'tokens_in'),
                ('pipeline_agent_traces', 'tokens_out'),
                ('generation_pipeline_artifacts', 'total_duration_ms'),
                ('check_results', 'issues_found'),
                ('check_results', 'issues_fixed'),
                ('check_results', 'files_checked'),
                ('orchestrator_checkpoints', 'iteration'),
                ('exploration_stats', 'search_duration_ms')
            ) AS t(tbl, col)
            LOOP
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_schema = current_schema()
                      AND table_name = r.tbl
                      AND column_name = r.col
                      AND data_type = 'integer'
                ) THEN
                    EXECUTE format(
                        'ALTER TABLE %I ALTER COLUMN %I TYPE BIGINT USING %I::bigint',
                        r.tbl, r.col, r.col
                    );
                END IF;
            END LOOP;
        END $$;
        """
    )


def downgrade() -> None:
    pass
