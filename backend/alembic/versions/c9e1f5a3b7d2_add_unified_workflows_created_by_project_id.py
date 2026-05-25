"""add_unified_workflows_created_by_user_id_and_project_id

Adds the missing ``created_by_user_id`` and ``project_id`` columns to
``project.unified_workflows``.

Schema drift fix (sibling of ``7c5e4d3b2a1f_add_task_runs_created_by_user_id``):
the ``UnifiedWorkflow`` SQLAlchemy model
(``backend/app/models/unified_workflow.py:42-52``) declares both columns
(nullable, indexed)::

    created_by_user_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True), nullable=True, index=True,
    )
    project_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True), nullable=True, index=True,
    )

The original ``b97e3bd6e0c7_add_unified_workflows_table`` create_table DID
include them, but the consolidation lineage
(``consolidation_phase1_04_workflows.py``) — which owns the live
``project.unified_workflows`` table — created it WITHOUT either column, and
no follow-up migration ever shipped them. The result is that
``UnifiedWorkflowService.create_workflow`` (which sets
``created_by_user_id=user_id`` and ``project_id=...``) crashes every
``POST /api/v1/unified-workflows`` with::

    asyncpg.exceptions.UndefinedColumnError:
        column "created_by_user_id" of relation "unified_workflows" does not exist

(observed on staging RDS 2026-05-25; ``project_id`` is the next undefined
column the INSERT would hit). This blocks all workflow creation AND the
dispatch path, since ``workflow_dispatcher`` loads from this same table.

The model declares NO foreign keys on these columns (unlike ``task_runs``),
so this migration adds the columns + the ``index=True`` indexes only — no
FK constraints — matching the ORM contract exactly.

Idempotent (``IF NOT EXISTS``) so it is a no-op in any environment whose
table was created via the ``b97e3bd6e0c7`` lineage (which already has the
columns) and a real fix in the consolidation lineage that lacks them.

Revision ID: c9e1f5a3b7d2
Revises: e2c8b5d1f3a6
Create Date: 2026-05-25
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c9e1f5a3b7d2"
down_revision: str | None = "e2c8b5d1f3a6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE project.unified_workflows "
        "ADD COLUMN IF NOT EXISTS created_by_user_id UUID"
    )
    op.execute(
        "ALTER TABLE project.unified_workflows "
        "ADD COLUMN IF NOT EXISTS project_id UUID"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_unified_workflows_created_by_user_id "
        "ON project.unified_workflows (created_by_user_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_unified_workflows_project_id "
        "ON project.unified_workflows (project_id)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS project.ix_unified_workflows_project_id")
    op.execute(
        "DROP INDEX IF EXISTS project.ix_unified_workflows_created_by_user_id"
    )
    op.execute(
        "ALTER TABLE project.unified_workflows DROP COLUMN IF EXISTS project_id"
    )
    op.execute(
        "ALTER TABLE project.unified_workflows "
        "DROP COLUMN IF EXISTS created_by_user_id"
    )
