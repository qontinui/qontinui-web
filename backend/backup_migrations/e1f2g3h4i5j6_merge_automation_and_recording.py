"""merge_automation_and_recording

Revision ID: e1f2g3h4i5j6
Revises: a1b2c3d4e5f6, 4e5f6a7b8c9d
Create Date: 2025-11-16 23:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e1f2g3h4i5j6'
down_revision: Union[str, None] = ('a1b2c3d4e5f6', '4e5f6a7b8c9d')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
