"""add_custom_functions_table

Revision ID: 3fd23610e37f
Revises: 5826307baebc
Create Date: 2025-11-23 16:33:41.235014

"""

from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "3fd23610e37f"
down_revision: Union[str, None] = "5826307baebc"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create custom_functions table
    op.create_table(
        "custom_functions",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("project_id", UUID(as_uuid=True), nullable=False),
        sa.Column("file_path", sa.String(), nullable=False),
        sa.Column("function_name", sa.String(), nullable=False),
        sa.Column("display_name", sa.String(), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("category", sa.String(), nullable=True),
        sa.Column("tags", sa.JSON(), nullable=False),
        sa.Column("parameters", sa.JSON(), nullable=False),
        sa.Column("return_type", sa.String(), nullable=True),
        sa.Column("inputs", sa.JSON(), nullable=False),
        sa.Column("outputs", sa.JSON(), nullable=False),
        sa.Column("observable_outputs", sa.JSON(), nullable=False),
        sa.Column("source_code", sa.Text(), nullable=True),
        sa.Column("docstring", sa.Text(), nullable=True),
        sa.Column("line_start", sa.Integer(), nullable=True),
        sa.Column("line_end", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "project_id", "file_path", "function_name", name="uq_project_file_function"
        ),
    )
    op.create_index(
        op.f("ix_custom_functions_category"),
        "custom_functions",
        ["category"],
        unique=False,
    )
    op.create_index(
        op.f("ix_custom_functions_file_path"),
        "custom_functions",
        ["file_path"],
        unique=False,
    )
    op.create_index(
        op.f("ix_custom_functions_function_name"),
        "custom_functions",
        ["function_name"],
        unique=False,
    )
    op.create_index(
        op.f("ix_custom_functions_id"), "custom_functions", ["id"], unique=False
    )
    op.create_index(
        op.f("ix_custom_functions_project_id"),
        "custom_functions",
        ["project_id"],
        unique=False,
    )


def downgrade() -> None:
    # Drop custom_functions table
    op.drop_index(op.f("ix_custom_functions_project_id"), table_name="custom_functions")
    op.drop_index(op.f("ix_custom_functions_id"), table_name="custom_functions")
    op.drop_index(
        op.f("ix_custom_functions_function_name"), table_name="custom_functions"
    )
    op.drop_index(op.f("ix_custom_functions_file_path"), table_name="custom_functions")
    op.drop_index(op.f("ix_custom_functions_category"), table_name="custom_functions")
    op.drop_table("custom_functions")
