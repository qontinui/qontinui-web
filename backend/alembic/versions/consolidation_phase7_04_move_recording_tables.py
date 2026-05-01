"""consolidation phase 7: move recording / capture tables to project schema

Revision ID: consolidation_phase7_04_move_recording_tables
Revises: consolidation_phase7_03_move_workflow_tables
Create Date: 2026-05-01

Phase 7 of the migration consolidation
(``D:/qontinui-root/tmp_consolidation_phase7_public_drift.md``).

Cluster 2 of 7 (Recordings / capture, 20 tables) → ``project``.
Semantically adjacent to rev 03's workflow cluster — workflow execution
generates these recordings, captures, and screenshots. Reviewer can see
the natural progression.

Tables in this batch (20):

* Recording session core: ``recording_sessions``, ``recording_frames``,
  ``recording_interactions``, ``recording_contexts``.
* Screenshot indexing: ``screenshots``, ``screenshot_input_associations``,
  ``screenshot_state_matches``.
* Capture session: ``capture_sessions``, ``capture_actions``,
  ``capture_screenshots``, ``capture_detected_elements``.
* Extraction: ``extraction_sessions``, ``extraction_annotations``.
* Video / frame: ``video_capture_sessions``, ``frame_index``,
  ``automation_videos``, ``automation_screenshots``.
* Automation runtime: ``automation_input_events``, ``automation_logs``,
  ``automation_sessions``.

All 20 confirmed in ``public.*`` and absent from ``project.*`` at apply
time.

Defensive shape and downgrade match rev 02 / rev 03. Uses ``op.execute()``
only.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "consolidation_phase7_04_move_recording_tables"
down_revision: str = "consolidation_phase7_03_move_workflow_tables"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


_TARGET = """ARRAY[
    'recording_sessions','recording_frames','recording_interactions','recording_contexts',
    'screenshot_input_associations','screenshot_state_matches','screenshots',
    'capture_sessions','capture_actions','capture_screenshots','capture_detected_elements',
    'extraction_sessions','extraction_annotations',
    'video_capture_sessions','frame_index','automation_videos','automation_screenshots',
    'automation_input_events','automation_logs','automation_sessions'
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
        IF in_project AND NOT in_public THEN
            skipped_already := skipped_already + 1;
            RAISE NOTICE 'phase7_04: % already in project — skipping', tbl;
            CONTINUE;
        END IF;
        IF NOT in_public THEN
            skipped_missing := skipped_missing + 1;
            RAISE WARNING 'phase7_04: % not in public or project — skipping', tbl;
            CONTINUE;
        END IF;
        IF in_project AND in_public THEN
            RAISE EXCEPTION 'phase7_04: % exists in BOTH — manual reconciliation required', tbl;
        END IF;
        EXECUTE format('ALTER TABLE public.%I SET SCHEMA project', tbl);
        moved := moved + 1;
        RAISE NOTICE 'phase7_04: moved %', tbl;
    END LOOP;
    RAISE NOTICE 'phase7_04 summary: moved=%, skipped_already=%, skipped_missing=%', moved, skipped_already, skipped_missing;
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
            RAISE NOTICE 'phase7_04 downgrade: moved % back to public', tbl;
        END IF;
    END LOOP;
END $$;
"""


def upgrade() -> None:
    op.execute(_UPGRADE_SQL)


def downgrade() -> None:
    op.execute(_DOWNGRADE_SQL)
