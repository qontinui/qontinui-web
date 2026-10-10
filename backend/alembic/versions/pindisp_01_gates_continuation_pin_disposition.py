"""coord.gates — continuation_pin_disposition (what happened to a device pin)

Revision ID: pindisp_01_gates_continuation_pin_disposition
Revises: findings_keyset_01
Create Date: 2026-10-05

Phase 2 of plan
``2026-10-05-a-drained-device-pin-silently-retargets-device-local-work``.

A continuation may pin a device (``continuation_spawn->>'target_device_id'``).
Until now the row recorded only where the continuation WENT
(``dispatched_target_device`` in the payload), never what coord decided about
the pin, or why. Settling a misroute took production CloudWatch access.

- ``continuation_pin_disposition TEXT NULL`` — ``honoured`` |
  ``held:<reason>`` | ``released:<reason>`` | ``refused:<reason>``, where ``<reason>`` is coord's
  ``PinReason`` (``drained``, ``drain_unknown``, ``offline``,
  ``not_bound_to_tenant``, ``missing_capabilities``, ``probe_failed``).
  ``refused`` is a strict pin coord would not dispatch anywhere (unbound or
  missing capabilities at clearance). Written by coord at clearance
  (Spawn / Notify / Hold arms) and by the stall
  watcher when it re-targets. NULL = no pin was decided on: a row with no pin,
  a row not yet cleared, or a row that predates this column. Readers render
  NULL as UNKNOWN, never as ``honoured``.

The pinned device itself is NOT a column: it is already in
``continuation_spawn->>'target_device_id'`` and is projected at read time.

House conventions follow ``contcancel_01_gates_continuation_cancel_outcome``:
raw ``ADD COLUMN IF NOT EXISTS``, touches only ``coord.gates``, no index.
alembic is the sole author of ``coord.*`` schema; this migration must be live
before the coord build that writes the column deploys.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "pindisp_01_gates_continuation_pin_disposition"
down_revision: str | Sequence[str] | None = "findings_keyset_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # honoured | held:<reason> | released:<reason> | refused:<reason> | NULL = UNKNOWN.
    op.execute(
        """
        ALTER TABLE coord.gates
            ADD COLUMN IF NOT EXISTS continuation_pin_disposition TEXT
        """
    )


def downgrade() -> None:
    op.execute(
        "ALTER TABLE coord.gates DROP COLUMN IF EXISTS continuation_pin_disposition"
    )
