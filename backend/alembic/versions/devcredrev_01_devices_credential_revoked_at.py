"""coord.devices.credential_revoked_at — a device-scoped credential deny

Revision ID: devcredrev_01_devices_credential_revoked_at
Revises: coordinput_01_operator_inputs
Create Date: 2026-09-30

Phase 4 of plan
``2026-09-26-authenticate-and-perpetually-renew-a-specific-runner-from-qontinui-web``.

coord authors **zero** DDL (``[policy: alembic-sole-authorship]``), so the
column lands here, in qontinui-web, and must be applied in production BEFORE
the coord PR that reads it (the device-JWT refresh and service-mint refusals)
leaves draft. ``down_revision`` is this repo's LOCAL single alembic head; if a
revision lands ahead of this one, re-point it rather than authoring a merge.

Why a device-scoped column
==========================

Before this column the only revocation primitives were per-credential:
``coord.revoked_tokens`` records ONE ``jti`` (the device's next refresh mints a
fresh, unrevoked one) and ``devenv.device_machine_credentials.revoked_at``
kills ONE ``dmk_`` (the user-bearer ``/mint`` rotates it back to life). Neither
stops the refresh CHAIN, so neither is fail-closed. ``credential_revoked_at``
is the one fact every credential-issuing door can check:

* ``NULL`` — not revoked (every existing row; no backfill).
* a timestamp — the operator revoked this device's credentials at that time.
  web's ``/machine-credential/mint``, ``/self-mint``, ``/exchange``, the pair-
  code redeem and the ``/pending-redeem`` poll refuse; coord's device refresh
  and service-mint refuse. Only an operator's ``authorize-redeem`` clears it.

Nullable with no default, so the ``ADD COLUMN`` is a catalog-only change on
Postgres (no table rewrite, no long lock on a hot table).
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "devcredrev_01_devices_credential_revoked_at"
down_revision: str = "coordinput_01_operator_inputs"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add ``coord.devices.credential_revoked_at``. Idempotent."""
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


def downgrade() -> None:
    """Drop ``coord.devices.credential_revoked_at``."""
    op.execute(
        "ALTER TABLE coord.devices DROP COLUMN IF EXISTS credential_revoked_at"
    )
