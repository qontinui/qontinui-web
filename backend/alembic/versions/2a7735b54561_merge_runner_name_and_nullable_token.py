"""merge_runner_name_and_nullable_token

Revision ID: 2a7735b54561
Revises: 20251127_nullable_token, f6a3533afdd8
Create Date: 2025-11-28 09:52:59.642235

"""

from collections.abc import Sequence

# revision identifiers, used by Alembic.
revision: str = "2a7735b54561"
down_revision: str | None = ("20251127_nullable_token", "f6a3533afdd8")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
