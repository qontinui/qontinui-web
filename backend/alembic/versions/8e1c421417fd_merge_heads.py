"""merge heads

Revision ID: 8e1c421417fd
Revises: 5c4cc3250ac8, i5j6k7l8m9n0
Create Date: 2026-02-22 09:16:35.593291

"""

from collections.abc import Sequence


# revision identifiers, used by Alembic.
revision: str = "8e1c421417fd"
down_revision: str | None = ("5c4cc3250ac8", "i5j6k7l8m9n0")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
