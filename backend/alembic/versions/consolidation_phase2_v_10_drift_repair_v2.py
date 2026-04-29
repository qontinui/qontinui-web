"""consolidation phase2 v_10 drift repair v2 (72 more TIMESTAMPTZ columns)

Revision ID: consolidation_phase2_v_10_drift_repair_v2
Revises: consolidation_phase2_v_09_drift_repair_v1
Create Date: 2026-04-29

Phase 2, v10: extends v9's drift repair to 72 columns across 46 tables
that v9 missed.

Source: ``mod.rs:462-578``.

On fresh canonical DB: NO-OP. The DO block uses ``current_schema()``
(= ``project`` under our search_path), so it iterates over project
tables. Phase 1 created all of them with correct TIMESTAMPTZ types,
so the ``data_type = 'text'`` guard is false everywhere → no-op.

DRIFT NOTE: a few of the listed tables now live in non-project schemas
(coord.gui_lock, coord.process_sessions, etc., per the schema mapping
in the plan). Those won't be matched by ``current_schema() = 'project'``
so they're skipped. Phase 1 already created them with correct types in
their target schemas, so the skip is correct.

Some tables (decomposition_plans, decomposition_subtasks,
generator_benchmark_results, generator_benchmarks, rule_applications,
schema_version, api_credentials, api_request_logs) are dropped by v12.
On canonical DB they don't exist; the IF EXISTS guard skips them.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "consolidation_phase2_v_10_drift_repair_v2"
down_revision: str = "consolidation_phase2_v_09_drift_repair_v1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


_V10_BODY = r"""
DO $$
DECLARE
    r record;
BEGIN
    FOR r IN SELECT * FROM (VALUES
        ('agentic_metric_baselines','updated_at'),
        ('ai_workflows','created_at'),
        ('ai_workflows','updated_at'),
        ('api_credentials','created_at'),
        ('api_credentials','expires_at'),
        ('api_credentials','updated_at'),
        ('api_request_logs','created_at'),
        ('architecture_components','last_activity_at'),
        ('artifacts','created_at'),
        ('cached_app_specs','discovered_at'),
        ('check_results','completed_at'),
        ('check_results','created_at'),
        ('check_results','started_at'),
        ('comparison_runs','completed_at'),
        ('comparison_runs','created_at'),
        ('component_relationships','last_seen_at'),
        ('config_statistics','first_run_at'),
        ('config_statistics','last_run_at'),
        ('config_statistics','last_updated_at'),
        ('convergence_snapshots','snapshot_at'),
        ('decomposition_plans','completed_at'),
        ('decomposition_subtasks','completed_at'),
        ('decomposition_subtasks','started_at'),
        ('eval_results','created_at'),
        ('eval_specs','created_at'),
        ('eval_specs','updated_at'),
        ('executions','ended_at'),
        ('executions','started_at'),
        ('generator_benchmark_results','run_at'),
        ('generator_benchmarks','created_at'),
        ('generator_benchmarks','updated_at'),
        ('golden_datasets','created_at'),
        ('golden_datasets','updated_at'),
        ('gui_lock','acquired_at'),
        ('known_issues','last_checked_at'),
        ('known_issues','last_detected_at'),
        ('known_issues','resolved_at'),
        ('mcp_servers','tools_cached_at'),
        ('orchestration_loop_configs','created_at'),
        ('orchestration_loop_configs','updated_at'),
        ('orchestrator_verification_results','created_at'),
        ('pending_discoveries','created_at'),
        ('process_sessions','started_at'),
        ('process_sessions','stopped_at'),
        ('robustness_reports','created_at'),
        ('rule_applications','applied_at'),
        ('scheduled_tasks','created_at'),
        ('scheduled_tasks','modified_at'),
        ('scheduled_tasks','next_run'),
        ('scheduler_history','ended_at'),
        ('scheduler_history','started_at'),
        ('schema_version','applied_at'),
        ('shell_command_results','completed_at'),
        ('shell_command_results','created_at'),
        ('shell_command_results','started_at'),
        ('spec_accuracy_results','created_at'),
        ('spec_compliance_results','created_at'),
        ('spec_versions','created_at'),
        ('step_type_knowledge','created_at'),
        ('step_type_knowledge','updated_at'),
        ('task_knowledge_summaries','created_at'),
        ('task_run_automation','ended_at'),
        ('task_run_automation','started_at'),
        ('task_run_mcp_calls','created_at'),
        ('task_run_output_chunks','created_at'),
        ('task_runs','summary_generated_at'),
        ('test_associations','created_at'),
        ('test_associations','updated_at'),
        ('verification_plans','created_at'),
        ('workflow_step_checkpoints','completed_at'),
        ('workflow_step_checkpoints','started_at'),
        ('workflow_variables','created_at')
    ) AS t(tbl, col) LOOP
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = current_schema()
              AND table_name = r.tbl
              AND column_name = r.col
              AND data_type = 'text'
        ) THEN
            EXECUTE format('ALTER TABLE %I ALTER COLUMN %I DROP DEFAULT', r.tbl, r.col);
            EXECUTE format(
                'ALTER TABLE %I ALTER COLUMN %I TYPE TIMESTAMPTZ USING NULLIF(%I, '''')::timestamptz',
                r.tbl, r.col, r.col
            );
            EXECUTE format('ALTER TABLE %I ALTER COLUMN %I SET DEFAULT NOW()', r.tbl, r.col);
        END IF;
    END LOOP;
END $$;
"""


def upgrade() -> None:
    op.execute("SET search_path TO project, public")
    op.execute(_V10_BODY)


def downgrade() -> None:
    pass
