"""auth.pair_codes — bind a code to one device, record its one delivery

Revision ID: paircode_bind_01_bound_device_delivered
Revises: devcredrev_01_devices_credential_revoked_at
Create Date: 2026-09-30

Phase 2 of plan
``2026-09-26-authenticate-and-perpetually-renew-a-specific-runner-from-qontinui-web``.

An operator's ``POST /api/v1/devices/{device_id}/authorize-redeem`` mints an
ordinary pair code that the credential-dark runner collects itself through
``GET /api/v1/devices/{device_id}/pending-redeem`` instead of having it typed
in. Two columns make that safe:

* ``bound_device_id UUID NULL`` — the only device this code may be redeemed
  for. ``NULL`` is an ordinary operator-typed code (every existing row), which
  any device may redeem exactly as before. A bound code presented for any
  other device is refused (``pair_code_bound_to_other_device``).
* ``delivered_at TIMESTAMPTZ NULL`` — set when ``/pending-redeem`` hands the
  code out. The poll hands a code out AT MOST ONCE; a second poll answers 204.

The partial index serves the poll and the supersede sweep, which both look up
a device's still-redeemable bound codes.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "paircode_bind_01_bound_device_delivered"
down_revision: str = "devcredrev_01_devices_credential_revoked_at"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the binding + delivery columns and the per-device index."""
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
    """Drop the index and both columns."""
    op.execute("DROP INDEX IF EXISTS auth.idx_pair_codes_bound_device_pending")
    op.execute(
        """
        ALTER TABLE auth.pair_codes
            DROP COLUMN IF EXISTS delivered_at,
            DROP COLUMN IF EXISTS bound_device_id
        """
    )
