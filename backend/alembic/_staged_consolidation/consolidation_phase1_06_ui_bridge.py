"""consolidation phase1 06 ui_bridge

Revision ID: consolidation_phase1_06_ui_bridge
Revises: consolidation_phase1_05_learning
Create Date: 2026-04-29

Phase 1, batch 6: UI Bridge tables in ``project``.

- ``project.ui_bridge_elements`` — element snapshots from pages.
- ``project.ui_bridge_events`` — action and state-change timeline.
- ``project.ui_bridge_navigation_history`` — path execution records.
- ``project.ui_bridge_integrations`` — registered integration metadata.
- ``project.ui_bridge_states`` — registered UI states for navigation.
- ``project.ui_bridge_transitions`` — registered transitions between states.

Source: ``schema.pg.sql:575-644, 1949-1986, 3050-3066``.

DRIFT FLAGS (preserved per fidelity policy):
- ``ui_bridge_elements.task_run_id``, ``ui_bridge_events.task_run_id``,
  ``ui_bridge_navigation_history.task_run_id`` are ``BIGINT`` in source
  while ``project.task_runs.id`` is ``TEXT``. No FK declared in source;
  preserved as plain ``BIGINT`` columns. Likely a soft-FK type mismatch
  introduced incrementally.
- ``ui_bridge_integrations.created_at/updated_at`` are ``INTEGER`` in
  source (epoch timestamps), not ``TIMESTAMPTZ``. Preserved.
- ``ui_bridge_states.blocking``, ``ui_bridge_states.is_active`` are
  ``INTEGER`` in source (0/1 flags), not ``BOOLEAN``. Preserved.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "consolidation_phase1_06_ui_bridge"
down_revision: str = "consolidation_phase1_05_learning"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # ui_bridge_elements
    op.create_table(
        "ui_bridge_elements",
        sa.Column("id", sa.BigInteger(), nullable=False, autoincrement=True),
        sa.Column("task_run_id", sa.BigInteger(), nullable=True),
        sa.Column("timestamp", sa.BigInteger(), nullable=False),
        sa.Column("element_id", sa.Text(), nullable=False),
        sa.Column("tag_name", sa.Text(), nullable=True),
        sa.Column("element_type", sa.Text(), nullable=True),
        sa.Column("bounds", sa.Text(), nullable=True),
        sa.Column("visible", sa.Boolean(), nullable=True, server_default=sa.text("true")),
        sa.Column("enabled", sa.Boolean(), nullable=True, server_default=sa.text("true")),
        sa.Column("focused", sa.Boolean(), nullable=True, server_default=sa.text("false")),
        sa.Column("value", sa.Text(), nullable=True),
        sa.Column("text_content", sa.Text(), nullable=True),
        sa.Column("label", sa.Text(), nullable=True),
        sa.Column("role", sa.Text(), nullable=True),
        sa.Column("parent_element_id", sa.Text(), nullable=True),
        sa.Column("page_url", sa.Text(), nullable=True),
        sa.Column("selector", sa.Text(), nullable=True),
        sa.Column("state_ids", sa.Text(), nullable=True),
        sa.Column("metadata", sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_ube_task_run", "ui_bridge_elements", ["task_run_id"], schema="project")
    op.create_index("idx_ube_element_id", "ui_bridge_elements", ["element_id"], schema="project")
    op.create_index("idx_ube_timestamp", "ui_bridge_elements", ["timestamp"], schema="project")

    # ui_bridge_events
    op.create_table(
        "ui_bridge_events",
        sa.Column("id", sa.BigInteger(), nullable=False, autoincrement=True),
        sa.Column("task_run_id", sa.BigInteger(), nullable=True),
        sa.Column("timestamp", sa.BigInteger(), nullable=False),
        sa.Column("sequence", sa.BigInteger(), nullable=False),
        sa.Column("event_type", sa.Text(), nullable=False),
        sa.Column("element_id", sa.Text(), nullable=True),
        sa.Column("state_id", sa.Text(), nullable=True),
        sa.Column("transition_id", sa.Text(), nullable=True),
        sa.Column("action", sa.Text(), nullable=True),
        sa.Column("params", sa.Text(), nullable=True),
        sa.Column("result", sa.Text(), nullable=True),
        sa.Column("duration_ms", sa.Float(), nullable=True),
        sa.Column("success", sa.Boolean(), nullable=True, server_default=sa.text("true")),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("metadata", sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_ubev_task_run", "ui_bridge_events", ["task_run_id"], schema="project")
    op.create_index("idx_ubev_type", "ui_bridge_events", ["event_type"], schema="project")
    op.create_index("idx_ubev_timestamp", "ui_bridge_events", ["timestamp"], schema="project")
    op.create_index("idx_ubev_element", "ui_bridge_events", ["element_id"], schema="project")
    op.create_index("idx_ubev_state", "ui_bridge_events", ["state_id"], schema="project")

    # ui_bridge_navigation_history
    op.create_table(
        "ui_bridge_navigation_history",
        sa.Column("id", sa.BigInteger(), nullable=False, autoincrement=True),
        sa.Column("task_run_id", sa.BigInteger(), nullable=True),
        sa.Column("timestamp", sa.BigInteger(), nullable=False),
        sa.Column("target_states", sa.Text(), nullable=False),
        sa.Column("path_found", sa.Boolean(), nullable=False),
        sa.Column("transitions_planned", sa.Text(), nullable=True),
        sa.Column("transitions_executed", sa.Text(), nullable=True),
        sa.Column("total_cost", sa.Float(), nullable=True),
        sa.Column("duration_ms", sa.Float(), nullable=True),
        sa.Column("success", sa.Boolean(), nullable=True, server_default=sa.text("false")),
        sa.Column("final_active_states", sa.Text(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_ubnav_task_run", "ui_bridge_navigation_history", ["task_run_id"], schema="project")

    # ui_bridge_integrations (created_at/updated_at are INTEGER per source — drift flag)
    op.create_table(
        "ui_bridge_integrations",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("project_path", sa.Text(), nullable=False),
        sa.Column("label", sa.Text(), nullable=True),
        sa.Column("framework", sa.Text(), nullable=True),
        sa.Column("integration_type", sa.Text(), nullable=False),
        sa.Column("sdk_version", sa.Text(), nullable=True),
        sa.Column("status", sa.Text(), nullable=False, server_default=sa.text("'active'")),
        sa.Column("target_url", sa.Text(), nullable=True),
        sa.Column("last_health_check", sa.Integer(), nullable=True),
        sa.Column("element_count", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_ui_bridge_integrations_status", "ui_bridge_integrations", ["status"], schema="project")
    op.create_index("idx_ui_bridge_integrations_type", "ui_bridge_integrations", ["integration_type"], schema="project")

    # ui_bridge_states (blocking and is_active are INTEGER 0/1 — drift flag)
    op.create_table(
        "ui_bridge_states",
        sa.Column("id", sa.BigInteger(), nullable=False, autoincrement=True),
        sa.Column("state_id", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("elements", sa.Text(), nullable=True),
        sa.Column("blocking", sa.Integer(), nullable=True, server_default=sa.text("0")),
        sa.Column("blocks", sa.Text(), nullable=True),
        sa.Column("group_id", sa.Text(), nullable=True),
        sa.Column("path_cost", sa.Float(), nullable=True, server_default=sa.text("1.0")),
        sa.Column("is_active", sa.Integer(), nullable=True, server_default=sa.text("0")),
        sa.Column("active_when", sa.Text(), nullable=True),
        sa.Column("metadata", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("state_id"),
        schema="project",
    )
    op.create_index("idx_ui_bridge_states_state_id", "ui_bridge_states", ["state_id"], schema="project")
    op.create_index("idx_ui_bridge_states_group", "ui_bridge_states", ["group_id"], schema="project")
    op.create_index("idx_ui_bridge_states_active", "ui_bridge_states", ["is_active"], schema="project")

    # ui_bridge_transitions
    op.create_table(
        "ui_bridge_transitions",
        sa.Column("id", sa.BigInteger(), nullable=False, autoincrement=True),
        sa.Column("transition_id", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("from_states", sa.Text(), nullable=False),
        sa.Column("activate_states", sa.Text(), nullable=False),
        sa.Column("exit_states", sa.Text(), nullable=True),
        sa.Column("activate_groups", sa.Text(), nullable=True),
        sa.Column("exit_groups", sa.Text(), nullable=True),
        sa.Column("actions", sa.Text(), nullable=True),
        sa.Column("path_cost", sa.Float(), nullable=True, server_default=sa.text("1.0")),
        sa.Column("stays_visible", sa.Boolean(), nullable=True, server_default=sa.text("false")),
        sa.Column("metadata", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("transition_id"),
        schema="project",
    )
    op.create_index("idx_ubt_transition_id", "ui_bridge_transitions", ["transition_id"], schema="project")


def downgrade() -> None:
    op.drop_table("ui_bridge_transitions", schema="project")
    op.drop_table("ui_bridge_states", schema="project")
    op.drop_table("ui_bridge_integrations", schema="project")
    op.drop_table("ui_bridge_navigation_history", schema="project")
    op.drop_table("ui_bridge_events", schema="project")
    op.drop_table("ui_bridge_elements", schema="project")
