"""add_runner_devices_table

Revision ID: fc564db1f8a2
Revises: 2a7735b54561
Create Date: 2025-12-02 23:29:26.188859

"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "fc564db1f8a2"
down_revision: Union[str, None] = "2a7735b54561"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create runner_devices table
    op.create_table(
        "runner_devices",
        sa.Column(
            "id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False
        ),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("device_id", sa.String(length=255), nullable=False),
        sa.Column("device_name", sa.String(length=255), nullable=False),
        sa.Column("platform", sa.String(length=50), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False
        ),
        sa.Column(
            "is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )

    # Create indexes
    op.create_index(
        op.f("ix_runner_devices_device_id"),
        "runner_devices",
        ["device_id"],
        unique=True,
    )
    op.create_index(
        op.f("ix_runner_devices_id"), "runner_devices", ["id"], unique=False
    )
    op.create_index(
        op.f("ix_runner_devices_is_active"),
        "runner_devices",
        ["is_active"],
        unique=False,
    )
    op.create_index(
        op.f("ix_runner_devices_user_id"), "runner_devices", ["user_id"], unique=False
    )


def downgrade() -> None:
    # Drop indexes
    op.drop_index(op.f("ix_runner_devices_user_id"), table_name="runner_devices")
    op.drop_index(op.f("ix_runner_devices_is_active"), table_name="runner_devices")
    op.drop_index(op.f("ix_runner_devices_id"), table_name="runner_devices")
    op.drop_index(op.f("ix_runner_devices_device_id"), table_name="runner_devices")

    # Drop table
    op.drop_table("runner_devices")
