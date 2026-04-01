"""add sweep fields to unified workflows

Revision ID: 5c4cc3250ac8
Revises: h4i5j6k7l8m9
Create Date: 2026-02-16 18:07:42.254813

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "5c4cc3250ac8"
down_revision: Union[str, None] = "h4i5j6k7l8m9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "unified_workflows",
        sa.Column(
            "enable_sweep",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
    )
    op.add_column(
        "unified_workflows",
        sa.Column(
            "max_sweep_iterations",
            sa.Integer(),
            server_default=sa.text("5"),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_column("unified_workflows", "max_sweep_iterations")
    op.drop_column("unified_workflows", "enable_sweep")
