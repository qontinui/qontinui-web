"""Add known_issues table

Revision ID: s5t6u7v8w9x0
Revises: r4s5t6u7v8w9
Create Date: 2026-03-07 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "s5t6u7v8w9x0"
down_revision: str = "r4s5t6u7v8w9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "known_issues",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column(
            "organization_id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
        ),
        sa.Column(
            "created_by_user_id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
        ),
        # Issue identity
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        # Classification
        sa.Column(
            "category",
            sa.String(50),
            nullable=False,
            server_default=sa.text("'other'"),
        ),
        sa.Column(
            "severity",
            sa.String(20),
            nullable=False,
            server_default=sa.text("'medium'"),
        ),
        sa.Column(
            "status",
            sa.String(20),
            nullable=False,
            server_default=sa.text("'active'"),
        ),
        # Scope
        sa.Column(
            "scope_type",
            sa.String(50),
            nullable=False,
            server_default=sa.text("'global'"),
        ),
        sa.Column("scope_value", sa.String(500), nullable=True),
        sa.Column(
            "scope_tags",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        # Detection
        sa.Column(
            "detection_method",
            sa.String(50),
            nullable=False,
            server_default=sa.text("'ai_judgment'"),
        ),
        sa.Column(
            "detection_config",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column("pattern_template_id", sa.String(255), nullable=True),
        # Reproduction
        sa.Column("reproduction_context", sa.Text(), nullable=True),
        sa.Column(
            "trigger_conditions",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        # Confidence and provenance
        sa.Column(
            "confidence",
            sa.Float(),
            nullable=False,
            server_default=sa.text("0.5"),
        ),
        sa.Column(
            "provenance",
            sa.String(50),
            nullable=False,
            server_default=sa.text("'manual'"),
        ),
        sa.Column(
            "source_finding_ids",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column("source_task_run_id", sa.String(255), nullable=True),
        # Verification
        sa.Column("verification_hint", sa.Text(), nullable=True),
        sa.Column("verification_step_template", postgresql.JSONB(), nullable=True),
        # Occurrence tracking
        sa.Column(
            "times_detected",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("1"),
        ),
        sa.Column(
            "times_checked",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
        sa.Column("last_detected_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_checked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        # Timestamps
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        # Constraints
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["organizations.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["created_by_user_id"],
            ["users.id"],
            ondelete="CASCADE",
        ),
    )

    # Indexes for common query patterns
    op.create_index(
        "ix_known_issues_organization_id",
        "known_issues",
        ["organization_id"],
    )
    op.create_index(
        "ix_known_issues_created_by_user_id",
        "known_issues",
        ["created_by_user_id"],
    )
    op.create_index(
        "ix_known_issues_status",
        "known_issues",
        ["status"],
    )
    op.create_index(
        "ix_known_issues_severity",
        "known_issues",
        ["severity"],
    )
    op.create_index(
        "ix_known_issues_category",
        "known_issues",
        ["category"],
    )


def downgrade() -> None:
    op.drop_index("ix_known_issues_category", table_name="known_issues")
    op.drop_index("ix_known_issues_severity", table_name="known_issues")
    op.drop_index("ix_known_issues_status", table_name="known_issues")
    op.drop_index("ix_known_issues_created_by_user_id", table_name="known_issues")
    op.drop_index("ix_known_issues_organization_id", table_name="known_issues")
    op.drop_table("known_issues")
