"""add unified_workflows table

Revision ID: b97e3bd6e0c7
Revises: b5c6d7e8f9a0
Create Date: 2026-02-11 21:24:47.345926

"""

from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b97e3bd6e0c7"
down_revision: Union[str, None] = "b5c6d7e8f9a0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "unified_workflows",
        sa.Column(
            "id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False
        ),
        sa.Column("created_by_user_id", sa.UUID(), nullable=True),
        sa.Column("project_id", sa.UUID(), nullable=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column(
            "description", sa.Text(), server_default=sa.text("''"), nullable=False
        ),
        sa.Column(
            "category",
            sa.String(length=100),
            server_default=sa.text("'general'"),
            nullable=False,
        ),
        sa.Column(
            "tags",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
        sa.Column(
            "setup_steps",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
        sa.Column(
            "verification_steps",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
        sa.Column(
            "agentic_steps",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
        sa.Column(
            "completion_steps",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
        sa.Column(
            "max_iterations", sa.Integer(), server_default=sa.text("10"), nullable=False
        ),
        sa.Column("timeout_seconds", sa.Integer(), nullable=True),
        sa.Column("provider", sa.String(length=100), nullable=True),
        sa.Column("model", sa.String(length=100), nullable=True),
        sa.Column(
            "skip_ai_summary",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
        sa.Column(
            "log_watch_enabled",
            sa.Boolean(),
            server_default=sa.text("true"),
            nullable=False,
        ),
        sa.Column(
            "health_check_enabled",
            sa.Boolean(),
            server_default=sa.text("true"),
            nullable=False,
        ),
        sa.Column(
            "health_check_urls",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
        sa.Column(
            "preflight_check_enabled",
            sa.Boolean(),
            server_default=sa.text("true"),
            nullable=False,
        ),
        sa.Column(
            "log_source_selection",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'\"default\"'::jsonb"),
            nullable=False,
        ),
        sa.Column(
            "context_ids",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
        sa.Column(
            "disabled_context_ids",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
        sa.Column(
            "auto_include_contexts",
            sa.Boolean(),
            server_default=sa.text("true"),
            nullable=False,
        ),
        sa.Column("prompt_template", sa.Text(), nullable=True),
        sa.Column(
            "generated_by_task_run_id",
            sa.String(length=255),
            nullable=True,
            comment="Task run ID that generated this workflow (e.g. error-fix generator)",
        ),
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
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_unified_workflows_category"),
        "unified_workflows",
        ["category"],
        unique=False,
    )
    op.create_index(
        op.f("ix_unified_workflows_created_by_user_id"),
        "unified_workflows",
        ["created_by_user_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_unified_workflows_project_id"),
        "unified_workflows",
        ["project_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_unified_workflows_project_id"), table_name="unified_workflows"
    )
    op.drop_index(
        op.f("ix_unified_workflows_created_by_user_id"), table_name="unified_workflows"
    )
    op.drop_index(op.f("ix_unified_workflows_category"), table_name="unified_workflows")
    op.drop_table("unified_workflows")
