"""coord.memory_records: orthogonal provenance facets + altitude.

Phase 1, migration 1 of plan
``qontinui-dev-notes/plans/2026-08-06-user-and-device-facets-on-memories-and-findings.md``
(§5). Additive, nullable-where-it-can-be, no behaviour change.

What this adds
==========================================================================

* ``coord.memory_records.user_id UUID NULL REFERENCES auth.users(id)`` — the
  human the record is attributed to, derived server-side from the
  authenticated caller (the device JWT's own ``user_id`` claim), NEVER from
  the request body. §4.1/§6 requirement 1.
* ``coord.memory_records.device_id UUID NULL REFERENCES coord.devices(device_id)``
  — the machine the record came from, from the verified ``device_id`` claim.
* ``coord.memory_records.applies_at TEXT NOT NULL DEFAULT 'tenant'`` — the
  ALTITUDE facet, constrained to ``fleet|tenant|user|device|session``.

Both provenance columns are NULLABLE and stay that way: a caller with no
device identity (operator bearer, service token, CI) writes NULLs and the row
is simply less filterable. **A write is never rejected for missing
provenance** — a memory that fails to save is worse than one that is coarsely
scoped (§4.1 item 3).

🚨 THERE IS DELIBERATELY NO ``ALTER COLUMN applies_at DROP DEFAULT`` HERE
==========================================================================

Do not "fix" this by adding one. The plan originally had the ``DROP DEFAULT``
in this migration and the re-vet of 2026-09-19 identified that as a
**production outage**: after the drop, a ``NOT NULL`` column with no default
makes every INSERT that does not name ``applies_at`` fail, and **no current
writer names it** — ``memory_store.insert_record`` lists 14 columns
(``backend/app/services/memory_store.py:658-661``) and
``insert_records_batch`` lists 13 (``:797-800``). This migration is advertised
as behaviour-neutral, and the ``DROP DEFAULT`` would have taken every memory
write in the fleet to ``null value in column "applies_at" violates not-null
constraint``.

The ``DROP DEFAULT`` belongs to **Phase 3's migration 2b**, landing together
with the API change that makes ``applies_at`` a required field on the wire.
The default is not a back-compat shim: it is the mechanism that lets DDL land
ahead of the code that will supply the value, which is the deploy ordering
§5 mandates (web migration → coord, never the reverse).

The DEFAULT also backfills every existing row to ``'tenant'`` in a single
statement, which is semantically identical to today (§2.1 measured 5,681
memory records, 100% ``scope='tenant'``).

Indexes
==========================================================================

Three partial indexes, all excluding tombstones because every retrieval path
already does (``memory_store._validity_filters``)::

    idx_memory_records_user      (user_id)              WHERE user_id IS NOT NULL
    idx_memory_records_device    (device_id)            WHERE device_id IS NOT NULL
    idx_memory_records_altitude  (applies_at, tenant_id)

Built NON-concurrently, inside this migration's transaction, deliberately:
``coord.memory_records`` is a ~5.7k-row table (§2.1, measured 2026-08-06), so
the SHARE lock a plain ``CREATE INDEX`` takes is held for milliseconds. A
``CONCURRENTLY`` build would have to leave the transaction (an
``autocommit_block``) and carry the INVALID-index recovery dance that
``agent_questions_alert_episode_01`` needs, buying nothing at this size.

Downgrade drops the three indexes and the three columns (the CHECK constraint
goes with its column). Records survive.

Revision ID: memfacets_01
Revises: agent_questions_alert_episode_01
Create Date: 2026-09-19

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "memfacets_01"
down_revision: str | Sequence[str] | None = "agent_questions_alert_episode_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add ``user_id`` / ``device_id`` / ``applies_at`` + three indexes."""
    # Both FKs take a SHARE ROW EXCLUSIVE lock on the REFERENCED table
    # (auth.users, coord.devices) for the duration of the ALTER, so bound
    # the wait rather than queueing behind a long reader.
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute(
        """
        ALTER TABLE coord.memory_records
            ADD COLUMN IF NOT EXISTS user_id UUID
                REFERENCES auth.users(id),
            ADD COLUMN IF NOT EXISTS device_id UUID
                REFERENCES coord.devices(device_id),
            ADD COLUMN IF NOT EXISTS applies_at TEXT NOT NULL DEFAULT 'tenant'
                CONSTRAINT ck_memory_records_applies_at
                CHECK (applies_at IN (
                    'fleet', 'tenant', 'user', 'device', 'session'
                ))
        """
    )
    # SET LOCAL is transaction-scoped and env.py wraps the WHOLE run in one
    # transaction, so without this reset the 3s timeout leaks into every
    # revision that lands after this one.
    op.execute("RESET lock_timeout")

    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_memory_records_user
            ON coord.memory_records (user_id)
            WHERE user_id IS NOT NULL AND is_tombstone = false
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_memory_records_device
            ON coord.memory_records (device_id)
            WHERE device_id IS NOT NULL AND is_tombstone = false
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_memory_records_altitude
            ON coord.memory_records (applies_at, tenant_id)
            WHERE is_tombstone = false
        """
    )


def downgrade() -> None:
    """Drop the three indexes, then the three columns."""
    op.execute("DROP INDEX IF EXISTS coord.idx_memory_records_altitude")
    op.execute("DROP INDEX IF EXISTS coord.idx_memory_records_device")
    op.execute("DROP INDEX IF EXISTS coord.idx_memory_records_user")
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute(
        """
        ALTER TABLE coord.memory_records
            DROP COLUMN IF EXISTS applies_at,
            DROP COLUMN IF EXISTS device_id,
            DROP COLUMN IF EXISTS user_id
        """
    )
    op.execute("RESET lock_timeout")
