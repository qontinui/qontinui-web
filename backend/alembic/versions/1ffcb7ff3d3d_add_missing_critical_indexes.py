"""add_missing_critical_indexes

Revision ID: 1ffcb7ff3d3d
Revises: b82857923798
Create Date: 2025-11-21 10:31:18.066716

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "1ffcb7ff3d3d"
down_revision: str | None = "b82857923798"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add critical missing indexes to prevent full table scans at scale."""

    # Phase 1: Critical foreign key indexes
    # These indexes are critical for "get all X for user Y" queries
    op.create_index("ix_projects_owner_id", "projects", ["owner_id"])
    op.create_index("ix_organizations_owner_id", "organizations", ["owner_id"])
    op.create_index("ix_usage_metrics_user_id", "usage_metrics", ["user_id"])
    op.create_index("ix_storage_usage_project_id", "storage_usage", ["project_id"])

    # Phase 2: Composite indexes for dashboard queries
    # These optimize common filtered and sorted queries
    op.create_index(
        "ix_automation_sessions_user_status_date",
        "automation_sessions",
        ["user_id", "status", sa.text("created_at DESC")],
    )
    op.create_index(
        "ix_notifications_user_read_date",
        "notifications",
        ["user_id", "read", sa.text("created_at DESC")],
    )


def downgrade() -> None:
    """Remove added indexes."""

    # Remove composite indexes first
    op.drop_index("ix_notifications_user_read_date", "notifications")
    op.drop_index("ix_automation_sessions_user_status_date", "automation_sessions")

    # Remove foreign key indexes
    op.drop_index("ix_storage_usage_project_id", "storage_usage")
    op.drop_index("ix_usage_metrics_user_id", "usage_metrics")
    op.drop_index("ix_organizations_owner_id", "organizations")
    op.drop_index("ix_projects_owner_id", "projects")
