"""coord.gates — loud continuation expiry/deferred stamps + coord.continuation_poll_status

Revision ID: contstall_01_gates_continuation_expiry
Revises: coord_session_handles
Create Date: 2026-07-23

Phase A (web slice) of plan "coord gate-continuation delivery stall".
Authored by alembic in ``qontinui-web`` — coord authors zero ``coord.*`` DDL
(memory ``reference_coord_rust_authors_zero_coord_schema``).

Today coord's gate-continuation queue silently expires undelivered work after
24h — the freshness window is a WHERE-clause fallout with no terminal state —
and deliveries a device locally skips are invisible. This migration writes the
schema the coord-side sweep/stamp/report features need:

Five new ``coord.gates`` columns (extending the ``replaycols_01`` /
``contcancel_01`` continuation-lifecycle family):

- ``continuation_expired_at TIMESTAMPTZ NULL`` — when the expiry sweep
  terminal-stamped a dispatched-but-never-consumed continuation. NULL = not
  expired (the overwhelming majority).
- ``continuation_expired_reason TEXT NULL`` — why it expired (e.g. the 24h
  freshness window it fell out of). NULL = not expired.
- ``continuation_deferred_at TIMESTAMPTZ NULL`` — last time a poller saw the
  continuation but deliberately did NOT consume it (non-consuming "deferred"
  stamp). Unlike expiry this is not terminal; the row stays pending.
- ``continuation_deferred_reason TEXT NULL`` — the poller's skip reason.
- ``continuation_deferred_count INTEGER NOT NULL DEFAULT 0`` — how many times
  the continuation was seen-and-skipped; lets the sweep distinguish
  never-delivered from repeatedly-declined work.

New table ``coord.continuation_poll_status`` — one row per device, upserted on
each pending-continuations poll, making locally-skipped deliveries observable:

- ``device_id UUID PRIMARY KEY``
- ``polled_at TIMESTAMPTZ NOT NULL``   — when the device last polled.
- ``listed_n INTEGER NOT NULL``        — continuations coord listed for it.
- ``dispatched_n INTEGER NOT NULL``    — how many it actually dispatched.
- ``skipped_n INTEGER NOT NULL``       — how many it locally skipped.
- ``skip_reasons JSONB NOT NULL DEFAULT '{}'`` — reason → count map.
- ``updated_at TIMESTAMPTZ NOT NULL DEFAULT now()``

Deliberately NO tenant FK: the table is device-keyed like the
pending-continuations pull surface it observes, and ``coord.gates`` itself
carries no tenants FK either (memory
``reference_coord_alerts_device_arm_leaks_cross_tenant`` — only
``coord.alerts`` FKs ``coord.tenants``).

## NO index change

``ix_gates_continuation_pending`` (from ``replaycols_01``) stays a SUPERSET of
the pending set; expiry/deferred filtering happens at QUERY time on the
handful of rows the partial index already prunes to — same posture as
``contcancel_01`` (keeps the index predicate IMMUTABLE-safe and buys nothing
for the few pending rows). Nothing to drop on downgrade beyond the table and
the five columns.

## House conventions followed

Raw ``op.execute`` with ``ADD COLUMN IF NOT EXISTS`` per column and
``CREATE TABLE IF NOT EXISTS`` — mirrors the sibling
``contcancel_01_gates_continuation_cancel_outcome`` and
``coord_session_handles`` exactly (collision-safe / order-safe against the
separate coord consumer PR). Touches only ``coord.*``. The coord side reads
these columns best-effort until this migration is live — same "web migration
FIRST" rule as every new coord.* surface.

Chains off the current single head ``coord_session_handles`` (worktree freshly
cut from origin/main 2026-07-23; coord re-points down_revision at land time —
no head reservation or stacked-on label needed).
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "contstall_01_gates_continuation_expiry"
down_revision: str | Sequence[str] | None = "dry_run_retire_02_drop_bools"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add expiry/deferred lifecycle columns + the per-device poll-status table."""
    # Terminal expiry stamp (sweep-written): dispatched but never consumed.
    op.execute("""
        ALTER TABLE coord.gates
            ADD COLUMN IF NOT EXISTS continuation_expired_at TIMESTAMPTZ
        """)
    op.execute("""
        ALTER TABLE coord.gates
            ADD COLUMN IF NOT EXISTS continuation_expired_reason TEXT
        """)
    # Non-consuming deferred stamp (poller-written): seen but deliberately
    # skipped; NOT terminal — the continuation stays pending.
    op.execute("""
        ALTER TABLE coord.gates
            ADD COLUMN IF NOT EXISTS continuation_deferred_at TIMESTAMPTZ
        """)
    op.execute("""
        ALTER TABLE coord.gates
            ADD COLUMN IF NOT EXISTS continuation_deferred_reason TEXT
        """)
    op.execute("""
        ALTER TABLE coord.gates
            ADD COLUMN IF NOT EXISTS continuation_deferred_count INTEGER
                NOT NULL DEFAULT 0
        """)
    # Per-device poll-status report: one row per device, upserted each poll.
    # Device-keyed like the pending-continuations pull surface; no tenant FK
    # by design (coord.gates has none either).
    op.execute("""
        CREATE TABLE IF NOT EXISTS coord.continuation_poll_status (
            device_id     UUID PRIMARY KEY,
            polled_at     TIMESTAMPTZ NOT NULL,
            listed_n      INTEGER NOT NULL,
            dispatched_n  INTEGER NOT NULL,
            skipped_n     INTEGER NOT NULL,
            skip_reasons  JSONB NOT NULL DEFAULT '{}',
            updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """)


def downgrade() -> None:
    """Drop the poll-status table, then the five coord.gates columns."""
    op.execute("DROP TABLE IF EXISTS coord.continuation_poll_status")
    op.execute(
        "ALTER TABLE coord.gates DROP COLUMN IF EXISTS continuation_deferred_count"
    )
    op.execute(
        "ALTER TABLE coord.gates DROP COLUMN IF EXISTS continuation_deferred_reason"
    )
    op.execute("ALTER TABLE coord.gates DROP COLUMN IF EXISTS continuation_deferred_at")
    op.execute(
        "ALTER TABLE coord.gates DROP COLUMN IF EXISTS continuation_expired_reason"
    )
    op.execute("ALTER TABLE coord.gates DROP COLUMN IF EXISTS continuation_expired_at")
