"""Add constraint_overrides to unified_workflows

Revision ID: t6u7v8w9x0y1
Revises: s5t6u7v8w9x0
Create Date: 2026-03-13

"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

# revision identifiers
revision = "t6u7v8w9x0y1"
down_revision = "s5t6u7v8w9x0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "unified_workflows",
        sa.Column(
            "constraint_overrides",
            JSONB(),
            nullable=True,
            comment="Per-constraint enable/disable overrides keyed by constraint ID",
        ),
    )


def downgrade() -> None:
    op.drop_column("unified_workflows", "constraint_overrides")
