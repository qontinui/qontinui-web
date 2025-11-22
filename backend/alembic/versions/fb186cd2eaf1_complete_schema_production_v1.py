"""complete_schema_production_v1

Revision ID: fb186cd2eaf1
Revises: c1464319e0e2
Create Date: 2025-11-18 13:06:14.461592

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'fb186cd2eaf1'
down_revision: Union[str, None] = 'c1464319e0e2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
