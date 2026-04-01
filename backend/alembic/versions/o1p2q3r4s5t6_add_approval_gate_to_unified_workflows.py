"""add approval_gate to unified_workflows

Revision ID: o1p2q3r4s5t6
Revises: n0o1p2q3r4s5
Create Date: 2026-03-01

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers
revision = "o1p2q3r4s5t6"
down_revision = "n0o1p2q3r4s5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "unified_workflows",
        sa.Column(
            "approval_gate",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
            comment="Whether to pause for human approval before agentic phase",
        ),
    )


def downgrade() -> None:
    op.drop_column("unified_workflows", "approval_gate")
