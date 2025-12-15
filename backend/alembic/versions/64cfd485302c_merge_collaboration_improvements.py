"""merge_collaboration_improvements

Revision ID: 64cfd485302c
Revises: 20251120_add_version_history, 20251120_conflict_logs
Create Date: 2025-11-20 11:17:43.840187

"""

from collections.abc import Sequence

# revision identifiers, used by Alembic.
revision: str = "64cfd485302c"
down_revision: str | None = (
    "20251120_add_version_history",
    "20251120_conflict_logs",
)
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
