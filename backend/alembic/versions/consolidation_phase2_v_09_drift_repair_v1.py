"""consolidation phase2 v_09 drift repair v1 (TEXT->TIMESTAMPTZ, INT->BIGINT)

Revision ID: consolidation_phase2_v_09_drift_repair_v1
Revises: consolidation_phase2_v_08_recordings
Create Date: 2026-04-29

Phase 2, v9: SQLite-era schema drift repair. Casts TEXT timestamp
columns to TIMESTAMPTZ and INTEGER columns to BIGINT for tables
declared in ``ensure_tables()``.

Source: ``mod.rs:345-461``.

On fresh canonical DB: NO-OP. The source explicitly hardcodes
``table_schema = 'runner'`` in its existence checks, and the canonical
DB has no ``runner`` schema (Phase 1 created project/coord/agent/auth
only). The DO block iterates over zero candidate rows. Ported verbatim
for fidelity to the historical migration.

Even if the schema check matched, columns in canonical project schema
have correct TIMESTAMPTZ / BIGINT types from Phase 1, so the
``data_type = 'text'`` / ``data_type = 'integer'`` guards would also
return false.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "consolidation_phase2_v_09_drift_repair_v1"
down_revision: str = "consolidation_phase2_v_08_recordings"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


_V9_BODY = r"""
DO $$
DECLARE
    r record;
BEGIN
    FOR r IN SELECT * FROM (VALUES
        ('active_workflows',              'created_at',        true),
        ('active_workflows',              'updated_at',        true),
        ('exploration_stats',             'created_at',        true),
        ('fix_applications',              'applied_at',        true),
        ('fix_applications',              'evaluated_at',      false),
        ('flow_executions',               'started_at',        true),
        ('flow_executions',               'completed_at',      false),
        ('flow_versions',                 'created_at',        true),
        ('generation_pipeline_artifacts', 'created_at',        true),
        ('generation_rules',              'created_at',        true),
        ('generation_rules',              'updated_at',        true),
        ('generation_rules',              'auto_generated_at', false),
        ('iteration_logs',                'created_at',        true),
        ('meta_optimizer_runs',           'created_at',        true),
        ('meta_optimizer_runs',           'completed_at',      false),
        ('meta_optimizer_snapshots',      'created_at',        true),
        ('orchestrator_checkpoints',      'created_at',        true),
        ('orchestrator_flows',            'created_at',        true),
        ('orchestrator_flows',            'updated_at',        true),
        ('pipeline_agent_traces',         'created_at',        true),
        ('recordings',                    'started_at',        true),
        ('recordings',                    'completed_at',      false),
        ('reflection_fixes',              'created_at',        true),
        ('reflection_fixes',              'applied_at',        true),
        ('reflection_fixes',              'evaluated_at',      false),
        ('sm_capture_screenshots',        'captured_at',       true),
        ('step_templates',                'created_at',        true),
        ('step_templates',                'updated_at',        true),
        ('template_performance',          'last_used_at',      false),
        ('test_results',                  'created_at',        true),
        ('test_results',                  'started_at',        false),
        ('test_results',                  'completed_at',      false),
        ('trigger_history',               'triggered_at',      true),
        ('workflow_triggers',             'created_at',        true),
        ('workflow_triggers',             'updated_at',        true),
        ('workflow_triggers',             'last_triggered_at', false)
    ) AS t(table_name, column_name, set_now_default)
    LOOP
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'runner'
              AND table_name   = r.table_name
              AND column_name  = r.column_name
              AND data_type    = 'text'
        ) THEN
            EXECUTE format(
                'ALTER TABLE %I ALTER COLUMN %I DROP DEFAULT',
                r.table_name, r.column_name
            );
            EXECUTE format(
                'ALTER TABLE %I ALTER COLUMN %I TYPE TIMESTAMPTZ USING NULLIF(%I, '''')::timestamptz',
                r.table_name, r.column_name, r.column_name
            );
            IF r.set_now_default THEN
                EXECUTE format(
                    'ALTER TABLE %I ALTER COLUMN %I SET DEFAULT NOW()',
                    r.table_name, r.column_name
                );
            END IF;
        END IF;
    END LOOP;

    FOR r IN SELECT * FROM (VALUES
        ('canary_rollouts',   'percentage'),
        ('canary_rollouts',   'baseline_run_count'),
        ('canary_rollouts',   'canary_run_count'),
        ('workflow_triggers', 'debounce_ms'),
        ('workflow_triggers', 'cooldown_seconds'),
        ('workflow_triggers', 'retry_delay_seconds'),
        ('workflow_triggers', 'trigger_count')
    ) AS t(table_name, column_name)
    LOOP
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'runner'
              AND table_name   = r.table_name
              AND column_name  = r.column_name
              AND data_type    = 'integer'
        ) THEN
            EXECUTE format(
                'ALTER TABLE %I ALTER COLUMN %I TYPE BIGINT USING %I::bigint',
                r.table_name, r.column_name, r.column_name
            );
        END IF;
    END LOOP;
END $$;
"""


def upgrade() -> None:
    op.execute("SET search_path TO project, public")
    op.execute(_V9_BODY)


def downgrade() -> None:
    pass
