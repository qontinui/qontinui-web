"""add_state_machine_column_to_extraction_sessions

Revision ID: 377a08d43176
Revises: f2b3c4d5e6f7
Create Date: 2026-01-04 21:20:26.327911

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "377a08d43176"
down_revision: Union[str, None] = "f2b3c4d5e6f7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add state_machine column to extraction_sessions table.

    This column stores the pre-built state machine computed by the runner
    using qontinui's build_state_machine_from_extraction function.
    """
    op.add_column(
        "extraction_sessions", sa.Column("state_machine", sa.JSON(), nullable=True)
    )


def downgrade() -> None:
    """Remove state_machine column from extraction_sessions table."""
    op.drop_column("extraction_sessions", "state_machine")
