"""merge heads

Revision ID: fff16598167f
Revises: abce1e18f1a1, c8d9e0f1a2b3
Create Date: 2026-02-14 21:50:19.730720

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'fff16598167f'
down_revision: Union[str, None] = ('abce1e18f1a1', 'c8d9e0f1a2b3')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
