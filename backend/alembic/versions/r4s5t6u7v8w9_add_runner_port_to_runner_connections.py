"""Add runner_port to runner_connections

Revision ID: r4s5t6u7v8w9
Revises: q3r4s5t6u7v8
Create Date: 2026-03-02 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "r4s5t6u7v8w9"
down_revision: str = "q3r4s5t6u7v8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "runner_connections",
        sa.Column(
            "runner_port",
            sa.Integer(),
            nullable=True,
            comment="HTTP API port the runner is listening on",
        ),
    )


def downgrade() -> None:
    op.drop_column("runner_connections", "runner_port")
