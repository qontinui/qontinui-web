"""Add snapshot tables for integration testing

Revision ID: e45f9b2c3d1a
Revises: 67c33a12bedb
Create Date: 2025-11-13 14:00:00.000000

"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "e45f9b2c3d1a"
down_revision = "67c33a12bedb"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Create snapshot_runs table
    op.create_table(
        "snapshot_runs",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("run_id", sa.String(length=255), nullable=False),
        sa.Column("run_name", sa.String(length=255), nullable=False),
        sa.Column("project_id", sa.Integer(), nullable=True),
        sa.Column("workflow_id", sa.Integer(), nullable=True),
        sa.Column("timestamp", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("states", postgresql.JSON(astext_type=sa.Text()), nullable=False),
        sa.Column("metadata", postgresql.JSON(astext_type=sa.Text()), nullable=False),
        sa.Column("tags", postgresql.JSON(astext_type=sa.Text()), nullable=False),
        sa.Column("num_screenshots", sa.Integer(), nullable=False),
        sa.Column("num_patterns", sa.Integer(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("run_id"),
    )
    op.create_index(op.f("ix_snapshot_runs_id"), "snapshot_runs", ["id"], unique=False)
    op.create_index(
        op.f("ix_snapshot_runs_project_id"),
        "snapshot_runs",
        ["project_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_snapshot_runs_run_id"), "snapshot_runs", ["run_id"], unique=False
    )
    op.create_index(
        op.f("ix_snapshot_runs_workflow_id"),
        "snapshot_runs",
        ["workflow_id"],
        unique=False,
    )

    # Create screenshots table
    op.create_table(
        "screenshots",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("snapshot_run_id", sa.Integer(), nullable=False),
        sa.Column("screenshot_path", sa.String(length=500), nullable=False),
        sa.Column(
            "active_states", postgresql.JSON(astext_type=sa.Text()), nullable=False
        ),
        sa.Column("timestamp", sa.DateTime(timezone=True), nullable=False),
        sa.Column("width", sa.Integer(), nullable=False),
        sa.Column("height", sa.Integer(), nullable=False),
        sa.Column("state_hash", sa.String(length=64), nullable=False),
        sa.Column("metadata", postgresql.JSON(astext_type=sa.Text()), nullable=False),
        sa.ForeignKeyConstraint(
            ["snapshot_run_id"], ["snapshot_runs.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_screenshots_id"), "screenshots", ["id"], unique=False)
    op.create_index(
        op.f("ix_screenshots_snapshot_run_id"),
        "screenshots",
        ["snapshot_run_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_screenshots_state_hash"), "screenshots", ["state_hash"], unique=False
    )

    # Create patterns table
    op.create_table(
        "patterns",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("snapshot_run_id", sa.Integer(), nullable=False),
        sa.Column("pattern_id", sa.String(length=255), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("type", sa.String(length=50), nullable=False),
        sa.Column("screenshot_path", sa.String(length=500), nullable=False),
        sa.Column("region", postgresql.JSON(astext_type=sa.Text()), nullable=False),
        sa.Column(
            "active_states", postgresql.JSON(astext_type=sa.Text()), nullable=False
        ),
        sa.Column("confidence", sa.Integer(), nullable=False),
        sa.Column("metadata", postgresql.JSON(astext_type=sa.Text()), nullable=False),
        sa.ForeignKeyConstraint(
            ["snapshot_run_id"], ["snapshot_runs.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("pattern_id"),
    )
    op.create_index(op.f("ix_patterns_id"), "patterns", ["id"], unique=False)
    op.create_index(
        op.f("ix_patterns_pattern_id"), "patterns", ["pattern_id"], unique=False
    )
    op.create_index(
        op.f("ix_patterns_snapshot_run_id"),
        "patterns",
        ["snapshot_run_id"],
        unique=False,
    )
    op.create_index(op.f("ix_patterns_type"), "patterns", ["type"], unique=False)


def downgrade() -> None:
    # Drop tables in reverse order
    op.drop_index(op.f("ix_patterns_type"), table_name="patterns")
    op.drop_index(op.f("ix_patterns_snapshot_run_id"), table_name="patterns")
    op.drop_index(op.f("ix_patterns_pattern_id"), table_name="patterns")
    op.drop_index(op.f("ix_patterns_id"), table_name="patterns")
    op.drop_table("patterns")

    op.drop_index(op.f("ix_screenshots_state_hash"), table_name="screenshots")
    op.drop_index(op.f("ix_screenshots_snapshot_run_id"), table_name="screenshots")
    op.drop_index(op.f("ix_screenshots_id"), table_name="screenshots")
    op.drop_table("screenshots")

    op.drop_index(op.f("ix_snapshot_runs_workflow_id"), table_name="snapshot_runs")
    op.drop_index(op.f("ix_snapshot_runs_run_id"), table_name="snapshot_runs")
    op.drop_index(op.f("ix_snapshot_runs_project_id"), table_name="snapshot_runs")
    op.drop_index(op.f("ix_snapshot_runs_id"), table_name="snapshot_runs")
    op.drop_table("snapshot_runs")
