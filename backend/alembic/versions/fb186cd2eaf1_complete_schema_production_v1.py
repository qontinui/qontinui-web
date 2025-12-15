"""complete_schema_production_v1

Revision ID: fb186cd2eaf1
Revises: c1464319e0e2
Create Date: 2025-11-18 13:06:14.461592

"""

from collections.abc import Sequence

# revision identifiers, used by Alembic.
revision: str = "fb186cd2eaf1"
down_revision: str | None = "c1464319e0e2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
