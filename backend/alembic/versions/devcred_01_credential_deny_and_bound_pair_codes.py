"""Device-scoped credential deny + device-bound, deliver-once pair codes

Revision ID: devcred_01_credential_deny_and_bound_pair_codes
Revises: notif_producerless_01_drop_enum_values
Create Date: 2026-10-10

Plan
``2026-09-26-authenticate-and-perpetually-renew-a-specific-runner-from-qontinui-web``
Phases 2 and 4. One revision (the migration-reversal gate tests exactly one
added file per PR); every change is an additive nullable column or an index.

coord authors **zero** DDL (``[policy: alembic-sole-authorship]``), so the
column coord READS lands here, in qontinui-web, and must be applied in
production BEFORE the coord PR that reads it leaves draft. ``down_revision`` is
this repo's LOCAL single alembic head; if a revision lands ahead of this one,
re-point it rather than authoring a merge.

``coord.devices.credential_revoked_at TIMESTAMPTZ NULL``
=======================================================

The device-scoped credential deny. Before it the only revocation primitives
were per-credential: ``coord.revoked_tokens`` records ONE ``jti`` (the next
refresh mints a fresh one) and ``devenv.device_machine_credentials.revoked_at``
kills ONE ``dmk_``. Neither stops the refresh CHAIN. ``NULL`` = not revoked
(every existing row; no backfill). While set, web's ``/machine-credential/mint``,
``/self-mint``, ``/exchange``, pair-code redeem, ``pair-cli``, ``pair-confirm``
and the ``/pending-redeem`` poll refuse; coord's device refresh and
service-mint refuse. Only an operator's ``authorize-redeem`` clears it.

``auth.pair_codes.bound_device_id UUID NULL`` / ``delivered_at TIMESTAMPTZ NULL``
================================================================================

An operator's ``authorize-redeem`` mints an ordinary pair code BOUND to one
device, which the credential-dark runner collects itself via
``/pending-redeem``. ``bound_device_id`` is the only device it may be redeemed
for (``NULL`` = an ordinary operator-typed code, every existing row);
``delivered_at`` records the one hand-out. The partial index serves the poll and
the supersede sweep (a device's still-redeemable bound codes).

Nullable with no defaults, so each ``ADD COLUMN`` is a catalog-only change on
Postgres (no table rewrite).
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "devcred_01_credential_deny_and_bound_pair_codes"
down_revision: str = "notif_producerless_01_drop_enum_values"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the deny column, the binding/delivery columns and the index."""
    op.execute(
        """
        ALTER TABLE coord.devices
            ADD COLUMN IF NOT EXISTS credential_revoked_at TIMESTAMPTZ NULL
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.devices.credential_revoked_at IS
            'Device-scoped credential deny. NULL = not revoked. While set, '
            'every door that issues this device a credential refuses '
            '(device_credential_revoked). Cleared only by an operator '
            'authorize-redeem.'
        """
    )
    op.execute(
        """
        ALTER TABLE auth.pair_codes
            ADD COLUMN IF NOT EXISTS bound_device_id UUID        NULL,
            ADD COLUMN IF NOT EXISTS delivered_at    TIMESTAMPTZ NULL
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_pair_codes_bound_device_pending
            ON auth.pair_codes(bound_device_id, expires_at)
            WHERE bound_device_id IS NOT NULL AND redeemed_at IS NULL
        """
    )


def downgrade() -> None:
    """Reverse ``upgrade`` exactly: index, then both tables' columns."""
    op.execute("DROP INDEX IF EXISTS auth.idx_pair_codes_bound_device_pending")
    op.execute(
        """
        ALTER TABLE auth.pair_codes
            DROP COLUMN IF EXISTS delivered_at,
            DROP COLUMN IF EXISTS bound_device_id
        """
    )
    op.execute("ALTER TABLE coord.devices DROP COLUMN IF EXISTS credential_revoked_at")
