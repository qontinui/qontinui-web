"""phase 1 batch 1: drop now-matching public duplicates

Revision ID: f1a9c2e7b3d4
Revises: tighten_runner_schema
Create Date: 2026-04-29

Phase 1 batch 1, web-side companion. Re-runs the introspection-based
public-duplicate-drop logic from ``e8a3c5b9d142``. The 10 tables
fixed by the runner-side migration v32
(``qontinui-runner/src-tauri/src/database/pg/mod.rs``, version 32)
now have matching column sets between ``public.*`` and ``runner.*``,
so their empty ``public.*`` copies become safe to drop.

Tables expected to be dropped after this migration applies (assuming
the matching DB has had runner v32 applied):

* action_executions
* activity_logs
* execution_runs
* execution_screenshots
* software_test_runs
* test_deficiencies
* test_screenshots
* training_dataset_export_jobs
* transition_executions
* visual_comparison_results

Idempotent. The DO block iterates ``information_schema`` and acts
only on tables where:

* ``runner.X`` exists, AND
* the column sets match exactly (name + type), AND
* ``public.X`` is empty (0 rows).

If runner v32 hasn't applied yet on a given DB, the column-set
match fails for the 10 batch-1 tables and they are skipped — the
migration does not drop them prematurely. So this can ship in
either order relative to runner v32; it just becomes effective
once both have run.

Other drift cases (Categories B/C/D in
``tmp_schema_drift_followup_plan.md``) intentionally do not match
and stay untouched.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "f1a9c2e7b3d4"
down_revision: str = "tighten_runner_schema"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


_UPGRADE_SQL = """
DO $$
DECLARE
    tbl TEXT;
    p_count BIGINT;
    cols_match BOOLEAN;
    dropped INT := 0;
    skipped_drift INT := 0;
    skipped_nonempty INT := 0;
BEGIN
    FOR tbl IN
        SELECT p.table_name
        FROM information_schema.tables p
        JOIN information_schema.tables r USING (table_name)
        WHERE p.table_schema = 'public'
          AND r.table_schema = 'runner'
          AND p.table_type = 'BASE TABLE'
          AND r.table_type = 'BASE TABLE'
        ORDER BY p.table_name
    LOOP
        SELECT NOT EXISTS (
            SELECT column_name, data_type FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = tbl
            EXCEPT
            SELECT column_name, data_type FROM information_schema.columns
            WHERE table_schema = 'runner' AND table_name = tbl
        ) AND NOT EXISTS (
            SELECT column_name, data_type FROM information_schema.columns
            WHERE table_schema = 'runner' AND table_name = tbl
            EXCEPT
            SELECT column_name, data_type FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = tbl
        )
        INTO cols_match;

        IF NOT cols_match THEN
            skipped_drift := skipped_drift + 1;
            CONTINUE;
        END IF;

        EXECUTE format('SELECT COUNT(*) FROM public.%I', tbl) INTO p_count;
        IF p_count > 0 THEN
            skipped_nonempty := skipped_nonempty + 1;
            RAISE NOTICE 'Skipped public.% (% rows) - not empty', tbl, p_count;
            CONTINUE;
        END IF;

        EXECUTE format('DROP TABLE public.%I CASCADE', tbl);
        dropped := dropped + 1;
        RAISE NOTICE 'Dropped public.%', tbl;
    END LOOP;

    RAISE NOTICE 'f1a9c2e7b3d4 summary: dropped=%, skipped_drift=%, skipped_nonempty=%',
        dropped, skipped_drift, skipped_nonempty;
END $$;
"""


def upgrade() -> None:
    op.execute(_UPGRADE_SQL)


def downgrade() -> None:
    raise NotImplementedError(
        "Drop of public schema duplicates is not reversible without a "
        "pre-migration snapshot. Restore from backup if needed."
    )
