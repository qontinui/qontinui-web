"""merge client-telemetry + auth-observations alembic heads

Revision ID: merge_clienttel_auth_heads
Revises: twin_auth_01_coord_auth_observations, twin_clienttel_01_coord_client_telemetry_observations
Create Date: 2026-06-03 05:40:37.093803

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'merge_clienttel_auth_heads'
down_revision: Union[str, None] = ('twin_auth_01_coord_auth_observations', 'twin_clienttel_01_coord_client_telemetry_observations')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
