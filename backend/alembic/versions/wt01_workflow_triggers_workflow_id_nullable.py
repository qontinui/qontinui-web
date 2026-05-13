"""workflow_triggers.workflow_id nullable for supervision rows

Revision ID: wt01_workflow_triggers_workflow_id_nullable
Revises: coord_tasks_identity_hash
Create Date: 2026-05-13

Supervision-channel trigger rows (D5 Phase 1: `__git-supervision-default__`
and `__spec-file-supervision-default__`) are not tied to a workflow; the
dispatcher routes them to `git_supervision::handle_supervision_action`
on the `ActionType::SupervisionProposal` variant, never loading a
workflow.

Previously the runner stashed `workflow_id = "__supervision__"` as a
sentinel string, but `project.workflow_triggers.workflow_id` has a
NOT NULL constraint plus an FK to `project.unified_workflows.id` —
the FK rejected the sentinel and `bootstrap_default_supervision_triggers`
failed at startup ("PG create_trigger: db error" /
"ForeignKeyViolation: workflow_triggers_workflow_id_fkey").

This migration drops the NOT NULL constraint on `workflow_id`. The
existing FK constraint stays in place; PostgreSQL FKs default to
MATCH SIMPLE, which treats NULL values as "no relationship" — non-NULL
workflow_ids continue to enforce referential integrity against
`unified_workflows.id`.

Companion runner changes in qontinui-runner switch
`WorkflowTrigger.workflow_id: String` to `Option<String>`, with
supervision rows using `None`.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "wt01_workflow_triggers_workflow_id_nullable"
down_revision: str = "coord_tasks_identity_hash"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE project.workflow_triggers
            ALTER COLUMN workflow_id DROP NOT NULL;
        """
    )


def downgrade() -> None:
    op.execute(
        """
        -- Any rows with NULL workflow_id (supervision bootstrap rows) must
        -- be deleted before re-imposing NOT NULL. Production has zero such
        -- rows pre-D5, but the bootstrap inserts them on first startup.
        DELETE FROM project.workflow_triggers WHERE workflow_id IS NULL;

        ALTER TABLE project.workflow_triggers
            ALTER COLUMN workflow_id SET NOT NULL;
        """
    )
