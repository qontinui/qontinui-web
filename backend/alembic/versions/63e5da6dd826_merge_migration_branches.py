"""merge_migration_branches

Revision ID: 63e5da6dd826
Revises: 8727d5cd01ba, 9d66b0c555d3
Create Date: 2025-11-11 17:14:41.455128

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "63e5da6dd826"
down_revision: Union[str, None] = ("8727d5cd01ba", "9d66b0c555d3")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
