"""add_task_runs_project_id

Adds the missing ``project_id`` column to ``project.task_runs``.

Schema drift fix: the ``TaskRun`` SQLAlchemy model
(``backend/app/models/task_run.py:80``) has declared

    project_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("project.projects.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

since 2026-01-08 (commit ``49a7d3f55``), and the FK target was retargeted
to the ``project`` schema on 2026-05-01 (commit ``9c88b022``) when
``projects`` itself moved schemas in
``consolidation_phase7_06_move_project_library_tables``. No migration
ever shipped the column, so ORM-driven SELECTs against
``/api/v1/task-runs`` crash in CI with::

    asyncpg.exceptions.UndefinedColumnError:
        column task_runs.project_id does not exist

This revision adds the column, the cross-schema FK to
``project.projects.id`` (``ON DELETE SET NULL`` to match the model), and
the index implied by ``index=True`` on the model field. Naming follows
the existing ``idx_tr_*`` convention used by
``consolidation_phase1_02_task_runs.py``.

The column is nullable, so backfill is unnecessary — pre-existing rows
get ``NULL`` (the model's "nullable for local-only development" case).

Revision ID: 6201187847ae
Revises: f9d3e8a4c1b6
Create Date: 2026-05-06
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID as PGUUID

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "6201187847ae"
down_revision: str | None = "f9d3e8a4c1b6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "task_runs",
        sa.Column("project_id", PGUUID(as_uuid=True), nullable=True),
        schema="project",
    )
    op.create_foreign_key(
        "task_runs_project_id_fkey",
        "task_runs",
        "projects",
        ["project_id"],
        ["id"],
        source_schema="project",
        referent_schema="project",
        ondelete="SET NULL",
    )
    op.create_index(
        "idx_tr_project_id",
        "task_runs",
        ["project_id"],
        schema="project",
    )


def downgrade() -> None:
    op.drop_index(
        "idx_tr_project_id",
        table_name="task_runs",
        schema="project",
    )
    op.drop_constraint(
        "task_runs_project_id_fkey",
        "task_runs",
        type_="foreignkey",
        schema="project",
    )
    op.drop_column("task_runs", "project_id", schema="project")
