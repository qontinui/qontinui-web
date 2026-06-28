"""coord.work_unit_dispatches — at-least-once unit-dispatch replay record

Revision ID: coord_work_unit_dispatches_01
Revises: presetsrc01_allow_preset_profile_source
Create Date: 2026-06-26

Phase 1 (substrate) of plan
``2026-06-26-coord-workunit-dispatch-at-least-once-durability``.

Adds ``coord.work_unit_dispatches``, the durable record of a work-unit
dispatch so coord can deliver each dispatch **at least once** (replay a
pending dispatch to a device until the device acks/consumes it). One row per
dispatch attempt keyed by ``dispatch_id`` (the dedupe/ack token the runner
echoes back); ``consumed_at`` NULL means "still pending delivery". The hot
runtime path is "what is pending for device D?" — served by the partial
index on ``target_device_id WHERE consumed_at IS NULL``.

## Columns (LOCKED — coord DMLs against these exact names)

* ``dispatch_id``      UUID PRIMARY KEY — dedupe/ack token.
* ``work_unit_id``     UUID NOT NULL FK ``coord.work_units(id)`` ON DELETE
                       CASCADE — the unit being dispatched.
* ``tenant_id``        UUID, nullable — denormalized tenant scope (resolved
                       from the JWT at DML time, mirroring
                       ``coord.work_units.tenant_id``).
* ``target_device_id`` UUID, nullable — the device this dispatch targets.
* ``payload``          JSONB NOT NULL — the dispatch payload.
* ``dispatched_at``    TIMESTAMPTZ NOT NULL DEFAULT now().
* ``consumed_at``      TIMESTAMPTZ, nullable — set when the device
                       acks/consumes; NULL ==> still pending.

## Indexes / access paths

* ``idx_work_unit_dispatches_pending_device`` — partial index on
  ``(target_device_id) WHERE consumed_at IS NULL``, the hot "pending for
  device D" replay query.
* ``idx_work_unit_dispatches_unit`` — on ``(work_unit_id)`` for
  per-unit dispatch lookups and FK-cleanup support.

alembic is the sole author of this schema. Rust (coord) only DMLs against
this table; this web migration MUST be applied to prod RDS BEFORE the coord
image that reads/writes it deploys (same deploy-order rule as the rest of
the ``coord`` schema).

## House conventions followed

Raw ``op.execute`` (not ``op.create_table``) with ``CREATE TABLE IF NOT
EXISTS`` + ``CREATE INDEX IF NOT EXISTS`` so the migration is collision-safe
against any canonical PG that already carries the objects from a self-heal
mirror — same convention as ``coord_workunit_deps_01`` and
``coord_workunits_01_work_units``.
"""

from collections.abc import Sequence

from alembic import op


# revision identifiers, used by Alembic.
# down_revision = current single alembic head at authoring time
# (``alembic heads`` confirmed it sole). The pre-authoring reservation queue
# is advisory; coord's land-time down_revision re-point is authoritative and
# will correct this if the head drifts before land.
revision: str = "coord_work_unit_dispatches_01"
down_revision: str | Sequence[str] | None = "presetsrc01_allow_preset_profile_source"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create ``coord.work_unit_dispatches`` + its two indexes. Idempotent."""
    op.execute("CREATE SCHEMA IF NOT EXISTS coord")

    # work_unit_dispatches — durable at-least-once dispatch replay record.
    # One row per dispatch keyed by dispatch_id (dedupe/ack token).
    # work_unit_id FKs coord.work_units(id) ON DELETE CASCADE.
    # consumed_at NULL ==> still pending delivery.
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.work_unit_dispatches (
            dispatch_id       UUID PRIMARY KEY,
            work_unit_id      UUID NOT NULL
                REFERENCES coord.work_units(id) ON DELETE CASCADE,
            tenant_id         UUID,
            target_device_id  UUID,
            payload           JSONB NOT NULL,
            dispatched_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
            consumed_at       TIMESTAMPTZ
        )
        """
    )
    # Hot path: "what is pending for device D?" — partial index over
    # undelivered dispatches only.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_work_unit_dispatches_pending_device
            ON coord.work_unit_dispatches (target_device_id)
            WHERE consumed_at IS NULL
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_work_unit_dispatches_unit
            ON coord.work_unit_dispatches (work_unit_id)
        """
    )


def downgrade() -> None:
    """Reverse: drop indexes then the table (indexes also drop with it)."""
    op.execute(
        "DROP INDEX IF EXISTS coord.idx_work_unit_dispatches_unit"
    )
    op.execute(
        "DROP INDEX IF EXISTS coord.idx_work_unit_dispatches_pending_device"
    )
    op.execute("DROP TABLE IF EXISTS coord.work_unit_dispatches")
