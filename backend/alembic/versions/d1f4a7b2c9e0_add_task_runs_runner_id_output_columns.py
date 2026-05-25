"""add_task_runs_runner_id_output_columns

Adds five columns the ``TaskRun`` SQLAlchemy model
(``backend/app/models/task_run.py``) declares but that no migration ever
shipped:

    runner_id          String(255), nullable, indexed
    output_summary     Text, nullable
    full_output_stored Boolean, NOT NULL, default False
    full_output        Text, nullable
    duration_seconds   Integer, nullable

Schema-drift fix in the same family as
``6201187847ae_add_task_runs_project_id`` and
``7c5e4d3b2a1f_add_task_runs_created_by_user_id``.

Root cause: ``consolidation_phase1_01_infrastructure`` did
``DROP SCHEMA IF EXISTS project RESTRICT`` and the consolidation series
re-created ``project.task_runs`` from scratch
(``consolidation_phase1_02_task_runs``) WITHOUT these columns. The
``project_id`` and ``created_by_user_id`` drifts were patched by the two
sibling revisions above, but ``runner_id`` / ``output_summary`` /
``full_output_stored`` / ``full_output`` / ``duration_seconds`` were
missed. Any ORM-driven SELECT against ``GET /api/v1/task-runs`` loads the
full mapped column set and crashes::

    asyncpg.exceptions.UndefinedColumnError:
        column task_runs.runner_id does not exist

(``runner_id`` is the first absent column the planner reports; the other
four are equally absent.) This is the live same-origin 500 the Spec CI
HTTP-500 invariant surfaced for the ``ai-tasks`` and ``runs`` specs.

All five columns are additive. ``full_output_stored`` is NOT NULL in the
model with ``default=False``; this revision ships a ``server_default`` of
``false`` so pre-existing rows get a concrete value, then it is safe to
leave the server default in place (matches the model intent: rows without
full output stored).

Index ``idx_tr_runner_id`` mirrors the model's ``index=True`` on
``runner_id`` and follows the ``idx_tr_*`` naming convention used by
``consolidation_phase1_02_task_runs.py``.

Revision ID: d1f4a7b2c9e0
Revises: coord_git_ops
Create Date: 2026-05-25
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d1f4a7b2c9e0"
down_revision: str | None = "coord_git_ops"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# Idempotent ``ADD COLUMN IF NOT EXISTS`` / ``CREATE INDEX IF NOT EXISTS``
# (all schema-qualified to ``project`` per the alembic schema-args gate).
# Idempotency lets the same DDL be applied directly to a live DB ahead of
# the migrator pass without the subsequent ``alembic upgrade head`` failing
# on already-present columns.
_UPGRADE_SQL = """
ALTER TABLE project.task_runs
    ADD COLUMN IF NOT EXISTS runner_id VARCHAR(255);
ALTER TABLE project.task_runs
    ADD COLUMN IF NOT EXISTS output_summary TEXT;
ALTER TABLE project.task_runs
    ADD COLUMN IF NOT EXISTS full_output_stored BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE project.task_runs
    ADD COLUMN IF NOT EXISTS full_output TEXT;
ALTER TABLE project.task_runs
    ADD COLUMN IF NOT EXISTS duration_seconds INTEGER;
CREATE INDEX IF NOT EXISTS idx_tr_runner_id
    ON project.task_runs (runner_id);
"""


def upgrade() -> None:
    op.execute(_UPGRADE_SQL)


def downgrade() -> None:
    op.drop_index(
        "idx_tr_runner_id",
        table_name="task_runs",
        schema="project",
    )
    op.drop_column("task_runs", "duration_seconds", schema="project")
    op.drop_column("task_runs", "full_output", schema="project")
    op.drop_column("task_runs", "full_output_stored", schema="project")
    op.drop_column("task_runs", "output_summary", schema="project")
    op.drop_column("task_runs", "runner_id", schema="project")
