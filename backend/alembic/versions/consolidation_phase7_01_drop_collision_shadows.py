"""consolidation phase 7: drop public.* collision shadows

Revision ID: consolidation_phase7_01_drop_collision_shadows
Revises: coordinator_phase_6_agent_coordination_hardening
Create Date: 2026-05-01

Phase 7 of the migration consolidation
(``D:/qontinui-root/tmp_consolidation_phase7_public_drift.md``).

Drops the 13 ``public.*`` shadow tables whose canonical counterpart
lives in ``project.*``. Per plan §3, every shadow is empty on the
canonical seed (verified again at execution time — see the
``skipped_nonempty`` defensive guard below).

The collision pairs:

    deferred_questions, known_issues, phase_results, recordings,
    state_machine_configs, task_run_findings, task_runs, test_results,
    ui_bridge_states, ui_bridge_transitions, unified_workflows,
    verification_tests, workflow_variables

For each: if the ``public.*`` table exists and is empty, drop with
CASCADE (clears any internal FKs). If it has rows, skip with a NOTICE
and let a follow-up revision handle data merge — Phase 7's empty-shadow
simplification (plan §1) doesn't apply there. If it's already gone
(idempotency), skip silently.

This revision uses raw SQL via ``op.execute()`` only, which the
schema-arg pre-commit gate intentionally does not gate
(``check_alembic_schema_args.py:27-29``). No ``schema=`` arguments
needed.

Downgrade is not implemented — the dropped tables are empty by precondition,
so the schema can be reconstructed from the SQLAlchemy models if ever
needed; restoring data requires an external backup.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "consolidation_phase7_01_drop_collision_shadows"
down_revision: str = "coordinator_phase_6_agent_coordination_hardening"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


_UPGRADE_SQL = """
DO $$
DECLARE
    tbl TEXT;
    public_exists BOOLEAN;
    project_exists BOOLEAN;
    p_count BIGINT;
    dropped INT := 0;
    skipped_missing INT := 0;
    skipped_nonempty INT := 0;
    skipped_no_canonical INT := 0;
    target_tables TEXT[] := ARRAY[
        'deferred_questions','known_issues','phase_results','recordings',
        'state_machine_configs','task_run_findings','task_runs','test_results',
        'ui_bridge_states','ui_bridge_transitions','unified_workflows',
        'verification_tests','workflow_variables'
    ];
BEGIN
    FOREACH tbl IN ARRAY target_tables LOOP
        SELECT EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = tbl AND table_type = 'BASE TABLE'
        ) INTO public_exists;

        IF NOT public_exists THEN
            skipped_missing := skipped_missing + 1;
            RAISE NOTICE 'phase7_01: public.% already absent — skipping (idempotent)', tbl;
            CONTINUE;
        END IF;

        SELECT EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'project' AND table_name = tbl AND table_type = 'BASE TABLE'
        ) INTO project_exists;

        IF NOT project_exists THEN
            skipped_no_canonical := skipped_no_canonical + 1;
            RAISE WARNING 'phase7_01: public.% has no project.% canonical counterpart — refusing to drop', tbl, tbl;
            CONTINUE;
        END IF;

        EXECUTE format('SELECT COUNT(*) FROM public.%I', tbl) INTO p_count;
        IF p_count > 0 THEN
            skipped_nonempty := skipped_nonempty + 1;
            RAISE WARNING 'phase7_01: public.% has % rows — refusing to drop, manual data review required', tbl, p_count;
            CONTINUE;
        END IF;

        EXECUTE format('DROP TABLE public.%I CASCADE', tbl);
        dropped := dropped + 1;
        RAISE NOTICE 'phase7_01: dropped public.%', tbl;
    END LOOP;

    RAISE NOTICE 'phase7_01 summary: dropped=%, skipped_missing=%, skipped_nonempty=%, skipped_no_canonical=%',
        dropped, skipped_missing, skipped_nonempty, skipped_no_canonical;

    IF skipped_nonempty > 0 OR skipped_no_canonical > 0 THEN
        RAISE EXCEPTION 'phase7_01: % shadow(s) had unexpected state (nonempty=%, no_canonical=%) — aborting before further phase 7 revisions',
            skipped_nonempty + skipped_no_canonical, skipped_nonempty, skipped_no_canonical;
    END IF;
END $$;
"""


def upgrade() -> None:
    op.execute(_UPGRADE_SQL)


def downgrade() -> None:
    raise NotImplementedError(
        "phase7_01: dropped public.* collision shadows are not reversible. "
        "By precondition the tables were empty (verified by the upgrade DO "
        "block before each drop), so the schema can be re-created from the "
        "SQLAlchemy models. Data recovery requires an external backup."
    )
