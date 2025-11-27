"""merge_migrations

Revision ID: d703626068d7
Revises: 4e5f6a7b8c9d, b1c2d3e4f5g6
Create Date: 2025-11-16 19:35:14.422957

"""

from collections.abc import Sequence

# revision identifiers, used by Alembic.
revision: str = "d703626068d7"
down_revision: str | None = ("4e5f6a7b8c9d", "b1c2d3e4f5g6")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
