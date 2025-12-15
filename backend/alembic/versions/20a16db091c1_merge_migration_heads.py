"""Merge migration heads

Revision ID: 20a16db091c1
Revises: 9d66b0c555d3, d42d46b1738d
Create Date: 2025-11-13 13:42:15.926006

"""

from collections.abc import Sequence

# revision identifiers, used by Alembic.
revision: str = "20a16db091c1"
down_revision: str | None = ("9d66b0c555d3", "d42d46b1738d")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
