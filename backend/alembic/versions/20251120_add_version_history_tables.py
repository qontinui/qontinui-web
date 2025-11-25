"""add_version_history_tables.

Revision ID: 20251120_add_version_history
Revises: 20251120_094121
Create Date: 2025-11-20 10:00:00

This migration adds two new tables for version history and event sourcing:
1. project_versions - Stores full project state snapshots at specific points in time
2. edit_commands - Event sourcing log of all changes made to projects

These tables enable:
- Version history with full snapshots (easy restore)
- Event sourcing for audit trails
- Time travel and comparison between versions
- Granular change tracking
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

# revision identifiers, used by Alembic.
revision: str = "20251120_add_version_history"
down_revision: Union[str, None] = "20251120_094121"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create project_versions and edit_commands tables."""
    # Create project_versions table
    op.create_table(
        "project_versions",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "project_id",
            sa.Integer(),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("version_number", sa.Integer(), nullable=False),
        sa.Column("snapshot", sa.JSON(), nullable=False),
        sa.Column(
            "created_by",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("comment", sa.Text(), nullable=True),
    )

    # Create unique constraint and composite index for project_versions
    op.create_unique_constraint(
        "uq_project_version", "project_versions", ["project_id", "version_number"]
    )
    op.create_index(
        "ix_project_versions_project_created",
        "project_versions",
        ["project_id", "created_at"],
    )

    # Create edit_commands table
    op.create_table(
        "edit_commands",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "project_id",
            sa.Integer(),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("command_type", sa.String(), nullable=False),
        sa.Column("entity_type", sa.String(), nullable=False),
        sa.Column("entity_id", sa.String(), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("sequence_number", sa.Integer(), nullable=False),
        sa.Column("applied_at", sa.DateTime(), nullable=False, index=True),
    )

    # Create unique constraint for sequence numbers
    op.create_unique_constraint(
        "uq_project_command_seq", "edit_commands", ["project_id", "sequence_number"]
    )


def downgrade() -> None:
    """Drop project_versions and edit_commands tables."""
    # Drop edit_commands table and constraints
    op.drop_constraint("uq_project_command_seq", "edit_commands", type_="unique")
    op.drop_index("ix_edit_commands_applied_at", table_name="edit_commands")
    op.drop_index("ix_edit_commands_project_id", table_name="edit_commands")
    op.drop_table("edit_commands")

    # Drop project_versions table and constraints
    op.drop_index("ix_project_versions_project_created", table_name="project_versions")
    op.drop_constraint("uq_project_version", "project_versions", type_="unique")
    op.drop_index("ix_project_versions_project_id", table_name="project_versions")
    op.drop_table("project_versions")
