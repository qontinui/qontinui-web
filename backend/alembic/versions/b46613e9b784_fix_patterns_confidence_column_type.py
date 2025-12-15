"""fix_patterns_confidence_column_type

Revision ID: b46613e9b784
Revises: a5415e071107
Create Date: 2025-11-21 10:33:09.697163

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b46613e9b784"
down_revision: str | None = "a5415e071107"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Fix confidence column type from Integer to Float.

    Bug: The confidence field was typed as float but mapped as Integer,
    causing confidence values to be truncated (0 or 1 instead of 0.0-1.0).
    """

    # Alter column type from Integer to Float (REAL in PostgreSQL)
    # Using USING clause to convert existing integer values to float
    op.execute(
        """
        ALTER TABLE patterns
        ALTER COLUMN confidence TYPE REAL
        USING confidence::REAL;
    """
    )


def downgrade() -> None:
    """Revert confidence column type back to Integer.

    WARNING: This will truncate decimal values!
    """

    op.execute(
        """
        ALTER TABLE patterns
        ALTER COLUMN confidence TYPE INTEGER
        USING confidence::INTEGER;
    """
    )
