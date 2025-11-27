"""Make runner_token_id nullable to support JWT auth connections

Revision ID: 20251127_nullable_token
Revises: 20251126_collab
Create Date: 2025-11-27

This migration makes runner_connections.runner_token_id nullable to allow
tracking WebSocket connections that authenticate via JWT (not just runner tokens).
"""

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision = "20251127_nullable_token"
down_revision = "20251126_collab"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Make runner_token_id nullable."""
    op.alter_column(
        "runner_connections",
        "runner_token_id",
        existing_type=sa.UUID(),
        nullable=True,
    )


def downgrade() -> None:
    """Make runner_token_id NOT NULL again.

    Note: This will fail if there are any rows with NULL runner_token_id.
    Those rows would need to be deleted first.
    """
    # First, delete any connections with NULL runner_token_id
    op.execute("DELETE FROM runner_connections WHERE runner_token_id IS NULL")

    op.alter_column(
        "runner_connections",
        "runner_token_id",
        existing_type=sa.UUID(),
        nullable=False,
    )
