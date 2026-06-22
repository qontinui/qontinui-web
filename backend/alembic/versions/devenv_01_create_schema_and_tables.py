"""create devenv schema and digital-twin tables

Revision ID: devenv_01
Revises: d7e8f9a0b1c2
Create Date: 2026-06-22

Creates the ``devenv`` schema and its four user-scoped tables for the
Environments digital-twin feature:

* ``devenv.applications``
* ``devenv.machines``
* ``devenv.environments``
* ``devenv.machine_environment_configs``

Tables are created in FK dependency order (applications -> machines ->
environments -> machine_environment_configs) and dropped in reverse.
"""

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

from alembic import op

# revision identifiers
revision = "devenv_01"
down_revision = "d7e8f9a0b1c2"
branch_labels = None
depends_on = None

_SCHEMA = "devenv"


def upgrade() -> None:
    op.execute("CREATE SCHEMA IF NOT EXISTS devenv")

    # ---- applications -----------------------------------------------------
    op.create_table(
        "applications",
        sa.Column(
            "id",
            UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            primary_key=True,
        ),
        sa.Column(
            "owner_user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("auth.users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("slug", sa.String(200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
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
        sa.UniqueConstraint(
            "owner_user_id", "slug", name="uq_devenv_app_owner_slug"
        ),
        schema=_SCHEMA,
    )
    op.create_index(
        "idx_devenv_app_owner",
        "applications",
        ["owner_user_id"],
        schema=_SCHEMA,
    )

    # ---- machines ---------------------------------------------------------
    op.create_table(
        "machines",
        sa.Column(
            "id",
            UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            primary_key=True,
        ),
        sa.Column(
            "owner_user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("auth.users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("hostname", sa.String(255), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("enrollment_code", sa.String(16), nullable=True),
        sa.Column("enrollment_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("key_hash", sa.String(64), nullable=True),
        sa.Column("key_prefix", sa.String(16), nullable=True),
        sa.Column("enrolled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
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
        sa.UniqueConstraint(
            "owner_user_id", "name", name="uq_devenv_machine_owner_name"
        ),
        schema=_SCHEMA,
    )
    op.create_index(
        "idx_devenv_machine_owner",
        "machines",
        ["owner_user_id"],
        schema=_SCHEMA,
    )
    op.create_index(
        "idx_devenv_machine_key_hash",
        "machines",
        ["key_hash"],
        schema=_SCHEMA,
    )
    op.create_index(
        "idx_devenv_machine_enrollment_code",
        "machines",
        ["enrollment_code"],
        schema=_SCHEMA,
    )

    # ---- environments -----------------------------------------------------
    op.create_table(
        "environments",
        sa.Column(
            "id",
            UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            primary_key=True,
        ),
        sa.Column(
            "owner_user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("auth.users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "application_id",
            UUID(as_uuid=True),
            sa.ForeignKey("devenv.applications.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column(
            "canonical_machine_id",
            UUID(as_uuid=True),
            sa.ForeignKey("devenv.machines.id", ondelete="SET NULL"),
            nullable=True,
        ),
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
        sa.UniqueConstraint(
            "owner_user_id", "name", name="uq_devenv_env_owner_name"
        ),
        schema=_SCHEMA,
    )
    op.create_index(
        "idx_devenv_env_owner",
        "environments",
        ["owner_user_id"],
        schema=_SCHEMA,
    )
    op.create_index(
        "idx_devenv_env_application",
        "environments",
        ["application_id"],
        schema=_SCHEMA,
    )

    # ---- machine_environment_configs --------------------------------------
    op.create_table(
        "machine_environment_configs",
        sa.Column(
            "id",
            UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            primary_key=True,
        ),
        sa.Column(
            "owner_user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("auth.users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "environment_id",
            UUID(as_uuid=True),
            sa.ForeignKey("devenv.environments.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "machine_id",
            UUID(as_uuid=True),
            sa.ForeignKey("devenv.machines.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("config", JSONB(), nullable=False),
        sa.Column("schema_version", sa.Integer(), nullable=False),
        sa.Column("source", sa.String(50), nullable=False),
        sa.Column("captured_at", sa.DateTime(timezone=True), nullable=False),
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
        sa.UniqueConstraint(
            "environment_id", "machine_id", name="uq_devenv_config_env_machine"
        ),
        schema=_SCHEMA,
    )
    op.create_index(
        "idx_devenv_config_environment",
        "machine_environment_configs",
        ["environment_id"],
        schema=_SCHEMA,
    )
    op.create_index(
        "idx_devenv_config_machine",
        "machine_environment_configs",
        ["machine_id"],
        schema=_SCHEMA,
    )


def downgrade() -> None:
    op.drop_index(
        "idx_devenv_config_machine",
        table_name="machine_environment_configs",
        schema=_SCHEMA,
    )
    op.drop_index(
        "idx_devenv_config_environment",
        table_name="machine_environment_configs",
        schema=_SCHEMA,
    )
    op.drop_table("machine_environment_configs", schema=_SCHEMA)

    op.drop_index(
        "idx_devenv_env_application", table_name="environments", schema=_SCHEMA
    )
    op.drop_index("idx_devenv_env_owner", table_name="environments", schema=_SCHEMA)
    op.drop_table("environments", schema=_SCHEMA)

    op.drop_index(
        "idx_devenv_machine_enrollment_code", table_name="machines", schema=_SCHEMA
    )
    op.drop_index(
        "idx_devenv_machine_key_hash", table_name="machines", schema=_SCHEMA
    )
    op.drop_index("idx_devenv_machine_owner", table_name="machines", schema=_SCHEMA)
    op.drop_table("machines", schema=_SCHEMA)

    op.drop_index("idx_devenv_app_owner", table_name="applications", schema=_SCHEMA)
    op.drop_table("applications", schema=_SCHEMA)

    op.execute("DROP SCHEMA IF EXISTS devenv")
