"""merge client-telemetry + routing-drift alembic heads (cross-PR fork #398/#399)

Revision ID: merge_clienttel_routing_heads
Revises: merge_clienttel_auth_heads, twin_05_coord_routing_drift_observations
Create Date: 2026-06-03 06:14:07.253593

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'merge_clienttel_routing_heads'
down_revision: Union[str, None] = ('merge_clienttel_auth_heads', 'twin_05_coord_routing_drift_observations')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
