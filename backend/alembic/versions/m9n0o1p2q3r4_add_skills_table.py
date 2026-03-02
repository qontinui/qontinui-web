"""add skills table

Revision ID: m9n0o1p2q3r4
Revises: l8m9n0o1p2q3
Create Date: 2026-03-01

"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

# revision identifiers
revision = "m9n0o1p2q3r4"
down_revision = "l8m9n0o1p2q3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "skills",
        sa.Column(
            "id",
            UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            primary_key=True,
        ),
        sa.Column("created_by_user_id", UUID(as_uuid=True), nullable=True, index=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("slug", sa.String(255), nullable=False, unique=True),
        sa.Column(
            "description", sa.Text(), nullable=False, server_default=sa.text("''")
        ),
        sa.Column(
            "category",
            sa.String(100),
            nullable=False,
            server_default=sa.text("'custom'"),
            index=True,
        ),
        sa.Column(
            "tags", JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")
        ),
        sa.Column(
            "icon", sa.String(100), nullable=False, server_default=sa.text("'puzzle'")
        ),
        sa.Column(
            "color", sa.String(50), nullable=False, server_default=sa.text("'gray'")
        ),
        sa.Column(
            "allowed_phases",
            JSONB(),
            nullable=False,
            server_default=sa.text("'[\"setup\"]'::jsonb"),
        ),
        sa.Column(
            "parameters", JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")
        ),
        sa.Column("template", JSONB(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )


def downgrade() -> None:
    op.drop_table("skills")
