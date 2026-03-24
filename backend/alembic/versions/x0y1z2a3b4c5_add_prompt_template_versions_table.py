"""Add prompt_template_versions table and current_version to ai_prompt_templates.

Revision ID: x0y1z2a3b4c5
Revises: w9x0y1z2a3b5
Create Date: 2026-03-24 00:00:01.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "x0y1z2a3b4c5"
down_revision: Union[str, None] = "w9x0y1z2a3b5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create prompt_template_versions table and add current_version column."""
    op.create_table(
        "prompt_template_versions",
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("template_id", sa.String(), nullable=False),
        sa.Column("version_number", sa.Integer(), nullable=False),
        sa.Column("prompt_content", sa.Text(), nullable=False),
        sa.Column("parameters_json", postgresql.JSONB(), nullable=True),
        sa.Column("content_hash", sa.String(), nullable=False),
        sa.Column("change_description", sa.Text(), nullable=True),
        sa.Column("created_by", sa.String(), nullable=True),
        sa.Column("performance_metrics", postgresql.JSONB(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["template_id"],
            ["ai_prompt_templates.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("template_id", "version_number", name="uq_template_version"),
    )
    op.create_index(
        op.f("ix_prompt_template_versions_template_id"),
        "prompt_template_versions",
        ["template_id"],
        unique=False,
    )

    # Add current_version column to ai_prompt_templates
    op.add_column(
        "ai_prompt_templates",
        sa.Column("current_version", sa.Integer(), nullable=True),
    )


def downgrade() -> None:
    """Remove prompt_template_versions table and current_version column."""
    op.drop_column("ai_prompt_templates", "current_version")
    op.drop_index(
        op.f("ix_prompt_template_versions_template_id"),
        table_name="prompt_template_versions",
    )
    op.drop_table("prompt_template_versions")
