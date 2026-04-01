"""add discoveries table

Revision ID: 5d29ac9ab52d
Revises: d082ecd43831
Create Date: 2026-01-01 13:56:41.240825

"""

from typing import Sequence, Union

import fastapi_users_db_sqlalchemy
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "5d29ac9ab52d"
down_revision: Union[str, None] = "d082ecd43831"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create discoveries table
    op.create_table(
        "discoveries",
        sa.Column(
            "id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False
        ),
        sa.Column(
            "user_id", fastapi_users_db_sqlalchemy.generics.GUID(), nullable=False
        ),
        sa.Column("project_id", sa.UUID(), nullable=False),
        sa.Column("runner_id", sa.String(length=100), nullable=False),
        sa.Column("runner_name", sa.String(length=255), nullable=True),
        sa.Column("config_id", sa.String(length=100), nullable=False),
        sa.Column("config_name", sa.String(length=255), nullable=True),
        sa.Column("discovery_type", sa.String(length=50), nullable=False),
        sa.Column("title", sa.String(length=500), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column(
            "discovery_data",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column(
            "evidence",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column("confidence", sa.Float(), nullable=False),
        sa.Column("runs_observed", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "reviewed_by_id", fastapi_users_db_sqlalchemy.generics.GUID(), nullable=True
        ),
        sa.Column("user_notes", sa.Text(), nullable=True),
        sa.Column("applied_to_config", sa.Boolean(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["reviewed_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    # Create indexes
    op.create_index(
        op.f("ix_discoveries_config_id"), "discoveries", ["config_id"], unique=False
    )
    op.create_index(
        "ix_discoveries_config_type",
        "discoveries",
        ["config_id", "discovery_type"],
        unique=False,
    )
    op.create_index(
        op.f("ix_discoveries_discovery_type"),
        "discoveries",
        ["discovery_type"],
        unique=False,
    )
    op.create_index(
        op.f("ix_discoveries_project_id"), "discoveries", ["project_id"], unique=False
    )
    op.create_index(
        "ix_discoveries_project_status",
        "discoveries",
        ["project_id", "status"],
        unique=False,
    )
    op.create_index(
        op.f("ix_discoveries_runner_id"), "discoveries", ["runner_id"], unique=False
    )
    op.create_index(
        op.f("ix_discoveries_status"), "discoveries", ["status"], unique=False
    )
    op.create_index(
        op.f("ix_discoveries_user_id"), "discoveries", ["user_id"], unique=False
    )
    op.create_index(
        "ix_discoveries_user_status", "discoveries", ["user_id", "status"], unique=False
    )


def downgrade() -> None:
    # Drop indexes
    op.drop_index("ix_discoveries_user_status", table_name="discoveries")
    op.drop_index(op.f("ix_discoveries_user_id"), table_name="discoveries")
    op.drop_index(op.f("ix_discoveries_status"), table_name="discoveries")
    op.drop_index(op.f("ix_discoveries_runner_id"), table_name="discoveries")
    op.drop_index("ix_discoveries_project_status", table_name="discoveries")
    op.drop_index(op.f("ix_discoveries_project_id"), table_name="discoveries")
    op.drop_index(op.f("ix_discoveries_discovery_type"), table_name="discoveries")
    op.drop_index("ix_discoveries_config_type", table_name="discoveries")
    op.drop_index(op.f("ix_discoveries_config_id"), table_name="discoveries")
    # Drop table
    op.drop_table("discoveries")
