"""coord.devices.accept_remote_create + coord.create_grants — the create grant

Revision ID: remote_create_01
Revises: claude_acct_01
Create Date: 2026-09-11

Phase 3b-migration of plan
``2026-09-11-headless-runner-parity-from-a-headed-runner``. The direct twin of
``remote_attach_01`` (``coord.devices.accept_remote_attach`` +
``coord.attach_grants``), and deliberately shaped like it: remote ATTACH and
remote CREATE are one concept with two capabilities, and two idioms for one
concept is what this plan has been correcting.

Hand-authored; ``alembic revision --autogenerate`` was not run and is never run
against ``coord.*``.

coord authors **zero** DDL (``[policy: alembic-sole-authorship]``), so both
objects coord's create-grant routes read and write land here, in qontinui-web,
and this revision must merge **before** the coord PR that uses them. Until it
has applied, coord DEGRADES rather than fails — and for create the degrade is
the FEATURE BEING OFF, which is why it is blocked on this revision rather than
merely slowed by it:

* the preference read falls back to ``'off'`` on a missing column, so every
  ``POST /coord/devices/{id}/create-grants`` is refused ``create_forbidden`` /
  ``preference_off``, and ``PUT /coord/devices/me/create-preference`` answers a
  typed ``503 create_preference_unavailable`` rather than telling a runner a
  consent was stored when it was not;
* a missing ``coord.create_grants`` means the grant is still minted and the
  ``create_request`` directive still published, but not persisted, and the
  catch-up poll then answers ``"storage": "absent"`` so the target runner reads
  UNKNOWN rather than "nothing pending".

Ordering constraint (why this revision must land FIRST)
=======================================================

coord's ``schema_read_contract`` gate extracts every ``coord.<table>.<column>``
coord's SQL touches and asserts it exists at qontinui-web's alembic head, as
provisioned by the pinned ``MIGRATOR_DIGEST`` image. A coord read of a column no
migration has created otherwise passes every coord-only check and then fails at
query time — silently wherever the path warns-and-continues (the 2026-07-13
``default_source`` incident, ten days fleet-wide). coord's reads here are
therefore carried as explicit ``KNOWN_MISSING`` read-ahead waivers, which
SELF-EXPIRE: the first ``MIGRATOR_DIGEST`` bump whose head is at or past this
revision makes coord's stale-KNOWN_MISSING assertion red on them, and they are
deleted in that same commit. Authoring this revision does not expire them —
being in the PINNED IMAGE does.

What lands
==========

* ``coord.devices.accept_remote_create TEXT NOT NULL DEFAULT 'off'`` — the
  TARGET device's user-preference axis for who may create a remote terminal on
  it. Closed three-valued set, so it carries a CHECK. The vocabulary is
  deliberately the SAME as ``accept_remote_attach``'s — one vocabulary an
  operator learns once, two dials they set independently:

  - ``'off'`` (default) — nobody; the mint refuses.
  - ``'same_user'``     — only a source device paired to the same user.
  - ``'tenant'``        — any device in the same tenant.

  **The DEFAULT is ``'off'``, where the attach column's is ``'same_user'``,
  and that difference is deliberate.** A user who enabled remote ATTACH did not
  thereby consent to a remote peer spawning PTYs on their machine. The naive
  "create is strictly stronger than attach, so the attach dial covers it"
  argument does not hold in either direction — ``terminal_close`` is already
  admitted to an attach grant, so attach can already destroy a PTY. What
  distinguishes create is the blast radius a NEW terminal opens: the remote peer
  chooses the working directory, and the session it starts allocates worktrees
  and takes coord claims on the target machine. Separate consent, separate dial,
  and the dial starts shut. If this default is ever changed to an admitting
  value, remote PTY creation silently turns itself on for every device in the
  fleet at the next deploy.

  ``NOT NULL DEFAULT`` needs no backfill: Postgres 11+ materializes the default
  for existing rows without a table rewrite. TEXT + CHECK rather than a PG ENUM
  follows the ``coord.*`` house idiom (``wtclean_p2_01_agent_worktrees_retention``
  records why), and matches the sibling attach column exactly.

  The preference is NOT the authorization: it is one input to coord's issuance
  policy. The grant below is the safeguard, and the two never double for each
  other.

* ``coord.create_grants`` — one row per minted grant, and the reason this
  revision is a security fix rather than a convenience. Coord's create path
  originally MINTED and stopped: the web relay verified the grant against
  coord's JWKS and forwarded a ``terminal_create``, and the target runner had no
  table of its own to check, so it trusted the relay. A relay defect — or a
  compromised relay — then spawned PTYs on the target. This table, plus the
  ``create_request`` directive coord publishes beside it, is how the target
  learns which jtis coord actually minted for it; the runner's device-bound
  catch-up poll (``GET /sessions/create-requests?device_id=``) reads unexpired,
  unconsumed rows for one target — hence the ``(target_device_id, expires_at)``
  index, the same access path ``coord.attach_grants`` has.

  The column set is ``coord.attach_grants``' minus the two session-shaped
  columns a create cannot carry: there is no ``target_session_id`` (a create has
  no session yet — that is the whole difference between the two capabilities)
  and no ``terminal_id`` (the terminal is what the grant will create). Widening
  the attach table with nullable columns to hold both would have made
  ``target_session_id`` optional there and weakened every existing attach check
  to buy one new capability.

  No foreign keys, deliberately and for the attach table's reasons: the wire
  contract fixes the column set, the coord mint must not fail on a device row
  coord's own device registry already vouches for, and expiry (not cascade) is
  the row's lifecycle.

Idempotency
===========

``IF NOT EXISTS`` / ``IF EXISTS`` throughout, matching the ``coord.*`` migration
house style, so a partially-applied run re-applies cleanly. The CHECK is dropped
before it is added for the same reason: ``ADD CONSTRAINT`` has no ``IF NOT
EXISTS`` form, so the drop-then-add pair is what makes the constraint step
re-runnable.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "remote_create_01"
down_revision: str | Sequence[str] | None = "claude_acct_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # --- coord.devices.accept_remote_create --------------------------------
    # DEFAULT 'off', NOT 'same_user'. See the module docstring: enabling remote
    # attach is not consent to remote PTY creation.
    op.execute(
        """
        ALTER TABLE coord.devices
            ADD COLUMN IF NOT EXISTS accept_remote_create TEXT NOT NULL
                DEFAULT 'off'
        """
    )
    op.execute(
        """
        ALTER TABLE coord.devices
            DROP CONSTRAINT IF EXISTS coord_devices_accept_remote_create_check
        """
    )
    op.execute(
        """
        ALTER TABLE coord.devices
            ADD CONSTRAINT coord_devices_accept_remote_create_check
            CHECK (accept_remote_create IN ('off', 'same_user', 'tenant'))
        """
    )

    # --- coord.create_grants -----------------------------------------------
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.create_grants (
            jti              UUID        PRIMARY KEY,
            tenant_id        UUID        NOT NULL,
            source_device_id UUID        NOT NULL,
            target_device_id UUID        NOT NULL,
            source_user_id   UUID        NULL,
            expires_at       TIMESTAMPTZ NOT NULL,
            created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
            consumed_at      TIMESTAMPTZ NULL
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_create_grants_target_expires
            ON coord.create_grants (target_device_id, expires_at)
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS coord.idx_create_grants_target_expires")
    op.execute("DROP TABLE IF EXISTS coord.create_grants")
    op.execute(
        """
        ALTER TABLE coord.devices
            DROP CONSTRAINT IF EXISTS coord_devices_accept_remote_create_check
        """
    )
    op.execute("ALTER TABLE coord.devices DROP COLUMN IF EXISTS accept_remote_create")
