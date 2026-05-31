"""merge twin sibling heads (dependency/release/config/pulldecision)

Revision ID: d7ad1c29f921
Revises: merge_pulldecision_ci_heads, twin_03_coord_release_observations, twin_04_coord_config_observations, twin_04_coord_dependency_resolution_observations
Create Date: 2026-05-31 11:09:46.019833

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd7ad1c29f921'
down_revision: Union[str, None] = ('merge_pulldecision_ci_heads', 'twin_03_coord_release_observations', 'twin_04_coord_config_observations', 'twin_04_coord_dependency_resolution_observations')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
