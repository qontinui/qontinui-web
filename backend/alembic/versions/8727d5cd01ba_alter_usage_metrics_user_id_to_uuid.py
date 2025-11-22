"""alter_usage_metrics_user_id_to_uuid

Revision ID: 8727d5cd01ba
Revises: 93687f70383c
Create Date: 2025-11-11 17:11:20.780113

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "8727d5cd01ba"
down_revision: Union[str, None] = "93687f70383c"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Alter usage_metrics.user_id from INTEGER to UUID
    # Note: This assumes the table is empty or has no data (which is true in production)
    op.execute(
        "ALTER TABLE usage_metrics ALTER COLUMN user_id TYPE UUID USING user_id::text::uuid"
    )


def downgrade() -> None:
    # Downgrade would convert back to INTEGER (not recommended, but for completeness)
    op.execute(
        "ALTER TABLE usage_metrics ALTER COLUMN user_id TYPE INTEGER USING EXTRACT(EPOCH FROM user_id::text::timestamp)::integer"
    )
