"""merge phase 3D scheduled_workflow_runs with phase 3J.5 runner ui_error

Revision ID: c1a6f50ead4e
Revises: a3b4c5d6e7f8, b3e5d8a1c2f4
Create Date: 2026-04-22 06:16:14.117632

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c1a6f50ead4e'
down_revision: Union[str, None] = ('a3b4c5d6e7f8', 'b3e5d8a1c2f4')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
