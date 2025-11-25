"""merge_discovered_states_and_recording_branches

Revision ID: 66a52cf9d4b1
Revises: 20251125_112445, e34e1d177ed8
Create Date: 2025-11-25 11:28:08.679411

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '66a52cf9d4b1'
down_revision: Union[str, None] = ('20251125_112445', 'e34e1d177ed8')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
