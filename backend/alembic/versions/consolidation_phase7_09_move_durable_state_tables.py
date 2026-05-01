"""consolidation phase 7: move project-bound durable state tables to project schema

Revision ID: consolidation_phase7_09_move_durable_state_tables
Revises: consolidation_phase7_08_move_per_user_runtime_tables
Create Date: 2026-05-01

Phase 7 of the migration consolidation
(``D:/qontinui-root/tmp_consolidation_phase7_public_drift.md``).

Cluster 7b (Other durable, project-bound durable subsection), 13 tables
→ ``project``. Per the user-direction 3-way split of the original
30-table monolith.

Tables in this batch (13):

* Execution surface: ``action_executions``, ``action_frames``,
  ``input_events``.
* Issue / monitoring: ``error_monitor_entries``, ``detected_issues``.
* Async jobs: ``embedding_generation_jobs``.
* Logs: ``processing_logs``, ``conflict_logs``, ``render_logs``.
* Render artifacts: ``render_images``.
* Project config: ``custom_functions``, ``domain_knowledge``,
  ``application_profiles``.
"""

from collections.abc import Sequence
from alembic import op

revision: str = "consolidation_phase7_09_move_durable_state_tables"
down_revision: str = "consolidation_phase7_08_move_per_user_runtime_tables"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


_TARGET = """ARRAY[
    'action_executions','action_frames','input_events',
    'error_monitor_entries','detected_issues','embedding_generation_jobs',
    'processing_logs','conflict_logs','render_logs','render_images',
    'custom_functions','domain_knowledge','application_profiles'
]"""

_UPGRADE_SQL = f"""
DO $$
DECLARE
    tbl TEXT; in_public BOOLEAN; in_project BOOLEAN;
    moved INT := 0; skipped_already INT := 0; skipped_missing INT := 0;
    target_tables TEXT[] := {_TARGET};
BEGIN
    FOREACH tbl IN ARRAY target_tables LOOP
        SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=tbl AND table_type='BASE TABLE') INTO in_public;
        SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='project' AND table_name=tbl AND table_type='BASE TABLE') INTO in_project;
        IF in_project AND NOT in_public THEN skipped_already := skipped_already + 1; CONTINUE; END IF;
        IF NOT in_public THEN skipped_missing := skipped_missing + 1; RAISE WARNING 'phase7_09: % missing', tbl; CONTINUE; END IF;
        IF in_project AND in_public THEN RAISE EXCEPTION 'phase7_09: % in BOTH', tbl; END IF;
        EXECUTE format('ALTER TABLE public.%I SET SCHEMA project', tbl);
        moved := moved + 1;
        RAISE NOTICE 'phase7_09: moved %', tbl;
    END LOOP;
    RAISE NOTICE 'phase7_09 summary: moved=%, skipped_already=%, skipped_missing=%', moved, skipped_already, skipped_missing;
END $$;
"""

_DOWNGRADE_SQL = f"""
DO $$
DECLARE
    tbl TEXT; in_public BOOLEAN; in_project BOOLEAN;
    target_tables TEXT[] := {_TARGET};
BEGIN
    FOREACH tbl IN ARRAY target_tables LOOP
        SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='project' AND table_name=tbl AND table_type='BASE TABLE') INTO in_project;
        SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=tbl AND table_type='BASE TABLE') INTO in_public;
        IF in_project AND NOT in_public THEN
            EXECUTE format('ALTER TABLE project.%I SET SCHEMA public', tbl);
        END IF;
    END LOOP;
END $$;
"""


def upgrade() -> None:
    op.execute(_UPGRADE_SQL)


def downgrade() -> None:
    op.execute(_DOWNGRADE_SQL)
