"""consolidation phase 7: move annotation / training tables to project schema

Revision ID: consolidation_phase7_05_move_annotation_tables
Revises: consolidation_phase7_04_move_recording_tables
Create Date: 2026-05-01

Phase 7 of the migration consolidation
(``D:/qontinui-root/tmp_consolidation_phase7_public_drift.md``).

Cluster 3 of 7 (Annotations / training, 18 tables) → ``project``.
Annotations and training datasets are durable model-training artifacts —
clearly project-bound per §2 Bucket C.

Tables in this batch (18):

* Annotations: ``annotations``, ``annotation_sets``, ``element_annotations``,
  ``element_annotation_sets``, ``project_annotation_states``.
* Training datasets: ``training_datasets``, ``training_dataset_annotations``,
  ``training_dataset_export_jobs``, ``training_dataset_images``, ``training_jobs``.
* Evaluation: ``dataset_items``, ``evaluation_datasets``, ``evaluation_experiments``,
  ``experiment_results``, ``feedback_scores``.
* Prompts: ``prompt_template_versions``, ``ai_prompt_templates``, ``prompt_sequences``.

Defensive shape and downgrade match prior phase-7 revs.
"""

from collections.abc import Sequence
from alembic import op

revision: str = "consolidation_phase7_05_move_annotation_tables"
down_revision: str = "consolidation_phase7_04_move_recording_tables"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


_TARGET = """ARRAY[
    'annotations','annotation_sets','element_annotations','element_annotation_sets',
    'project_annotation_states',
    'training_datasets','training_dataset_annotations','training_dataset_export_jobs',
    'training_dataset_images','training_jobs',
    'dataset_items','evaluation_datasets','evaluation_experiments','experiment_results',
    'feedback_scores',
    'prompt_template_versions','ai_prompt_templates','prompt_sequences'
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
        IF NOT in_public THEN skipped_missing := skipped_missing + 1; RAISE WARNING 'phase7_05: % missing', tbl; CONTINUE; END IF;
        IF in_project AND in_public THEN RAISE EXCEPTION 'phase7_05: % in BOTH', tbl; END IF;
        EXECUTE format('ALTER TABLE public.%I SET SCHEMA project', tbl);
        moved := moved + 1;
        RAISE NOTICE 'phase7_05: moved %', tbl;
    END LOOP;
    RAISE NOTICE 'phase7_05 summary: moved=%, skipped_already=%, skipped_missing=%', moved, skipped_already, skipped_missing;
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
