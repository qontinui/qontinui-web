"""consolidation phase1 12 coord — sessions + worktrees (CROSS-SCHEMA)

Revision ID: consolidation_phase1_12_coord_sessions_worktrees
Revises: consolidation_phase1_11_generation_pipeline
Create Date: 2026-04-29

Phase 1, batch 12: the FIRST cross-schema batch. Per the schema mapping
in the plan:

- ``coord.worktrees`` — worktree leases are coordination state.
- ``coord.session_touched_files`` — visible across machines for the
  file-conflict prediction in coord plan §7.
- ``project.workflow_constraint_results`` — durable per-task data
  (FK→``project.task_runs`` CASCADE).
- ``project.sessions`` — orchestration session tracking.
- ``project.session_events`` — session activity log.

Source: ``schema.pg.sql:1457-1542``.

DRIFT FLAGS (preserved):
- ``coord.worktrees.task_run_id`` is ``TEXT`` with no FK to
  ``project.task_runs``. Could conceptually be a soft FK; preserved
  as-is. Cross-schema FKs work in Postgres but the source declares none.
- ``coord.session_touched_files.task_run_id`` and ``worktree_id``
  similarly have no FKs in source. Preserved.
- ``project.session_events.session_id`` has no FK to
  ``project.sessions(id)`` in source. Preserved.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "consolidation_phase1_12_coord_sessions_worktrees"
down_revision: str = "consolidation_phase1_11_generation_pipeline"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # coord.worktrees
    op.create_table(
        "worktrees",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("worktree_path", sa.Text(), nullable=False),
        sa.Column("branch_name", sa.Text(), nullable=False),
        sa.Column("source_branch", sa.Text(), nullable=False),
        sa.Column("source_commit", sa.Text(), nullable=False),
        sa.Column("repo_path", sa.Text(), nullable=False),
        sa.Column("task_run_id", sa.Text(), nullable=True),
        sa.Column("workflow_name", sa.Text(), nullable=True),
        sa.Column("status", sa.Text(), nullable=False, server_default=sa.text("'active'")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        schema="coord",
    )
    op.create_index("idx_worktrees_status", "worktrees", ["status"], schema="coord")
    op.create_index("idx_worktrees_task_run", "worktrees", ["task_run_id"], schema="coord")

    # coord.session_touched_files (composite PK: task_run_id + file_path)
    op.create_table(
        "session_touched_files",
        sa.Column("task_run_id", sa.Text(), nullable=False),
        sa.Column("file_path", sa.Text(), nullable=False),
        sa.Column("worktree_id", sa.Text(), nullable=True),
        sa.Column("recorded_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("task_run_id", "file_path"),
        schema="coord",
    )
    op.create_index("idx_session_touched_files_task_run", "session_touched_files", ["task_run_id"], schema="coord")
    op.create_index("idx_session_touched_files_recorded_at", "session_touched_files", ["recorded_at"], schema="coord")

    # project.workflow_constraint_results (FK→project.task_runs CASCADE)
    op.create_table(
        "workflow_constraint_results",
        sa.Column("id", sa.BigInteger(), nullable=False, autoincrement=True),
        sa.Column(
            "task_run_id",
            sa.Text(),
            sa.ForeignKey("project.task_runs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("iteration", sa.Integer(), nullable=False),
        sa.Column("constraint_id", sa.Text(), nullable=False),
        sa.Column("constraint_name", sa.Text(), nullable=False),
        sa.Column("passed", sa.Boolean(), nullable=False),
        sa.Column("severity", sa.Text(), nullable=False),
        sa.Column("violations_json", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_wf_constraint_task_run", "workflow_constraint_results", ["task_run_id"], schema="project")
    op.create_index("idx_wf_constraint_iteration", "workflow_constraint_results", ["iteration"], schema="project")

    # project.sessions
    op.create_table(
        "sessions",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("session_type", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False, server_default=sa.text("'starting'")),
        sa.Column("current_phase", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("total_phases", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("completed", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("restart_permitted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("custom_data", sa.Text(), nullable=True, server_default=sa.text("'{}'")),
        sa.Column("activity_log", sa.Text(), nullable=True, server_default=sa.text("'[]'")),
        sa.Column("run_id", sa.Text(), nullable=True),
        sa.Column("workflow_name", sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_sessions_status", "sessions", ["status"], schema="project")
    op.create_index("idx_sessions_workflow_name", "sessions", ["workflow_name"], schema="project")
    op.create_index("idx_sessions_run_id", "sessions", ["run_id"], schema="project")
    op.create_index("idx_sessions_created_at", "sessions", ["created_at"], schema="project")

    # project.session_events (no FK on session_id in source)
    op.create_table(
        "session_events",
        sa.Column("id", sa.BigInteger(), nullable=False, autoincrement=True),
        sa.Column("session_id", sa.Text(), nullable=False),
        sa.Column("event_type", sa.Text(), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("timestamp", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_session_events_session_id", "session_events", ["session_id"], schema="project")


def downgrade() -> None:
    op.drop_table("session_events", schema="project")
    op.drop_table("sessions", schema="project")
    op.drop_table("workflow_constraint_results", schema="project")
    op.drop_table("session_touched_files", schema="coord")
    op.drop_table("worktrees", schema="coord")
