"""devenv_03: bridge devenv.machines to coord's device registry

Revision ID: devenv_03_coord_device_bridge
Revises: coord_session_identity_01
Create Date: 2026-07-02

P3 of plan ``2026-07-02-digital-twin-session-identity-registry``. Adds
``devenv.machines.coord_device_id UUID`` (nullable) — the machine's row
in coord's device registry (``coord.devices.device_id``) — so the
digital-twin UI can pivot from a devenv machine to its coord fleet
identity (sessions, worktrees, lineage).

NOT a FK: coord and devenv are independently-written surfaces in the
same DB — a coord device row may be reaped/re-enrolled without devenv
knowing, and a dangling pointer must not block machine writes. The
column is a soft bridge, populated at agent enroll time (the agent
asserts its coord device id) or by the hostname backfill below.

Backfill: match on hostname, but ONLY where the hostname is unambiguous
(exactly one coord device carries it) — hostnames are not unique in
coord's registry, and a wrong bridge is worse than no bridge. Guarded
by ``to_regclass('coord.devices')`` so a DB without the coord schema
(isolated devenv test DBs) upgrades cleanly.

Forward-only + additive (a nullable column + best-effort backfill) —
safe for a running app on the prior schema.

``down_revision`` was ASSIGNED by coord's migration-reserve
(reservation 2fa02903-ee06-4cce-9a40-d9ecd495cc08, position 2, chained
behind our own ``coord_session_identity_01``) — do not re-point.
"""

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

from alembic import op

# revision identifiers
revision = "devenv_03_coord_device_bridge"
down_revision = "coord_session_identity_01"
branch_labels = None
depends_on = None

_SCHEMA = "devenv"


def upgrade() -> None:
    op.add_column(
        "machines",
        sa.Column("coord_device_id", UUID(as_uuid=True), nullable=True),
        schema=_SCHEMA,
    )
    op.create_index(
        "idx_devenv_machine_coord_device",
        "machines",
        ["coord_device_id"],
        schema=_SCHEMA,
    )
    # Backfill from coord's device registry by hostname, only where the
    # hostname match is unambiguous (exactly one coord device row).
    # PL/pgSQL prepares statements lazily, so the coord.devices
    # reference inside the untaken branch is safe on a DB without the
    # coord schema.
    op.execute(
        """
        DO $$
        BEGIN
            IF to_regclass('coord.devices') IS NOT NULL THEN
                UPDATE devenv.machines m
                SET coord_device_id = d.device_id
                FROM coord.devices d
                WHERE m.coord_device_id IS NULL
                  AND m.hostname IS NOT NULL
                  AND lower(m.hostname) = lower(d.hostname)
                  AND (SELECT count(*) FROM coord.devices d2
                       WHERE lower(d2.hostname) = lower(m.hostname)) = 1;
            END IF;
        END
        $$
        """
    )


def downgrade() -> None:
    op.drop_index(
        "idx_devenv_machine_coord_device", table_name="machines", schema=_SCHEMA
    )
    op.drop_column("machines", "coord_device_id", schema=_SCHEMA)
