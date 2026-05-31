"""merge all twin alembic heads (dependency/release/config/ci/pulldecision)

Revision ID: c5d0dbe907b5
Revises: 46bbae57d232, d7ad1c29f921, twin_merge_05_release_config_ci_heads
Create Date: 2026-05-31 11:22:51.805202

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c5d0dbe907b5'
down_revision: Union[str, None] = ('46bbae57d232', 'd7ad1c29f921', 'twin_merge_05_release_config_ci_heads')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
