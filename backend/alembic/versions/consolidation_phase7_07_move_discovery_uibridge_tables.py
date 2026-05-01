"""consolidation phase 7: move discovery + UI-bridge tables to project schema

Revision ID: consolidation_phase7_07_move_discovery_uibridge_tables
Revises: consolidation_phase7_06_move_project_library_tables
Create Date: 2026-05-01

Phase 7 of the migration consolidation
(``D:/qontinui-root/tmp_consolidation_phase7_public_drift.md``).

Combined cluster (5 + 6 of 7), 16 tables total → ``project``.
Discoveries/patterns (13) and UI-bridge (3) folded into one rev because
both are state-machine inference internals and UI-bridge alone (3
tables) is too small to justify its own rev.

Tables in this batch (16):

* Discoveries: ``discovered_states``, ``discovered_transitions``,
  ``discoveries``, ``path_discoveries``, ``state_discovery_results``.
* Patterns / snapshots: ``patterns``, ``snapshot_actions``,
  ``snapshot_matches``, ``snapshot_patterns``, ``snapshot_runs``.
* Inference state: ``template_candidates``, ``learned_workflows``,
  ``transition_reliability``.
* UI bridge: ``ui_bridge_state_configs``, ``ui_bridge_state_domain_knowledge``,
  ``ui_bridge_exploration_sessions``.
"""

from collections.abc import Sequence
from alembic import op

revision: str = "consolidation_phase7_07_move_discovery_uibridge_tables"
down_revision: str = "consolidation_phase7_06_move_project_library_tables"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


_TARGET = """ARRAY[
    'discovered_states','discovered_transitions','discoveries','path_discoveries',
    'state_discovery_results',
    'patterns','snapshot_actions','snapshot_matches','snapshot_patterns','snapshot_runs',
    'template_candidates','learned_workflows','transition_reliability',
    'ui_bridge_state_configs','ui_bridge_state_domain_knowledge','ui_bridge_exploration_sessions'
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
        IF NOT in_public THEN skipped_missing := skipped_missing + 1; RAISE WARNING 'phase7_07: % missing', tbl; CONTINUE; END IF;
        IF in_project AND in_public THEN RAISE EXCEPTION 'phase7_07: % in BOTH', tbl; END IF;
        EXECUTE format('ALTER TABLE public.%I SET SCHEMA project', tbl);
        moved := moved + 1;
        RAISE NOTICE 'phase7_07: moved %', tbl;
    END LOOP;
    RAISE NOTICE 'phase7_07 summary: moved=%, skipped_already=%, skipped_missing=%', moved, skipped_already, skipped_missing;
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
