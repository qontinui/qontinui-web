"""add_admin_notification_settings_table

Revision ID: 2276b3bf54c8
Revises: fc564db1f8a2
Create Date: 2025-12-05 04:58:22.219494

"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "2276b3bf54c8"
down_revision: Union[str, None] = "fc564db1f8a2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "admin_notification_settings",
        sa.Column(
            "id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False
        ),
        sa.Column(
            "notification_email",
            sa.String(),
            nullable=False,
            comment="Email address to send admin notifications to",
        ),
        sa.Column(
            "notify_on_user_signup",
            sa.Boolean(),
            nullable=False,
            comment="Send notification when a new user signs up",
        ),
        sa.Column(
            "notify_on_project_created",
            sa.Boolean(),
            nullable=False,
            comment="Send notification when a new project is created",
        ),
        sa.Column(
            "notifications_enabled",
            sa.Boolean(),
            nullable=False,
            comment="Master toggle for all admin notifications",
        ),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    op.drop_table("admin_notification_settings")
