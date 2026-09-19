"""coord.memory_records: orthogonal provenance facets + altitude.

Phase 1, migration 1 of plan
``qontinui-dev-notes/plans/2026-08-06-user-and-device-facets-on-memories-and-findings.md``
(§5). Additive, nullable-where-it-can-be, no behaviour change.

What this adds
==========================================================================

* ``coord.memory_records.user_id UUID NULL REFERENCES auth.users(id)
  ON DELETE SET NULL`` — the human the record is attributed to, derived
  server-side from the authenticated caller (the device JWT's own
  ``user_id`` claim), NEVER from the request body. §4.1/§6 requirement 1.
* ``coord.memory_records.device_id UUID NULL
  REFERENCES coord.devices(device_id) ON DELETE SET NULL`` — the machine the
  record came from, from the verified ``device_id`` claim.
* ``coord.memory_records.applies_at TEXT NOT NULL DEFAULT 'tenant'`` — the
  ALTITUDE facet, constrained to ``fleet|tenant|user|device|session``.

Both provenance columns are NULLABLE and stay that way: a caller with no
device identity (operator bearer, service token, CI) writes NULLs and the row
is simply less filterable. **A write is never rejected for missing
provenance** — a memory that fails to save is worse than one that is coarsely
scoped (§4.1 item 3).

🚨 ``ON DELETE SET NULL`` IS LOAD-BEARING — A BARE ``REFERENCES`` WEDGES
   COORD'S PRODUCTION DEVICE GC
==========================================================================

Do not "tidy" the clause away, and do not swap it for ``CASCADE``. Without
it both FKs default to ``NO ACTION``, and coord's device garbage collector
— ``gc_hard_delete`` in
``qontinui-coord/crates/coord/src/state_reconciler_watcher.rs`` — runs::

    DELETE FROM coord.devices
     WHERE state = 'abandoned'
       AND last_heartbeat IS NOT NULL
       AND last_heartbeat < now() - <DEVICE_GC_DELETE_AGE_DAYS>

That statement is *one* statement for the whole sweep, so the FIRST
abandoned device that ever wrote a memory does not merely fail to be
collected: the DELETE aborts and the sweep returns ``Err``, collecting
**nothing at all**, every tick, forever. Reproduced on a throwaway
``pgvector/pgvector:pg16`` with a bare ``REFERENCES``::

    ERROR: update or delete on table "devices" violates foreign key
           constraint "memory_records_device_id_fkey" on table
           "memory_records"

The device arm writes a real ``coord.devices`` id on every runner memory
write today, memory rows are TOMBSTONED rather than deleted (so the
referencing row outlives the device by construction), and runner devices
do become abandoned. That function's own docstring states the contract
this column has to join — ``coord.build_events`` / ``coord.device_status``
are CASCADE; claims / ``agent_worktrees`` / status are SET NULL.

``SET NULL`` rather than ``CASCADE`` because a memory is not a fact ABOUT
its device: deleting the machine must not delete what the human learned on
it. Both columns are nullable and the whole facet design is fail-soft
(a write is never rejected for missing provenance), so a degraded-to-NULL
provenance row is exactly the intended coarser state. The same reasoning
is why ``coord.findings.author_device`` was deliberately left FK-FREE as a
"best-effort device link" (``coord_findings``): findings outlive devices,
and so do memories. ``findfacets_02`` carries the identical clause on
``coord.findings.author_user`` for the same reason.

This is the DELETE side only. The INSERT side — a token asserting an id
that names no row — is handled in the application, by
``_existing_provenance`` and the savepoint fallback in
``app/api/v1/endpoints/memory.py``.

WHY THE TWO FKs ARE DROPPED AND RE-ADDED RATHER THAN LEFT TO THE INLINE
``REFERENCES`` CLAUSE
--------------------------------------------------------------------------

The inline clause above reaches a database only when the ``ADD COLUMN``
actually adds something. This revision was first written with a BARE
``REFERENCES`` (``NO ACTION``) and the ``ON DELETE SET NULL`` was added
under the SAME revision id — so on any database that had already run the
earlier form, the ``ADD COLUMN IF NOT EXISTS`` no-ops, the inline clause
is never parsed, and the ``NO ACTION`` constraints survive the "fix".
Reproduced: apply the pre-fix chain, swap in this file, re-run the
revision body, and ``pg_constraint.confdeltype`` reads ``'a'`` on all
three constraints unless they are rebuilt explicitly. The explicit
``DROP CONSTRAINT IF EXISTS`` / ``ADD CONSTRAINT`` pair below is what
makes the delete rule a property of RUNNING this revision rather than a
property of the column being new.

⚠ It repairs only a database on which this revision's body RUNS — a
downgrade→upgrade cycle (``migration-reversal.yml`` walks one on every PR
touching ``backend/alembic/versions/**``) or a partially-applied state.
A database already STAMPED at this revision is never re-run by
``alembic upgrade head`` at all, and repairing that one would take a new
revision. This branch is unmerged, so no such database is known to exist;
the guard is here because "no such database exists" is not something a
migration can check. ``test_a_prefix_database_is_repaired_by_rerunning_the_fixed_revision``
pins both halves.

The names are the ones Postgres derives for an inline column FK
(``<table>_<column>_fkey``), spelled out because
``_PROVENANCE_FK_CONSTRAINTS`` in ``app/api/v1/endpoints/memory.py``
matches the savepoint fallback on exactly those strings.

🚨 THERE IS DELIBERATELY NO ``ALTER COLUMN applies_at DROP DEFAULT`` HERE
==========================================================================

Do not "fix" this by adding one. The plan originally had the ``DROP DEFAULT``
in this migration and the re-vet of 2026-09-19 identified that as a
**production outage**: after the drop, a ``NOT NULL`` column with no default
makes every INSERT that does not name ``applies_at`` fail — and **no writer
names it**. That is the whole argument, and it is a property of the code
rather than of any line number, so confirm it the way it stays confirmable::

    grep -n 'INSERT INTO coord.memory_records' app/services/memory_store.py

Every hit is an explicit column list; none of them contains ``applies_at``.
(The same check on coord's own writers is
``grep -n 'INSERT INTO coord.memory_records' crates/coord/src/*.rs`` in
qontinui-coord, and it returns **zero hits** — coord PROXIES memory writes
to this backend rather than issuing them, so there is no coord-side INSERT
to inspect. Zero is the expected result there, not a mistyped path; the
equivalent recipe on the FINDINGS side, in ``findfacets_02``, does return
hits, and they are what that banner's claim rests on.) Do not replace that
with a count or a line range: both went
stale in the very commit that introduced this banner, and a reader who
follows a citation onto unrelated prose has every reason to discount the
argument it was supporting.

This migration is advertised as behaviour-neutral, and the ``DROP DEFAULT``
would have taken every memory write in the fleet to ``null value in column
"applies_at" violates not-null constraint``.

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
    idx_memory_records_altitude  (tenant_id, applies_at)

⚠ THE ALTITUDE INDEX DELIBERATELY DEVIATES FROM THE PLAN'S §5 SQL, which
spells it ``(applies_at, tenant_id)``. Do not "correct" it back. A
composite b-tree can only use a leading column for a lookup that names
it, and ``applies_at`` is near-CONSTANT here: §2.1 measured 5,681 memory
records in production, 100% at the one value this migration's DEFAULT
backfills them to. Led by ``applies_at`` the index cannot serve a
tenant-only lookup at all, and for ``tenant_id = X AND applies_at = Y``
it has to scan the whole ``'tenant'`` prefix to find the tenant. Led by
``tenant_id`` — the selective column, and the one every retrieval path
in ``memory_store`` already filters on — it serves both shapes.

The swap is free right now: Phase 3 owns the only future reader, so
nothing queries the column yet and there is no plan behaviour to
preserve. Getting it wrong would have cost an online rebuild later.

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
                REFERENCES auth.users(id) ON DELETE SET NULL,
            ADD COLUMN IF NOT EXISTS device_id UUID
                REFERENCES coord.devices(device_id) ON DELETE SET NULL,
            ADD COLUMN IF NOT EXISTS applies_at TEXT NOT NULL DEFAULT 'tenant'
                CONSTRAINT ck_memory_records_applies_at
                CHECK (applies_at IN (
                    'fleet', 'tenant', 'user', 'device', 'session'
                ))
        """
    )
    # Idempotent by NAME, not by the column being new: see the banner above.
    # An `ADD COLUMN IF NOT EXISTS` carries its inline `REFERENCES` only when
    # it actually adds the column, so on a database that ran the pre-fix form
    # of THIS revision the inline `ON DELETE SET NULL` never lands. Rebuilding
    # the constraint makes the delete rule a property of running the revision.
    # DROP and ADD in one statement. Postgres processes ALTER TABLE
    # sub-commands in PASSES, with DROP CONSTRAINT before ADD CONSTRAINT
    # regardless of the order they are written in, so the name is free when it
    # is reused. (Do not carry "left to right" to another multi-subcommand
    # ALTER TABLE -- it is not how Postgres works, and pass ordering does bite
    # elsewhere. Measured: writing the ADD first also succeeds, and the ADD
    # wins, which left-to-right could not produce.)
    op.execute(
        """
        ALTER TABLE coord.memory_records
            DROP CONSTRAINT IF EXISTS memory_records_user_id_fkey,
            ADD  CONSTRAINT memory_records_user_id_fkey
                 FOREIGN KEY (user_id) REFERENCES auth.users(id)
                 ON DELETE SET NULL,
            DROP CONSTRAINT IF EXISTS memory_records_device_id_fkey,
            ADD  CONSTRAINT memory_records_device_id_fkey
                 FOREIGN KEY (device_id) REFERENCES coord.devices(device_id)
                 ON DELETE SET NULL
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
            ON coord.memory_records (tenant_id, applies_at)
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
