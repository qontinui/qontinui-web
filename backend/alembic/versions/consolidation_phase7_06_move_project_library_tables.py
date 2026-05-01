"""consolidation phase 7: move project / library / packages tables to project schema

Revision ID: consolidation_phase7_06_move_project_library_tables
Revises: consolidation_phase7_05_move_annotation_tables
Create Date: 2026-05-01

Phase 7 of the migration consolidation
(``D:/qontinui-root/tmp_consolidation_phase7_public_drift.md``).

Cluster 4 of 7 (Project / library / packages, 25 tables) + ``skills`` (1)
= 26 tables → ``project``. Largest cluster; the ``projects`` table itself
moves here, which resolves several transitional cross-schema FKs from
prior revs (e.g. ``project.execution_runs.project_id → public.projects``
becomes ``project.execution_runs.project_id → project.projects``).

Tables in this batch (26):

* Projects: ``projects``, ``project_access_control``, ``project_comments``,
  ``project_embeddings``, ``project_images``, ``project_screenshots``,
  ``project_versions``, ``project_locks``.
* Libraries: ``library_check_groups``, ``library_checks``,
  ``library_contexts``, ``library_macros``, ``library_prompt_snippets``,
  ``library_saved_api_requests``, ``library_shell_commands``.
* Packages: ``code_packages``, ``package_categories``, ``package_installations``,
  ``package_ratings``, ``package_versions``.
* Wrappers: ``wrapper_comments``, ``wrapper_entries``,
  ``wrapper_install_events``, ``wrapper_ratings``.
* Misc shared: ``shared_files``.
* Orphan placement: ``skills``.

``skills`` placement decision (rev 03 inspection): table has both
``created_by_user_id`` and ``organization_id`` as nullable FKs (not part
of PK), columns shape table as durable shareable content (template, tags,
usage_count, forked_from). Library-style. Plan §2 "when in doubt, project."
"""

from collections.abc import Sequence
from alembic import op

revision: str = "consolidation_phase7_06_move_project_library_tables"
down_revision: str = "consolidation_phase7_05_move_annotation_tables"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


_TARGET = """ARRAY[
    'projects','project_access_control','project_comments','project_embeddings',
    'project_images','project_screenshots','project_versions','project_locks',
    'library_check_groups','library_checks','library_contexts','library_macros',
    'library_prompt_snippets','library_saved_api_requests','library_shell_commands',
    'code_packages','package_categories','package_installations','package_ratings',
    'package_versions',
    'wrapper_comments','wrapper_entries','wrapper_install_events','wrapper_ratings',
    'shared_files',
    'skills'
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
        IF NOT in_public THEN skipped_missing := skipped_missing + 1; RAISE WARNING 'phase7_06: % missing', tbl; CONTINUE; END IF;
        IF in_project AND in_public THEN RAISE EXCEPTION 'phase7_06: % in BOTH', tbl; END IF;
        EXECUTE format('ALTER TABLE public.%I SET SCHEMA project', tbl);
        moved := moved + 1;
        RAISE NOTICE 'phase7_06: moved %', tbl;
    END LOOP;
    RAISE NOTICE 'phase7_06 summary: moved=%, skipped_already=%, skipped_missing=%', moved, skipped_already, skipped_missing;
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
