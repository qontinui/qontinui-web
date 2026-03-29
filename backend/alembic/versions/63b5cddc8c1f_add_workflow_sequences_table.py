"""add workflow_sequences table

Revision ID: 63b5cddc8c1f
Revises: 8e1c421417fd
Create Date: 2026-02-22 09:17:21.158825

"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "63b5cddc8c1f"
down_revision: str | None = "8e1c421417fd"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "workflow_sequences",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("project_id", sa.UUID(), nullable=False),
        sa.Column("created_by", sa.UUID(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("workflow_ids", sa.JSON(), nullable=False),
        sa.Column("stop_on_failure", sa.Boolean(), nullable=False),
        sa.Column("schedule", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["created_by"],
            ["users.id"],
        ),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_workflow_sequences_created_by"),
        "workflow_sequences",
        ["created_by"],
        unique=False,
    )
    op.create_index(
        op.f("ix_workflow_sequences_id"), "workflow_sequences", ["id"], unique=False
    )
    op.create_index(
        op.f("ix_workflow_sequences_name"), "workflow_sequences", ["name"], unique=False
    )
    op.create_index(
        op.f("ix_workflow_sequences_project_id"),
        "workflow_sequences",
        ["project_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_workflow_sequences_project_id"), table_name="workflow_sequences"
    )
    op.drop_index(op.f("ix_workflow_sequences_name"), table_name="workflow_sequences")
    op.drop_index(op.f("ix_workflow_sequences_id"), table_name="workflow_sequences")
    op.drop_index(
        op.f("ix_workflow_sequences_created_by"), table_name="workflow_sequences"
    )
    op.drop_table("workflow_sequences")
