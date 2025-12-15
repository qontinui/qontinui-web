"""enhance_audit_logs

Revision ID: 20251121_enhance_audit_logs
Revises: (find the latest head)
Create Date: 2025-11-21

Add enhanced audit logging fields for SOC 2 compliance:
- event_category: Categorize audit events (permission_change, membership_change, pii_access, account_modification)
- correlation_id: Request correlation ID for tracing related events
- target_user_id: User being affected by the action
- changes: Before/after state for modifications
- Additional indexes for efficient querying
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision = "20251121_audit_logs"
down_revision = "20251121_partitioning"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add new columns to audit_logs table
    op.add_column(
        "audit_logs",
        sa.Column(
            "event_category",
            sa.String(),
            nullable=True,
            comment="Category: permission_change, membership_change, pii_access, account_modification, etc.",
        ),
    )
    op.add_column(
        "audit_logs",
        sa.Column(
            "correlation_id",
            sa.String(),
            nullable=True,
            comment="Request correlation ID for tracing related events",
        ),
    )
    op.add_column(
        "audit_logs",
        sa.Column(
            "target_user_id",
            postgresql.UUID(as_uuid=True),
            nullable=True,
            comment="User being affected by the action (for permission/membership changes)",
        ),
    )
    op.add_column(
        "audit_logs",
        sa.Column(
            "changes",
            postgresql.JSON(astext_type=sa.Text()),
            nullable=True,
            comment="Before/after state for modifications as {before: {...}, after: {...}}",
        ),
    )

    # Add foreign key constraint for target_user_id
    op.create_foreign_key(
        "fk_audit_logs_target_user",
        "audit_logs",
        "users",
        ["target_user_id"],
        ["id"],
        ondelete="SET NULL",
    )

    # Add indexes for new fields
    op.create_index("ix_audit_logs_event_category", "audit_logs", ["event_category"])
    op.create_index("ix_audit_logs_correlation_id", "audit_logs", ["correlation_id"])
    op.create_index("ix_audit_logs_target_user_id", "audit_logs", ["target_user_id"])

    # Add indexes to existing fields that weren't indexed
    op.create_index("ix_audit_logs_action", "audit_logs", ["action"])
    op.create_index("ix_audit_logs_resource_type", "audit_logs", ["resource_type"])
    op.create_index("ix_audit_logs_resource_id", "audit_logs", ["resource_id"])

    # Add composite indexes for common query patterns
    op.create_index(
        "ix_audit_logs_user_created", "audit_logs", ["user_id", "created_at"]
    )
    op.create_index(
        "ix_audit_logs_category_created", "audit_logs", ["event_category", "created_at"]
    )
    op.create_index(
        "ix_audit_logs_resource",
        "audit_logs",
        ["resource_type", "resource_id", "created_at"],
    )
    op.create_index(
        "ix_audit_logs_target_user", "audit_logs", ["target_user_id", "created_at"]
    )


def downgrade() -> None:
    # Drop composite indexes
    op.drop_index("ix_audit_logs_target_user", table_name="audit_logs")
    op.drop_index("ix_audit_logs_resource", table_name="audit_logs")
    op.drop_index("ix_audit_logs_category_created", table_name="audit_logs")
    op.drop_index("ix_audit_logs_user_created", table_name="audit_logs")

    # Drop indexes on existing fields
    op.drop_index("ix_audit_logs_resource_id", table_name="audit_logs")
    op.drop_index("ix_audit_logs_resource_type", table_name="audit_logs")
    op.drop_index("ix_audit_logs_action", table_name="audit_logs")

    # Drop indexes on new fields
    op.drop_index("ix_audit_logs_target_user_id", table_name="audit_logs")
    op.drop_index("ix_audit_logs_correlation_id", table_name="audit_logs")
    op.drop_index("ix_audit_logs_event_category", table_name="audit_logs")

    # Drop foreign key constraint
    op.drop_constraint("fk_audit_logs_target_user", "audit_logs", type_="foreignkey")

    # Drop new columns
    op.drop_column("audit_logs", "changes")
    op.drop_column("audit_logs", "target_user_id")
    op.drop_column("audit_logs", "correlation_id")
    op.drop_column("audit_logs", "event_category")
