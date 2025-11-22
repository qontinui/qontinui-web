"""add_unique_constraints_data_integrity

Revision ID: a5415e071107
Revises: 1ffcb7ff3d3d
Create Date: 2025-11-21 10:31:53.368265

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a5415e071107'
down_revision: Union[str, None] = '1ffcb7ff3d3d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add UNIQUE constraints to prevent data duplication and corruption."""

    # CRITICAL: Prevent log sequence corruption
    # Ensures logs within a session are properly ordered
    op.create_unique_constraint(
        "uq_automation_logs_session_sequence",
        "automation_logs",
        ["session_id", "sequence_number"]
    )

    # CRITICAL: Prevent duplicate locks on same resource
    # Note: Application should clean up expired locks before creating new ones
    # Cannot use NOW() in index predicate as it's not immutable
    op.create_unique_constraint(
        "uq_project_locks_resource",
        "project_locks",
        ["project_id", "resource_type", "resource_id"]
    )

    # HIGH: Prevent duplicate device tracking
    # One device fingerprint per user
    op.create_unique_constraint(
        "uq_device_sessions_user_device",
        "device_sessions",
        ["user_id", "device_fingerprint"]
    )

    # HIGH: Prevent multiple users with same Stripe customer
    # Partial unique index (only when stripe_customer_id is not null)
    op.execute("""
        CREATE UNIQUE INDEX idx_unique_stripe_customer
        ON subscriptions(stripe_customer_id)
        WHERE stripe_customer_id IS NOT NULL;
    """)

    # HIGH: Prevent duplicate access grants
    # One permission level per user per project
    op.execute("""
        CREATE UNIQUE INDEX idx_unique_project_user_access
        ON project_access_control(project_id, user_id)
        WHERE user_id IS NOT NULL;
    """)


def downgrade() -> None:
    """Remove UNIQUE constraints."""

    # Remove partial indexes (SQL-based)
    op.execute("DROP INDEX IF EXISTS idx_unique_project_user_access;")
    op.execute("DROP INDEX IF EXISTS idx_unique_stripe_customer;")

    # Remove named unique constraints
    op.drop_constraint("uq_device_sessions_user_device", "device_sessions", type_="unique")
    op.drop_constraint("uq_project_locks_resource", "project_locks", type_="unique")
    op.drop_constraint("uq_automation_logs_session_sequence", "automation_logs", type_="unique")
