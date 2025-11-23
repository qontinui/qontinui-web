"""add_workflow_variables_tables

Revision ID: 114017dc2943
Revises: 20251122_session_input_enum
Create Date: 2025-11-23 00:20:32.131177

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "114017dc2943"
down_revision: Union[str, None] = "20251122_session_input_enum"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Detect projects.id column type dynamically
    conn = op.get_bind()
    result = conn.execute(
        sa.text(
            """
        SELECT data_type
        FROM information_schema.columns
        WHERE table_name = 'projects' AND column_name = 'id'
    """
        )
    )
    row = result.fetchone()
    project_id_type = sa.UUID() if row and "uuid" in row[0].lower() else sa.Integer()

    # Create workflow_variables table
    op.create_table(
        "workflow_variables",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("project_id", project_id_type, nullable=False),
        sa.Column("workflow_id", sa.String(), nullable=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("value", sa.JSON(), nullable=True),
        sa.Column(
            "scope", sa.Enum("GLOBAL", "WORKFLOW", name="variablescope"), nullable=False
        ),
        sa.Column("description", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "project_id", "workflow_id", "name", name="uq_project_workflow_var"
        ),
    )
    op.create_index(
        op.f("ix_workflow_variables_name"), "workflow_variables", ["name"], unique=False
    )
    op.create_index(
        op.f("ix_workflow_variables_project_id"),
        "workflow_variables",
        ["project_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_workflow_variables_scope"),
        "workflow_variables",
        ["scope"],
        unique=False,
    )
    op.create_index(
        op.f("ix_workflow_variables_workflow_id"),
        "workflow_variables",
        ["workflow_id"],
        unique=False,
    )

    # Create variable_history table
    op.create_table(
        "variable_history",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("variable_id", sa.String(), nullable=False),
        sa.Column("workflow_run_id", sa.String(), nullable=True),
        sa.Column("old_value", sa.JSON(), nullable=True),
        sa.Column("new_value", sa.JSON(), nullable=True),
        sa.Column("changed_at", sa.DateTime(), nullable=False),
        sa.Column("changed_by_action", sa.String(), nullable=True),
        sa.ForeignKeyConstraint(
            ["variable_id"],
            ["workflow_variables.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_variable_history_changed_at"),
        "variable_history",
        ["changed_at"],
        unique=False,
    )
    op.create_index(
        op.f("ix_variable_history_variable_id"),
        "variable_history",
        ["variable_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_variable_history_workflow_run_id"),
        "variable_history",
        ["workflow_run_id"],
        unique=False,
    )


def downgrade() -> None:
    # Drop variable_history table
    op.drop_index(
        op.f("ix_variable_history_workflow_run_id"), table_name="variable_history"
    )
    op.drop_index(
        op.f("ix_variable_history_variable_id"), table_name="variable_history"
    )
    op.drop_index(op.f("ix_variable_history_changed_at"), table_name="variable_history")
    op.drop_table("variable_history")

    # Drop workflow_variables table
    op.drop_index(
        op.f("ix_workflow_variables_workflow_id"), table_name="workflow_variables"
    )
    op.drop_index(op.f("ix_workflow_variables_scope"), table_name="workflow_variables")
    op.drop_index(
        op.f("ix_workflow_variables_project_id"), table_name="workflow_variables"
    )
    op.drop_index(op.f("ix_workflow_variables_name"), table_name="workflow_variables")
    op.drop_table("workflow_variables")
