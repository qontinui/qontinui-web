"""consolidation phase2 v_32 drift fix: ENUM columns on runner.* tables

Revision ID: consolidation_phase2_v_32_drift_enum_columns
Revises: consolidation_phase2_v_31_reviews
Create Date: 2026-04-29

Phase 2, v32: drift-fix migration that added ENUM columns to runner.*
tables matching qontinui-web SQLAlchemy model expectations.

Source: ``mod.rs:1222-1316``.

On fresh canonical DB: TRUE NO-OP.

Source body uses ``WHERE table_schema = 'runner'`` in every existence
check. Canonical DB has no ``runner`` schema (Phase 1 created
project/coord/agent/auth only), so:

- The outer FOR loop iterates 17 spec rows.
- Every ``runner.<tbl>`` existence check returns false.
- Every iteration takes the skip-with-NOTICE branch.
- Net effect: 17 NOTICEs logged, zero ALTER TABLE statements executed.

Ported verbatim with the original NOTICE/RAISE machinery preserved
for diagnostic transparency. The existing software_test_runs etc.
tables that this migration originally targeted live in the alembic-
owned ``project`` schema in canonical DB with the correct ENUM types
(populated by qontinui-web's pre-existing alembic migrations, e.g.
``05a366f58455_initial_schema_squashed`` predecessors).
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "consolidation_phase2_v_32_drift_enum_columns"
down_revision: str = "consolidation_phase2_v_31_reviews"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


_V32_BODY = r"""
DO $$
DECLARE
    spec RECORD;
    added INT := 0;
    skipped_table INT := 0;
    skipped_enum INT := 0;
BEGIN
    FOR spec IN
        SELECT * FROM (VALUES
            ('software_test_runs',           'status',          'testrunstatus'),
            ('execution_runs',               'run_type',        'execution_run_type'),
            ('execution_runs',               'status',          'execution_run_status'),
            ('transition_executions',        'status',          'transitionexecutionstatus'),
            ('test_deficiencies',            'deficiency_type', 'deficiencytype'),
            ('test_deficiencies',            'severity',        'deficiencyseverity'),
            ('test_deficiencies',            'status',          'deficiencystatus'),
            ('training_dataset_export_jobs', 'format',          'export_format_enum'),
            ('training_dataset_export_jobs', 'status',          'export_job_status_enum'),
            ('visual_comparison_results',    'review_decision', 'reviewdecision'),
            ('visual_comparison_results',    'status',          'visualcomparisonstatus'),
            ('action_executions',            'action_type',     'action_execution_type'),
            ('action_executions',            'status',          'action_execution_status'),
            ('activity_logs',                'action_type',     'actiontype'),
            ('activity_logs',                'resource_type',   'resourcetype'),
            ('execution_screenshots',        'screenshot_type', 'execution_screenshot_type'),
            ('test_screenshots',             'screenshot_type', 'testscreenshottype')
        ) AS s(tbl, col, enum_name)
    LOOP
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'runner' AND table_name = spec.tbl
        ) THEN
            skipped_table := skipped_table + 1;
            RAISE NOTICE 'v32 skip: runner.% does not exist', spec.tbl;
            CONTINUE;
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM pg_type t
            JOIN pg_namespace n ON n.oid = t.typnamespace
            WHERE t.typname = spec.enum_name AND n.nspname = 'public'
        ) THEN
            skipped_enum := skipped_enum + 1;
            RAISE NOTICE 'v32 skip: enum public.% (for runner.%.%) does not exist',
                spec.enum_name, spec.tbl, spec.col;
            CONTINUE;
        END IF;

        EXECUTE format(
            'ALTER TABLE runner.%I ADD COLUMN IF NOT EXISTS %I public.%I',
            spec.tbl, spec.col, spec.enum_name
        );
        added := added + 1;
        RAISE NOTICE 'v32 add: runner.%.% (public.%)',
            spec.tbl, spec.col, spec.enum_name;
    END LOOP;

    RAISE NOTICE 'v32 summary: added=%, skipped_table=%, skipped_enum=%',
        added, skipped_table, skipped_enum;
END $$;
"""


def upgrade() -> None:
    op.execute(_V32_BODY)


def downgrade() -> None:
    pass
