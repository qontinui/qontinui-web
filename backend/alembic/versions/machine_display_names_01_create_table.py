"""add auth.machine_display_names table

Per-user friendly display names for fleet machines (keyed by hostname).
Composite primary key ``(user_id, hostname)`` — one display name per user
per hostname. Persisted so names survive a refresh and sync across the
user's devices.

Revision ID: machine_display_names_01
Revises: coord_session_messages
Create Date: 2026-06-19 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "machine_display_names_01"
down_revision: str | None = "coord_workunits_02_gate_anchor"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "machine_display_names",
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("hostname", sa.String(length=255), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
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
        sa.ForeignKeyConstraint(["user_id"], ["auth.users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id", "hostname"),
        schema="auth",
    )


def downgrade() -> None:
    op.drop_table("machine_display_names", schema="auth")
