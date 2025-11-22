"""add_performance_indexes

Revision ID: add_performance_indexes
Revises: <previous_revision>
Create Date: 2025-11-22

Add missing database indexes for performance optimization:
- Projects: user_id + created_at
- Workflows: project_id + status + created_at
- Screenshots: project_id + created_at
- Automation sessions: project_id + status (partial index for active sessions)
- Full-text search on project names
"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "4a8b9c6d5e7f"
down_revision = "fe6100cf21ca"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Add performance indexes"""

    # Index 1: Projects by owner and creation date
    # Speeds up: "SELECT * FROM projects WHERE owner_id = ? ORDER BY created_at DESC"
    op.create_index(
        "idx_projects_owner_created", "projects", ["owner_id", "created_at"], unique=False
    )

    # Index 2: Workflows by project, status, and creation date
    # Speeds up: "SELECT * FROM workflows WHERE project_id = ? AND status = ? ORDER BY created_at"
    op.create_index(
        "idx_workflows_project_status_created",
        "workflows",
        ["project_id", "status", "created_at"],
        unique=False,
    )

    # Index 3: Screenshots by project and creation date
    # Speeds up: "SELECT * FROM screenshots WHERE project_id = ? ORDER BY created_at DESC LIMIT 10"
    op.create_index(
        "idx_screenshots_project_created",
        "screenshots",
        ["project_id", "created_at"],
        unique=False,
    )

    # Index 4: Automation screenshots by session
    # Speeds up: "SELECT * FROM automation_screenshots WHERE session_id = ? ORDER BY captured_at"
    op.create_index(
        "idx_automation_screenshots_session",
        "automation_screenshots",
        ["session_id", "captured_at"],
        unique=False,
    )

    # Index 5: Partial index for active automation sessions (PostgreSQL specific)
    # Speeds up: "SELECT * FROM automation_sessions WHERE status IN ('running', 'paused')"
    # Only indexes rows where status is 'running' or 'paused' (much smaller index)
    op.execute(
        """
        CREATE INDEX idx_automation_sessions_active
        ON automation_sessions (project_id, status, updated_at)
        WHERE status IN ('running', 'paused')
    """
    )

    # Index 6: GIN index for full-text search on project names (PostgreSQL specific)
    # Speeds up: "SELECT * FROM projects WHERE to_tsvector('english', name) @@ to_tsquery('search query')"
    op.execute(
        """
        CREATE INDEX idx_projects_name_fulltext
        ON projects USING gin(to_tsvector('english', name))
    """
    )

    # Index 7: Annotations by screenshot
    # Speeds up: "SELECT * FROM annotations WHERE screenshot_id = ?"
    op.create_index(
        "idx_annotations_screenshot", "annotations", ["screenshot_id"], unique=False
    )

    # Index 8: Project members by user (for listing user's accessible projects)
    # Speeds up: "SELECT * FROM project_members WHERE user_id = ?"
    op.create_index(
        "idx_project_members_user", "project_members", ["user_id", "role"], unique=False
    )

    # Index 9: Composite index for workflow executions
    # Speeds up: "SELECT * FROM workflow_executions WHERE project_id = ? AND status = ?"
    op.create_index(
        "idx_workflow_executions_project_status",
        "workflow_executions",
        ["project_id", "status", "started_at"],
        unique=False,
    )

    # Index 10: Storage usage by user (for quota checks)
    # Speeds up: "SELECT SUM(file_size) FROM storage_usage WHERE user_id = ?"
    op.create_index(
        "idx_storage_usage_user",
        "storage_usage",
        ["user_id", "file_size"],
        unique=False,
    )


def downgrade() -> None:
    """Remove performance indexes"""

    # Drop indexes in reverse order
    op.drop_index("idx_storage_usage_user", table_name="storage_usage")
    op.drop_index(
        "idx_workflow_executions_project_status", table_name="workflow_executions"
    )
    op.drop_index("idx_project_members_user", table_name="project_members")
    op.drop_index("idx_annotations_screenshot", table_name="annotations")
    op.execute("DROP INDEX IF EXISTS idx_projects_name_fulltext")
    op.execute("DROP INDEX IF EXISTS idx_automation_sessions_active")
    op.drop_index(
        "idx_automation_screenshots_session", table_name="automation_screenshots"
    )
    op.drop_index("idx_screenshots_project_created", table_name="screenshots")
    op.drop_index("idx_workflows_project_status_created", table_name="workflows")
    op.drop_index("idx_projects_user_created", table_name="projects")
