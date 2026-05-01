"""consolidation phase 7: final cleanup — move remaining 8 + drop cloud orphans

Revision ID: consolidation_phase7_10_final_cleanup
Revises: consolidation_phase7_09_move_durable_state_tables
Create Date: 2026-05-01

Phase 7 of the migration consolidation
(``D:/qontinui-root/tmp_consolidation_phase7_public_drift.md``).

Final ``public.*`` cleanup, two parts:

**Part 1 — Cluster 7c (Other durable, visual+test+config), 8 tables → project:**

* Visual: ``visual_baselines``, ``visual_comparison_results``,
  ``coverage_snapshots``.
* Test artifacts: ``test_deficiencies``, ``test_screenshots``.
* Type/category configs: ``finding_category_configs``,
  ``gui_action_type_configs``, ``step_type_configs``.

**Part 2 — Drop pre-3b-M3 cloud-table fossils:**

``public.subscriptions`` and ``public.admin_notification_settings`` are
fossils that ``cloud_schema_initial_tables`` (3b M3) created ``cloud.*``
versions of without dropping the public-side originals. Phase 7's
"post-Phase-7 public has only alembic_version" goal absorbs the
public-side drop. Both confirmed empty pre-drop. The cloud.* versions
remain as the canonical home (created by 3b M3).

After this revision applies, ``public`` contains only ``alembic_version``,
the alembic-bookkeeping survivor per plan §6.F.
"""

from collections.abc import Sequence
from alembic import op

revision: str = "consolidation_phase7_10_final_cleanup"
down_revision: str = "consolidation_phase7_09_move_durable_state_tables"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


_MOVE_TARGET = """ARRAY[
    'visual_baselines','visual_comparison_results','coverage_snapshots',
    'test_deficiencies','test_screenshots',
    'finding_category_configs','gui_action_type_configs','step_type_configs'
]"""

_DROP_TARGET = """ARRAY[
    'subscriptions','admin_notification_settings'
]"""

_UPGRADE_SQL = f"""
-- Part 1: move 8 tables public → project
DO $$
DECLARE
    tbl TEXT; in_public BOOLEAN; in_project BOOLEAN;
    moved INT := 0; skipped_already INT := 0; skipped_missing INT := 0;
    target_tables TEXT[] := {_MOVE_TARGET};
BEGIN
    FOREACH tbl IN ARRAY target_tables LOOP
        SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=tbl AND table_type='BASE TABLE') INTO in_public;
        SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='project' AND table_name=tbl AND table_type='BASE TABLE') INTO in_project;
        IF in_project AND NOT in_public THEN skipped_already := skipped_already + 1; CONTINUE; END IF;
        IF NOT in_public THEN skipped_missing := skipped_missing + 1; RAISE WARNING 'phase7_10 part1: % missing', tbl; CONTINUE; END IF;
        IF in_project AND in_public THEN RAISE EXCEPTION 'phase7_10 part1: % in BOTH', tbl; END IF;
        EXECUTE format('ALTER TABLE public.%I SET SCHEMA project', tbl);
        moved := moved + 1;
        RAISE NOTICE 'phase7_10 part1: moved %', tbl;
    END LOOP;
    RAISE NOTICE 'phase7_10 part1 summary: moved=%, skipped_already=%, skipped_missing=%', moved, skipped_already, skipped_missing;
END $$;

-- Part 2: drop public.* cloud-orphan fossils after empty-precondition check
DO $$
DECLARE
    tbl TEXT; pub_exists BOOLEAN; row_count BIGINT;
    dropped INT := 0; skipped_missing INT := 0;
    target_tables TEXT[] := {_DROP_TARGET};
BEGIN
    FOREACH tbl IN ARRAY target_tables LOOP
        SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=tbl AND table_type='BASE TABLE') INTO pub_exists;
        IF NOT pub_exists THEN
            skipped_missing := skipped_missing + 1;
            RAISE NOTICE 'phase7_10 part2: public.% already absent — skipping (idempotent)', tbl;
            CONTINUE;
        END IF;
        EXECUTE format('SELECT count(*) FROM public.%I', tbl) INTO row_count;
        IF row_count > 0 THEN
            RAISE EXCEPTION 'phase7_10 part2: public.% has % rows; refusing to drop. Manual data review required.', tbl, row_count;
        END IF;
        EXECUTE format('DROP TABLE public.%I CASCADE', tbl);
        dropped := dropped + 1;
        RAISE NOTICE 'phase7_10 part2: dropped public.%', tbl;
    END LOOP;
    RAISE NOTICE 'phase7_10 part2 summary: dropped=%, skipped_missing=%', dropped, skipped_missing;
END $$;
"""


_DOWNGRADE_SQL = f"""
-- Part 1 (reverse): move 8 tables back project → public
DO $$
DECLARE
    tbl TEXT; in_public BOOLEAN; in_project BOOLEAN;
    target_tables TEXT[] := {_MOVE_TARGET};
BEGIN
    FOREACH tbl IN ARRAY target_tables LOOP
        SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='project' AND table_name=tbl AND table_type='BASE TABLE') INTO in_project;
        SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=tbl AND table_type='BASE TABLE') INTO in_public;
        IF in_project AND NOT in_public THEN
            EXECUTE format('ALTER TABLE project.%I SET SCHEMA public', tbl);
        END IF;
    END LOOP;
END $$;
-- Part 2 (drops) is intentionally not reversible: the cloud.* tables
-- created by 3b M3 are the canonical home; restoring empty public.*
-- duplicates would re-introduce the fossil state. Restore from backup
-- if the prior state must be reproduced.
"""


def upgrade() -> None:
    op.execute(_UPGRADE_SQL)


def downgrade() -> None:
    op.execute(_DOWNGRADE_SQL)
