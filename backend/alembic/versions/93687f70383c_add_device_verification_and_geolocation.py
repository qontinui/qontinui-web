"""add_device_verification_and_geolocation

Revision ID: 93687f70383c
Revises: 8d5f2a3c1b9e
Create Date: 2025-10-24 11:20:36.530005

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "93687f70383c"
down_revision: str | None = "8d5f2a3c1b9e"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Add email verification fields
    op.add_column(
        "device_sessions",
        sa.Column(
            "email_verified", sa.Boolean(), nullable=False, server_default="false"
        ),
    )
    op.add_column(
        "device_sessions", sa.Column("verification_token", sa.Text(), nullable=True)
    )
    op.add_column(
        "device_sessions",
        sa.Column("verification_sent_at", sa.DateTime(), nullable=True),
    )

    # Add geolocation fields
    op.add_column(
        "device_sessions", sa.Column("country", sa.String(length=100), nullable=True)
    )
    op.add_column(
        "device_sessions", sa.Column("city", sa.String(length=100), nullable=True)
    )

    # Create index on verification_token for faster lookups
    op.create_index(
        op.f("ix_device_sessions_verification_token"),
        "device_sessions",
        ["verification_token"],
        unique=False,
    )


def downgrade() -> None:
    # Drop index
    op.drop_index(
        op.f("ix_device_sessions_verification_token"), table_name="device_sessions"
    )

    # Remove geolocation fields
    op.drop_column("device_sessions", "city")
    op.drop_column("device_sessions", "country")

    # Remove email verification fields
    op.drop_column("device_sessions", "verification_sent_at")
    op.drop_column("device_sessions", "verification_token")
    op.drop_column("device_sessions", "email_verified")
