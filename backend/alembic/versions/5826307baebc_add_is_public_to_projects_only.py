"""add_is_public_to_projects_only

Revision ID: 5826307baebc
Revises: 20251123_add_code_package_models
Create Date: 2025-11-23 07:01:22.474004

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "5826307baebc"
down_revision: str | None = "20251123_add_code_package_models"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "projects",
        sa.Column("is_public", sa.Boolean(), nullable=False, server_default="false"),
    )
    op.create_index(
        op.f("ix_projects_is_public"), "projects", ["is_public"], unique=False
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_projects_is_public"), table_name="projects")
    op.drop_column("projects", "is_public")
