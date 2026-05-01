"""consolidation phase 7: move workflow / execution tables to project schema

Revision ID: consolidation_phase7_03_move_workflow_tables
Revises: consolidation_phase7_02_move_auth_tables
Create Date: 2026-05-01

Phase 7 of the migration consolidation
(``D:/qontinui-root/tmp_consolidation_phase7_public_drift.md``).

Moves 16 workflow- and execution-related tables from ``public.*`` into
``project.*``. This is the first project-bound batch (Bucket C, cluster
1 of 7 in the by-cluster split agreed during the rev 03 session). Per
plan §2 Bucket C heuristic: row outlives the agent session that created
it → ``project``.

Tables in this batch (16):

* Workflow-config + history: ``workflow_events``,
  ``workflow_execution_history``, ``workflow_phase_configs``,
  ``workflow_test_associations``.
* Task-run satellites: ``task_run_automations``, ``task_run_sessions``,
  ``task_run_verification_results`` (the parent ``task_runs`` already
  moved to ``project`` via the consolidation transplant; these chain
  to it).
* Software-test runs + execution graph: ``software_test_runs``,
  ``transition_executions``, ``execution_runs``,
  ``execution_screenshots``, ``execution_tree_events``,
  ``execution_issues``.
* Schedule + transitions: ``scheduled_workflow_runs``,
  ``state_transitions``.
* Historical record: ``historical_results``.

Internal FK structure (verified pre-move): ``execution_runs`` is the
hub of the cluster — ``execution_screenshots`` /
``execution_tree_events`` / ``execution_issues`` /
``feedback_scores`` (cluster 3) reference it; ``transition_executions``
chains off ``software_test_runs``. After move, those edges become
``project → project`` (same-schema, fine). Edges from this cluster to
``auth`` (5 user_id refs + ``software_test_runs.runner_connection_id``)
and to ``public.projects`` / ``public.automation_sessions`` (will move
in later batches) are preserved natively as cross-schema FKs during
the transition.

Defensive shape: each move is guarded by an "exists in public AND not
in project" idempotency check, mirroring rev 02's auth-move pattern.
If a table was already moved (partial run, parallel agent), the move
is skipped silently. If neither location has it, a warning fires and
execution continues. If both have it, we abort — that means manual
reconciliation is required.

Companion SQLAlchemy ``__table_args__`` updates land in the
``consolidation_phase7_NN_repoint_sqlalchemy_models`` final companion PR
(per plan §5.2 / backlog item #4 bundle). Until that ships, the ORM
points the moved tables at the wrong schema; runtime queries through
these models fail. Per the rev 02 docstring: do not deploy without the
companion model PR landing in lockstep.

Uses ``op.execute()`` only; not subject to the schema-arg gate.

Downgrade: reverses each ``SET SCHEMA`` move. Reversible because no
data is lost.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "consolidation_phase7_03_move_workflow_tables"
down_revision: str = "consolidation_phase7_02_move_auth_tables"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


_UPGRADE_SQL = """
DO $$
DECLARE
    tbl TEXT;
    in_public BOOLEAN;
    in_project BOOLEAN;
    moved INT := 0;
    skipped_already_moved INT := 0;
    skipped_missing INT := 0;
    target_tables TEXT[] := ARRAY[
        'workflow_events','workflow_execution_history','workflow_phase_configs',
        'workflow_test_associations','task_run_automations','task_run_sessions',
        'task_run_verification_results','software_test_runs','transition_executions',
        'execution_runs','execution_screenshots','execution_tree_events',
        'execution_issues','scheduled_workflow_runs','state_transitions',
        'historical_results'
    ];
BEGIN
    FOREACH tbl IN ARRAY target_tables LOOP
        SELECT EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = tbl AND table_type = 'BASE TABLE'
        ) INTO in_public;

        SELECT EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'project' AND table_name = tbl AND table_type = 'BASE TABLE'
        ) INTO in_project;

        IF in_project AND NOT in_public THEN
            skipped_already_moved := skipped_already_moved + 1;
            RAISE NOTICE 'phase7_03: % already in project — skipping', tbl;
            CONTINUE;
        END IF;

        IF NOT in_public THEN
            skipped_missing := skipped_missing + 1;
            RAISE WARNING 'phase7_03: % not in public or project — skipping', tbl;
            CONTINUE;
        END IF;

        IF in_project AND in_public THEN
            RAISE EXCEPTION 'phase7_03: % exists in BOTH public and project — manual reconciliation required before moving', tbl;
        END IF;

        EXECUTE format('ALTER TABLE public.%I SET SCHEMA project', tbl);
        moved := moved + 1;
        RAISE NOTICE 'phase7_03: moved % from public to project', tbl;
    END LOOP;

    RAISE NOTICE 'phase7_03 summary: moved=%, skipped_already_moved=%, skipped_missing=%',
        moved, skipped_already_moved, skipped_missing;
END $$;
"""


_DOWNGRADE_SQL = """
DO $$
DECLARE
    tbl TEXT;
    in_public BOOLEAN;
    in_project BOOLEAN;
    target_tables TEXT[] := ARRAY[
        'workflow_events','workflow_execution_history','workflow_phase_configs',
        'workflow_test_associations','task_run_automations','task_run_sessions',
        'task_run_verification_results','software_test_runs','transition_executions',
        'execution_runs','execution_screenshots','execution_tree_events',
        'execution_issues','scheduled_workflow_runs','state_transitions',
        'historical_results'
    ];
BEGIN
    FOREACH tbl IN ARRAY target_tables LOOP
        SELECT EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'project' AND table_name = tbl AND table_type = 'BASE TABLE'
        ) INTO in_project;

        SELECT EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = tbl AND table_type = 'BASE TABLE'
        ) INTO in_public;

        IF in_project AND NOT in_public THEN
            EXECUTE format('ALTER TABLE project.%I SET SCHEMA public', tbl);
            RAISE NOTICE 'phase7_03 downgrade: moved % back to public', tbl;
        ELSIF in_public AND NOT in_project THEN
            RAISE NOTICE 'phase7_03 downgrade: % already in public — skipping', tbl;
        END IF;
    END LOOP;
END $$;
"""


def upgrade() -> None:
    op.execute(_UPGRADE_SQL)


def downgrade() -> None:
    op.execute(_DOWNGRADE_SQL)
