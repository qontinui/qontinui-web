"""merge_remaining_heads

Revision ID: 0a5fcb4bb6cd
Revises: 67c33a12bedb, f9593625b747, fb186cd2eaf1
Create Date: 2025-11-18 16:28:36.775206

"""

from collections.abc import Sequence

# revision identifiers, used by Alembic.
revision: str = "0a5fcb4bb6cd"
down_revision: str | None = ("67c33a12bedb", "f9593625b747", "fb186cd2eaf1")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
