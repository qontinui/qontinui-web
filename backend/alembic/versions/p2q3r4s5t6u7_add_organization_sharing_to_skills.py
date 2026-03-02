"""add organization sharing to skills

Revision ID: p2q3r4s5t6u7
Revises: o1p2q3r4s5t6
Create Date: 2026-03-01

"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

# revision identifiers
revision = "p2q3r4s5t6u7"
down_revision = "o1p2q3r4s5t6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "skills",
        sa.Column(
            "organization_id",
            UUID(as_uuid=True),
            nullable=True,
        ),
    )
    op.add_column(
        "skills",
        sa.Column(
            "is_shared",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    op.create_index("ix_skills_organization_id", "skills", ["organization_id"])
    op.create_foreign_key(
        "fk_skills_organization_id",
        "skills",
        "organizations",
        ["organization_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_skills_organization_id", "skills", type_="foreignkey")
    op.drop_index("ix_skills_organization_id", table_name="skills")
    op.drop_column("skills", "is_shared")
    op.drop_column("skills", "organization_id")
