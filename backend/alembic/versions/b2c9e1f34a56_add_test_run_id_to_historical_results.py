"""add_test_run_id_to_historical_results

Revision ID: b2c9e1f34a56
Revises: a84bf9dcb2dc
Create Date: 2025-12-26 00:30:00.000000

Add test_run_id and sequence_number to historical_results table
for linking execution data to live test runs and enabling deterministic playback.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b2c9e1f34a56"
down_revision: Union[str, None] = "a84bf9dcb2dc"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Make snapshot_run_id nullable (to support live test runs without snapshots)
    op.alter_column(
        "historical_results",
        "snapshot_run_id",
        existing_type=sa.Integer(),
        nullable=True,
    )

    # Make snapshot_action_id nullable
    op.alter_column(
        "historical_results",
        "snapshot_action_id",
        existing_type=sa.Integer(),
        nullable=True,
    )

    # Add test_run_id column with FK to software_test_runs
    op.add_column(
        "historical_results",
        sa.Column("test_run_id", UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_historical_results_test_run_id",
        "historical_results",
        "software_test_runs",
        ["test_run_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_index(
        "ix_historical_results_test_run_id",
        "historical_results",
        ["test_run_id"],
    )

    # Add sequence_number column for deterministic playback ordering
    op.add_column(
        "historical_results",
        sa.Column(
            "sequence_number",
            sa.Integer(),
            nullable=True,
            comment="Order of recognition within the test run",
        ),
    )

    # Create composite indexes for test run queries
    op.create_index(
        "idx_historical_test_run_seq",
        "historical_results",
        ["test_run_id", "sequence_number"],
    )
    op.create_index(
        "idx_historical_test_run_pattern",
        "historical_results",
        ["test_run_id", "pattern_id"],
    )


def downgrade() -> None:
    # Drop the new indexes
    op.drop_index("idx_historical_test_run_pattern", table_name="historical_results")
    op.drop_index("idx_historical_test_run_seq", table_name="historical_results")

    # Drop sequence_number column
    op.drop_column("historical_results", "sequence_number")

    # Drop test_run_id FK, index, and column
    op.drop_index("ix_historical_results_test_run_id", table_name="historical_results")
    op.drop_constraint(
        "fk_historical_results_test_run_id",
        "historical_results",
        type_="foreignkey",
    )
    op.drop_column("historical_results", "test_run_id")

    # Make snapshot_action_id NOT NULL again
    op.alter_column(
        "historical_results",
        "snapshot_action_id",
        existing_type=sa.Integer(),
        nullable=False,
    )

    # Make snapshot_run_id NOT NULL again
    op.alter_column(
        "historical_results",
        "snapshot_run_id",
        existing_type=sa.Integer(),
        nullable=False,
    )
