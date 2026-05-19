"""ud03 drop _devices_migration_remap table

Revision ID: ud03_drop_remap_table
Revises: ud02_drop_runner_tokens
Create Date: 2026-05-18

Phase 8 of plan
``D:/qontinui-root/plans/2026-05-18-unified-devices-registry.md``.

Retires the ``_devices_migration_remap`` side table created by PR #144's
``ud01_unify_devices_registry`` migration. The remap table stored the
``auth.runners.id`` -> ``coord.devices.device_id`` mapping for any
post-cutover reconciliation needs (e.g., a stray INSERT keyed by the
legacy runner UUID that needs to be reattributed to the new device
identity).

OPERATOR-RUN: This revision lives at the END of the chain but is NOT
automatically applied during the Phase 1 / Phase 5 flag-day cutover.
Operator runs this manually after a 30-day "no issues confirmed" soak
window has passed since the original Phase 1 cutover. At that point the
mapping is no longer needed (any straggler reconciliation would have
surfaced via state-reconciler-watcher's NULL-device_id contamination
alert), and the table is just dead weight in the schema.

To apply: ``alembic upgrade ud03_drop_remap_table`` from the web
backend, only after operator-explicit confirmation. The revision is
idempotent (``IF EXISTS``) so a re-run is a no-op.

Chained off ``ud02_drop_runner_tokens`` (Phase 5; rebased against
PR #144's ``ud0X`` naming convention 2026-05-18 per plan §3.5).

Operator priority: no backward-compat (flag-day rollout); ``downgrade``
is irreversible.
"""

from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "ud03_drop_remap_table"
down_revision: Union[str, None] = "ud02_drop_runner_tokens"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Drop ``coord._devices_migration_remap`` if it exists.

    Operator runs this manually after a 30-day soak. The table is
    idempotently dropped — re-running this revision against a PG that
    already dropped it is a no-op.
    """
    op.execute("DROP TABLE IF EXISTS coord._devices_migration_remap CASCADE")


def downgrade() -> None:
    """Irreversible — the migration mapping is single-use audit residue
    and cannot be reconstructed once dropped. See plan §"Cutover
    discipline".
    """
    raise NotImplementedError(
        "ud03_drop_remap_table is irreversible (post-soak cleanup). "
        "Restore from pre-cleanup pg_dump if rollback is required."
    )
