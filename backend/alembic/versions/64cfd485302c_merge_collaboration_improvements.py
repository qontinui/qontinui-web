"""merge_collaboration_improvements

Revision ID: 64cfd485302c
Revises: 20251120_add_version_history, 20251120_conflict_logs
Create Date: 2025-11-20 11:17:43.840187

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '64cfd485302c'
down_revision: Union[str, None] = ('20251120_add_version_history', '20251120_conflict_logs')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
