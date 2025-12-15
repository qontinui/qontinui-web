"""add_unique_constraints_data_integrity.

Revision ID: a5415e071107
Revises: 1ffcb7ff3d3d
Create Date: 2025-11-21 10:31:53.368265

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a5415e071107"
down_revision: str | None = "1ffcb7ff3d3d"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add UNIQUE constraints to prevent data duplication and corruption."""
    # Check which tables exist
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    existing_tables = inspector.get_table_names()

    # CRITICAL: Prevent log sequence corruption
    # Ensures logs within a session are properly ordered
    if "automation_logs" in existing_tables:
        op.create_unique_constraint(
            "uq_automation_logs_session_sequence",
            "automation_logs",
            ["session_id", "sequence_number"],
        )
        print("✓ Added unique constraint to automation_logs")
    else:
        print("⚠️  automation_logs table does not exist, skipping constraint")

    # CRITICAL: Prevent duplicate locks on same resource
    # Note: Application should clean up expired locks before creating new ones
    # Cannot use NOW() in index predicate as it's not immutable
    if "project_locks" in existing_tables:
        op.create_unique_constraint(
            "uq_project_locks_resource",
            "project_locks",
            ["project_id", "resource_type", "resource_id"],
        )
        print("✓ Added unique constraint to project_locks")
    else:
        print("⚠️  project_locks table does not exist, skipping constraint")

    # HIGH: Prevent duplicate device tracking
    # One device fingerprint per user
    if "device_sessions" in existing_tables:
        op.create_unique_constraint(
            "uq_device_sessions_user_device",
            "device_sessions",
            ["user_id", "device_fingerprint"],
        )
        print("✓ Added unique constraint to device_sessions")
    else:
        print("⚠️  device_sessions table does not exist, skipping constraint")

    # HIGH: Prevent multiple users with same Stripe customer
    # Partial unique index (only when stripe_customer_id is not null)
    if "subscriptions" in existing_tables:
        op.execute(
            """
        CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_stripe_customer
        ON subscriptions(stripe_customer_id)
        WHERE stripe_customer_id IS NOT NULL;
    """
        )
        print("✓ Added unique index to subscriptions")
    else:
        print("⚠️  subscriptions table does not exist, skipping index")

    # HIGH: Prevent duplicate access grants
    # One permission level per user per project
    if "project_access_control" in existing_tables:
        op.execute(
            """
        CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_project_user_access
        ON project_access_control(project_id, user_id)
        WHERE user_id IS NOT NULL;
    """
        )
        print("✓ Added unique index to project_access_control")
    else:
        print("⚠️  project_access_control table does not exist, skipping index")


def downgrade() -> None:
    """Remove UNIQUE constraints."""
    # Remove partial indexes (SQL-based)
    op.execute("DROP INDEX IF EXISTS idx_unique_project_user_access;")
    op.execute("DROP INDEX IF EXISTS idx_unique_stripe_customer;")

    # Remove named unique constraints
    op.drop_constraint(
        "uq_device_sessions_user_device", "device_sessions", type_="unique"
    )
    op.drop_constraint("uq_project_locks_resource", "project_locks", type_="unique")
    op.drop_constraint(
        "uq_automation_logs_session_sequence", "automation_logs", type_="unique"
    )
