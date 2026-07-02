"""devenv_04: device machine credentials (dmk_) for cold-start recovery

Revision ID: devenv_04_device_machine_credentials
Revises: devenv_03_coord_device_bridge
Create Date: 2026-07-02

Phase 1 of plan ``2026-07-02-runner-device-machine-key-cold-start.md`` (4b).

Creates ``devenv.device_machine_credentials`` — a long-lived, device-bound
machine key (``dmk_<token>``) the runner can exchange for a device JWT with
no user session, closing the >30-day-offline cold-start gap. Web-owned and
mirrors the ``devenv.machines`` ``mk_`` credential idiom: only the sha256
**hash** + a short **prefix** are stored; the plaintext is returned ONCE.

``device_id`` is a **soft, cross-schema reference** to
``coord.devices.device_id`` — deliberately NOT a FK. coord and devenv are
independently-written surfaces in the same DB (a coord device may be
reaped/re-enrolled without devenv knowing), and a cross-schema FK would
also choke ``coord-db-tests`` CI (which runs against an isolated devenv DB
with no coord schema). Device existence is validated in application code,
not by a DB constraint.

Forward-only + additive (a brand-new table). Safe for a running app on the
prior schema.

``down_revision`` = the current local alembic head
(``devenv_03_coord_device_bridge``, single head on origin/main at
authoring time). coord re-points at land time and ``alembic-graph-pr`` CI
guards forks.
"""

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

from alembic import op

# revision identifiers
revision = "devenv_04_device_machine_credentials"
down_revision = "devenv_03_coord_device_bridge"
branch_labels = None
depends_on = None

_SCHEMA = "devenv"


def upgrade() -> None:
    op.create_table(
        "device_machine_credentials",
        sa.Column(
            "id",
            UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            primary_key=True,
        ),
        # Soft, cross-schema reference to coord.devices.device_id.
        # NOT a FK (see module docstring) — validated in code.
        sa.Column("device_id", UUID(as_uuid=True), nullable=False),
        sa.Column(
            "owner_user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("auth.users.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("dmk_hash", sa.String(64), nullable=False),
        sa.Column("dmk_prefix", sa.String(16), nullable=False),
        sa.Column("tenant_id", UUID(as_uuid=True), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        # One active dmk_ per device — re-mint UPSERTs on this key.
        sa.UniqueConstraint(
            "device_id", name="uq_devenv_dmk_device_id"
        ),
        schema=_SCHEMA,
    )
    op.create_index(
        "idx_devenv_dmk_hash",
        "device_machine_credentials",
        ["dmk_hash"],
        schema=_SCHEMA,
    )
    op.create_index(
        "idx_devenv_dmk_owner_device",
        "device_machine_credentials",
        ["owner_user_id", "device_id"],
        schema=_SCHEMA,
    )


def downgrade() -> None:
    op.drop_index(
        "idx_devenv_dmk_owner_device",
        table_name="device_machine_credentials",
        schema=_SCHEMA,
    )
    op.drop_index(
        "idx_devenv_dmk_hash",
        table_name="device_machine_credentials",
        schema=_SCHEMA,
    )
    op.drop_table("device_machine_credentials", schema=_SCHEMA)
