"""merge_heads_before_state_discovery

Revision ID: d3e802f6be1b
Revises: 67c33a12bedb, f9593625b747
Create Date: 2025-11-16 22:56:16.489601

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd3e802f6be1b'
down_revision: Union[str, None] = ('67c33a12bedb', 'f9593625b747')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
