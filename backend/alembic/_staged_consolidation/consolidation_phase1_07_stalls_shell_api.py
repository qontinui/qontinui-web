"""consolidation phase1 07 stalls / shell / API

Revision ID: consolidation_phase1_07_stalls_shell_api
Revises: consolidation_phase1_06_ui_bridge
Create Date: 2026-04-29

Phase 1, batch 7: stalls / shell / API tables in ``project``.

- ``project.stall_events`` — stall detection and intervention tracking.
- ``project.shell_commands`` — reusable shell command definitions.
- ``project.saved_api_requests`` — reusable API request templates.
- ``project.mcp_servers`` — external MCP tool server configurations.

Source: ``schema.pg.sql:645-723``.

DRIFT FLAG: ``stall_events.task_run_id`` is ``TEXT NOT NULL`` in source
but has NO FK declared. Preserved as plain TEXT NOT NULL.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "consolidation_phase1_07_stalls_shell_api"
down_revision: str = "consolidation_phase1_06_ui_bridge"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "stall_events",
        sa.Column("id", sa.Text(), nullable=False, server_default=sa.text("gen_random_uuid()::text")),
        sa.Column("task_run_id", sa.Text(), nullable=False),
        sa.Column("iteration", sa.Integer(), nullable=False),
        sa.Column("pattern_type", sa.Text(), nullable=False),
        sa.Column("pattern_details", sa.Text(), nullable=True),
        sa.Column("action_count", sa.Integer(), nullable=True),
        sa.Column("intervention_action", sa.Text(), nullable=True),
        sa.Column("intervention_result", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_stall_task_run", "stall_events", ["task_run_id"], schema="project")
    op.create_index("idx_stall_pattern", "stall_events", ["pattern_type"], schema="project")

    op.create_table(
        "shell_commands",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("command", sa.Text(), nullable=False),
        sa.Column("working_directory", sa.Text(), nullable=True),
        sa.Column("timeout_seconds", sa.Integer(), nullable=True),
        sa.Column("fail_on_error", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("category", sa.Text(), nullable=True, server_default=sa.text("'general'")),
        sa.Column("tags", sa.Text(), nullable=True, server_default=sa.text("'[]'")),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_sc_category", "shell_commands", ["category"], schema="project")
    op.create_index("idx_sc_enabled", "shell_commands", ["enabled"], schema="project")

    op.create_table(
        "saved_api_requests",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("category", sa.Text(), nullable=True, server_default=sa.text("'general'")),
        sa.Column("tags", sa.Text(), nullable=True, server_default=sa.text("'[]'")),
        sa.Column("method", sa.Text(), nullable=False, server_default=sa.text("'GET'")),
        sa.Column("url", sa.Text(), nullable=False),
        sa.Column("headers", sa.Text(), nullable=True, server_default=sa.text("'{}'")),
        sa.Column("body", sa.Text(), nullable=True),
        sa.Column("body_content_type", sa.Text(), nullable=True, server_default=sa.text("'application/json'")),
        sa.Column("timeout_ms", sa.Integer(), nullable=True, server_default=sa.text("30000")),
        sa.Column("follow_redirects", sa.Boolean(), nullable=True, server_default=sa.text("true")),
        sa.Column("variable_extractions", sa.Text(), nullable=True, server_default=sa.text("'[]'")),
        sa.Column("assertions", sa.Text(), nullable=True, server_default=sa.text("'[]'")),
        sa.Column("credential_id", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_sar_category", "saved_api_requests", ["category"], schema="project")

    op.create_table(
        "mcp_servers",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("transport", sa.Text(), nullable=False),
        sa.Column("stdio_config", sa.Text(), nullable=True),
        sa.Column("http_config", sa.Text(), nullable=True),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("auto_start", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("timeout_seconds", sa.Integer(), nullable=False, server_default=sa.text("30")),
        sa.Column("cached_tools", sa.Text(), nullable=True),
        sa.Column("tools_cached_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("connection_state", sa.Text(), nullable=False, server_default=sa.text("'disconnected'")),
        sa.Column("last_connected_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index("idx_mcp_enabled", "mcp_servers", ["enabled"], schema="project")


def downgrade() -> None:
    op.drop_table("mcp_servers", schema="project")
    op.drop_table("saved_api_requests", schema="project")
    op.drop_table("shell_commands", schema="project")
    op.drop_table("stall_events", schema="project")
