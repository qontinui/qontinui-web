"""merge twin config/release + pulldecision-ci heads

Revision ID: 46bbae57d232
Revises: merge_pulldecision_ci_heads, twin_03_coord_release_observations, twin_04_coord_config_observations
Create Date: 2026-05-31 11:02:16.476860

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '46bbae57d232'
down_revision: Union[str, None] = ("merge_pulldecision_ci_heads", "twin_03_coord_release_observations", "twin_04_coord_config_observations")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
