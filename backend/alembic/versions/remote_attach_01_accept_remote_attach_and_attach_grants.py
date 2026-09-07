"""coord.devices.accept_remote_attach + coord.attach_grants — the D6 attach grant

Revision ID: remote_attach_01
Revises: fleet_res_tel_05
Create Date: 2026-09-07

Phase 3a-migration of plan
``2026-08-31-remote-session-tabs-in-runner-terminal`` (design decision D6 —
the keystroke authorization grain). Hand-authored; ``alembic revision
--autogenerate`` was not run and is never run against ``coord.*``.

coord authors **zero** DDL (``[policy: alembic-sole-authorship]``), so both
objects coord's Phase 3a mint route reads and writes land here, in
qontinui-web, and this revision must merge **before** the coord PR that uses
them. Until it has applied, coord DEGRADES rather than fails: the preference
read falls back to ``'same_user'`` on a missing column, and a missing table
means the grant is still minted and published but not persisted (the catch-up
poll then answers ``"storage": "absent"``).

What lands
==========

* ``coord.devices.accept_remote_attach TEXT NOT NULL DEFAULT 'same_user'`` —
  the TARGET device's user-preference axis for who may attach a remote
  terminal to its sessions. Closed three-valued set, so it carries a CHECK:

  - ``'same_user'`` (default) — only a source device paired to the same user.
  - ``'tenant'``              — any device in the same tenant.
  - ``'off'``                 — nobody; the mint refuses.

  ``NOT NULL DEFAULT`` needs no backfill: Postgres 11+ materializes the
  default for existing rows without a table rewrite. TEXT + CHECK rather
  than a PG ENUM follows the ``coord.*`` house idiom
  (``wtclean_p2_01_agent_worktrees_retention`` records why).

  The preference is NOT the authorization: it is one input to coord's
  issuance policy. The grant below is the safeguard, and the two never double
  for each other (plan D6, "Preference and authorization are separate
  mechanisms").

* ``coord.attach_grants`` — one row per minted grant. ``jti`` is the grant's
  JWT id and the row's identity; ``terminal_id`` is NULL until the target
  binds one at first use; ``consumed_at`` is NULL until the target consumes
  the grant. The runner's device-bound catch-up poll
  (``GET /sessions/attach-requests?device_id=``) reads unexpired, unconsumed
  rows for one target — hence the ``(target_device_id, expires_at)`` index.

  No foreign keys, deliberately: the wire contract fixes the column set, the
  coord mint must not fail on a device row that coord's own session registry
  already vouches for, and expiry (not cascade) is the row's lifecycle.

Idempotency
===========

``IF NOT EXISTS`` / ``IF EXISTS`` throughout, matching the ``coord.*``
migration house style, so a partially-applied run re-applies cleanly.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "remote_attach_01"
down_revision: str | Sequence[str] | None = "fleet_res_tel_05"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # --- coord.devices.accept_remote_attach --------------------------------
    op.execute(
        """
        ALTER TABLE coord.devices
            ADD COLUMN IF NOT EXISTS accept_remote_attach TEXT NOT NULL
                DEFAULT 'same_user'
        """
    )
    op.execute(
        """
        ALTER TABLE coord.devices
            DROP CONSTRAINT IF EXISTS coord_devices_accept_remote_attach_check
        """
    )
    op.execute(
        """
        ALTER TABLE coord.devices
            ADD CONSTRAINT coord_devices_accept_remote_attach_check
            CHECK (accept_remote_attach IN ('same_user', 'tenant', 'off'))
        """
    )

    # --- coord.attach_grants -----------------------------------------------
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.attach_grants (
            jti               UUID        PRIMARY KEY,
            tenant_id         UUID        NOT NULL,
            source_device_id  UUID        NOT NULL,
            target_device_id  UUID        NOT NULL,
            target_session_id UUID        NOT NULL,
            terminal_id       TEXT        NULL,
            source_user_id    UUID        NULL,
            expires_at        TIMESTAMPTZ NOT NULL,
            created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
            consumed_at       TIMESTAMPTZ NULL
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_attach_grants_target_expires
            ON coord.attach_grants (target_device_id, expires_at)
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS coord.idx_attach_grants_target_expires")
    op.execute("DROP TABLE IF EXISTS coord.attach_grants")
    op.execute(
        """
        ALTER TABLE coord.devices
            DROP CONSTRAINT IF EXISTS coord_devices_accept_remote_attach_check
        """
    )
    op.execute("ALTER TABLE coord.devices DROP COLUMN IF EXISTS accept_remote_attach")
