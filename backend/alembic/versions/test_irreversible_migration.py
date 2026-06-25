"""Test migration with irreversible downgrade.

This migration is intentionally irreversible for testing the
migration-reversal.yml CI gate. It drops a column, which cannot
be safely undone (data loss). The gate should fail on downgrade.

Revision ID: test_irreversible_001
Revises: z2a3b4c5d6e7
Create Date: 2026-06-25 06:00:00.000000

"""

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision = "test_irreversible_001"
down_revision = "z2a3b4c5d6e7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Create a new test table."""
    op.create_table(
        "test_irreversible_table",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(255), nullable=True),
        sa.Column("temp_column", sa.String(255), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    """Drop the test table - this is intentionally broken."""
    # Intentionally incorrect: try to drop a non-existent column
    # before dropping the table. This will cause the downgrade to fail.
    op.drop_column("test_irreversible_table", "nonexistent_column")

    # This never runs because the above fails:
    op.drop_table("test_irreversible_table")
