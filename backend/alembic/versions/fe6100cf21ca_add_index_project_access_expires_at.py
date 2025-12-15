"""add_index_project_access_expires_at

Revision ID: fe6100cf21ca
Revises: 20251121_audit_logs
Create Date: 2025-11-22 02:43:37.201175

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "fe6100cf21ca"
down_revision: str | None = "20251121_audit_logs"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Add index on project_access_control.expires_at for performance
    # when filtering by expiration date in permission queries
    op.create_index(
        "idx_project_access_expires_at",
        "project_access_control",
        ["expires_at"],
        unique=False,
    )


def downgrade() -> None:
    # Remove index
    op.drop_index("idx_project_access_expires_at", table_name="project_access_control")
