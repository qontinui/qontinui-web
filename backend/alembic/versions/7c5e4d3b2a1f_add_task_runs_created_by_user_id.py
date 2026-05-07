"""add_task_runs_created_by_user_id

Adds the missing ``created_by_user_id`` column to ``project.task_runs``.

Schema drift fix: the ``TaskRun`` SQLAlchemy model
(``backend/app/models/task_run.py:88``) declares::

    created_by_user_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("auth.users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

but ``consolidation_phase1_02_task_runs.py`` (the original
``project.task_runs`` ``create_table``) did not include this column, and
no follow-up migration ever shipped it. The recently-added
``6201187847ae_add_task_runs_project_id.py`` fixed a sibling drift
(``project_id``) but explicitly did NOT cover ``created_by_user_id``.

The result is that ORM-driven SELECTs against ``/api/v1/task-runs`` and
related endpoints crash in CI with::

    asyncpg.exceptions.UndefinedColumnError:
        column task_runs.created_by_user_id does not exist

This was the dominant backend error in the e2e suite as of run
``25444933967`` (108 occurrences), and is the leading suspect for the
~641 ``page.waitForLoadState`` Playwright timeouts that surface as
collateral when API calls 500-out and the page never reaches
``networkidle`` (see
``_dev-notes-main/qontinui-web-frontend-e2e-bit-rot-layer5/SESSION_PROMPT.md``).

This revision adds the column, the cross-schema FK to
``auth.users.id`` (``ON DELETE SET NULL`` to match the model), and the
index implied by ``index=True`` on the model field. Naming follows the
existing ``idx_tr_*`` convention used by
``consolidation_phase1_02_task_runs.py`` and
``6201187847ae_add_task_runs_project_id.py``.

The column is nullable, so backfill is unnecessary — pre-existing rows
get ``NULL`` (the model's "nullable so local-only / pre-auth task runs
are allowed" case).

Revision ID: 7c5e4d3b2a1f
Revises: 6201187847ae
Create Date: 2026-05-07
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID as PGUUID

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "7c5e4d3b2a1f"
down_revision: str | None = "6201187847ae"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "task_runs",
        sa.Column("created_by_user_id", PGUUID(as_uuid=True), nullable=True),
        schema="project",
    )
    op.create_foreign_key(
        "task_runs_created_by_user_id_fkey",
        "task_runs",
        "users",
        ["created_by_user_id"],
        ["id"],
        source_schema="project",
        referent_schema="auth",
        ondelete="SET NULL",
    )
    op.create_index(
        "idx_tr_created_by_user_id",
        "task_runs",
        ["created_by_user_id"],
        schema="project",
    )


def downgrade() -> None:
    op.drop_index(
        "idx_tr_created_by_user_id",
        table_name="task_runs",
        schema="project",
    )
    op.drop_constraint(
        "task_runs_created_by_user_id_fkey",
        "task_runs",
        type_="foreignkey",
        schema="project",
    )
    op.drop_column("task_runs", "created_by_user_id", schema="project")
