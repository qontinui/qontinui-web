"""consolidation phase 7: move per-user runtime tables to project schema

Revision ID: consolidation_phase7_08_move_per_user_runtime_tables
Revises: consolidation_phase7_07_move_discovery_uibridge_tables
Create Date: 2026-05-01

Phase 7 of the migration consolidation
(``D:/qontinui-root/tmp_consolidation_phase7_public_drift.md``).

Cluster 7a (Other durable, per-user runtime subsection), 9 tables → ``project``.
Per the user-direction "split rev 07's 30-table monolith three ways."
Per-user runtime state lives in ``project`` (despite the per-user shape)
because the row outlives the agent session that created it — durable, not
ephemeral. ``auth.users`` ownership is via FK, not schema.

Tables in this batch (9):

* User notifications: ``notifications``, ``notification_preferences``,
  ``test_notification_preferences``.
* Activity surface: ``activity_logs``, ``session_activities``.
* Coordination locks (per-user): ``sync_locks``.
* User-driven editing: ``clipboard_entries``, ``edit_commands``.
* History: ``variable_history``.
"""

from collections.abc import Sequence
from alembic import op

revision: str = "consolidation_phase7_08_move_per_user_runtime_tables"
down_revision: str = "consolidation_phase7_07_move_discovery_uibridge_tables"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


_TARGET = """ARRAY[
    'notifications','notification_preferences','test_notification_preferences',
    'activity_logs','session_activities','sync_locks',
    'clipboard_entries','edit_commands','variable_history'
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
        IF NOT in_public THEN skipped_missing := skipped_missing + 1; RAISE WARNING 'phase7_08: % missing', tbl; CONTINUE; END IF;
        IF in_project AND in_public THEN RAISE EXCEPTION 'phase7_08: % in BOTH', tbl; END IF;
        EXECUTE format('ALTER TABLE public.%I SET SCHEMA project', tbl);
        moved := moved + 1;
        RAISE NOTICE 'phase7_08: moved %', tbl;
    END LOOP;
    RAISE NOTICE 'phase7_08 summary: moved=%, skipped_already=%, skipped_missing=%', moved, skipped_already, skipped_missing;
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
