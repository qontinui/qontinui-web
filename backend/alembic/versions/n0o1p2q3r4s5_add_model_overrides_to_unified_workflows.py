"""add model_overrides to unified_workflows

Revision ID: n0o1p2q3r4s5
Revises: m9n0o1p2q3r4
Create Date: 2026-03-01

"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

# revision identifiers
revision = "n0o1p2q3r4s5"
down_revision = "m9n0o1p2q3r4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "unified_workflows",
        sa.Column(
            "model_overrides",
            JSONB(),
            nullable=True,
            server_default=sa.text("'{}'::jsonb"),
            comment="Per-phase AI model overrides: {phase: {provider, model}}",
        ),
    )


def downgrade() -> None:
    op.drop_column("unified_workflows", "model_overrides")
