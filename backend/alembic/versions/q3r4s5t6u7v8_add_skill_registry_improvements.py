"""Add skill registry improvements columns

Revision ID: q3r4s5t6u7v8
Revises: p2q3r4s5t6u7
Create Date: 2026-03-02 00:00:00.000000

"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

# revision identifiers, used by Alembic.
revision: str = "q3r4s5t6u7v8"
down_revision: str = "p2q3r4s5t6u7"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "skills",
        sa.Column("version", sa.String(50), nullable=False, server_default="1.0.0"),
    )
    op.add_column("skills", sa.Column("author", JSONB, nullable=True))
    op.add_column("skills", sa.Column("checksum", sa.String(128), nullable=True))
    op.add_column(
        "skills",
        sa.Column(
            "depends_on", JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")
        ),
    )
    op.add_column(
        "skills",
        sa.Column("usage_count", sa.Integer, nullable=False, server_default="0"),
    )
    op.add_column("skills", sa.Column("approval_status", sa.String(50), nullable=True))
    op.add_column("skills", sa.Column("forked_from", sa.String(255), nullable=True))


def downgrade() -> None:
    op.drop_column("skills", "forked_from")
    op.drop_column("skills", "approval_status")
    op.drop_column("skills", "usage_count")
    op.drop_column("skills", "depends_on")
    op.drop_column("skills", "checksum")
    op.drop_column("skills", "author")
    op.drop_column("skills", "version")
