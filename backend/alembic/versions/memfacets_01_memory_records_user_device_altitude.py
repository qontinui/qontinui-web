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
* ``coord.memory_records.applies_at TEXT DEFAULT 'tenant'`` — the ALTITUDE
  facet, constrained to ``fleet|tenant|user|device|session`` AND to non-NULL
  by its CHECK (see "Why every statement is in the shape coord's migration
  classifier admits" below for why that is a CHECK and not a catalog
  ``NOT NULL``).

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

WHY EVERY STATEMENT IS IN THE SHAPE COORD'S MIGRATION CLASSIFIER ADMITS
--------------------------------------------------------------------------

coord's merge train lands a migration PR without an operator only when
``qontinui-coord/crates/coord/src/pr_merge/migration_classifier.rs`` proves
every upgrade-path statement additive-safe; anything else parks the PR on
``escalate-path-matched``. The first form of this revision was rejected
there, so each statement is now written in an admitted shape, and each
change is behaviour-neutral for the reason given:

* **The FKs are ``ADD CONSTRAINT … NOT VALID``, not an inline
  ``REFERENCES``.** ``NOT VALID`` skips only the scan of EXISTING rows —
  and every existing row has these columns NULL, because they are created
  in the same revision, so there is nothing for a validation to find. Every
  INSERT/UPDATE from here on is checked exactly as a validated FK checks
  it, and the ``ON DELETE SET NULL`` action (a trigger) fires the same
  either way — which is the delete-side contract the banner above is about.
  ``pg_constraint.convalidated`` reads ``false``; nothing in this repo or in
  coord reads that flag. A ``VALIDATE CONSTRAINT`` is not added here
  because the classifier does not admit it and it would prove nothing on
  all-NULL columns.
* **``applies_at`` is nullable in the catalog and non-NULL by CHECK.**
  ``ADD COLUMN … NOT NULL`` is rejected (it is a table rewrite/lock in the
  general case). ``CHECK (applies_at IS NOT NULL AND …)`` rejects exactly
  the writes ``NOT NULL`` would — a NULL fails the CHECK instead of the
  not-null constraint, ``check_violation`` rather than
  ``not_null_violation`` — and the literal ``DEFAULT 'tenant'`` still fills
  every existing row without a rewrite.
* **There is no ``DROP CONSTRAINT IF EXISTS`` / re-``ADD`` rebuild.** An
  earlier form of this revision rebuilt both FKs so that re-running the body
  over a database that had applied the even-earlier BARE-``REFERENCES`` form
  would repair its ``NO ACTION`` rule. ``DROP`` is never admitted on the
  upgrade path, so that repair is gone. What replaces it is a loud failure
  rather than a silent one: re-running this body over such a database (no
  downgrade first) no-ops the ``ADD COLUMN IF NOT EXISTS`` and then fails
  with ``DuplicateObject`` on the pre-existing ``<table>_<column>_fkey``
  name, so the bad rule is not carried forward unnoticed. A downgrade then
  upgrade DOES repair such a database: the downgrade drops the columns and
  their FKs, and the upgrade re-creates them ``SET NULL``.
  ``test_a_prefix_database_fails_loudly_rather_than_keeping_no_action``
  pins that. This branch is unmerged; no such database is known to exist.
* **``RESET lock_timeout`` is ``SET LOCAL lock_timeout = DEFAULT``.** Every
  ``RESET`` is rejected; the ``SET LOCAL … = DEFAULT`` form is the admitted
  spelling of the same reset.
* **The three indexes are NOT in this revision.** The only index build the
  classifier admits is ``CONCURRENTLY IF NOT EXISTS`` inside
  ``op.get_context().autocommit_block()``, and that block COMMITS the
  transaction mid-``upgrade()``. Here that would make the column and FK DDL
  durable before alembic stamps this revision, so a failed index build
  would leave the FKs in place un-stamped and every later ``upgrade`` would
  then fail on the duplicate ``ADD CONSTRAINT``. They live in their own
  revision, ``memfacets_03_memory_records_indexes``, after ``findfacets_02``,
  whose statements are all ``IF NOT EXISTS`` and so safe to re-run.

The names are the ones Postgres derives for an inline column FK
(``<table>_<column>_fkey``), spelled out because
``_PROVENANCE_FK_CONSTRAINTS`` in ``app/api/v1/endpoints/memory.py``
matches the savepoint fallback on exactly those strings.

🚨 THERE IS DELIBERATELY NO ``ALTER COLUMN applies_at DROP DEFAULT`` HERE
==========================================================================

Do not "fix" this by adding one. The plan originally had the ``DROP DEFAULT``
in this migration and the re-vet of 2026-09-19 identified that as a
**production outage**: after the drop, a column whose CHECK forbids NULL and that has no default
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
would have taken every memory write in the fleet to a violation of the
``applies_at`` non-NULL CHECK.

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

Built in ``memfacets_03_memory_records_indexes`` (see above).

Downgrade drops the three columns (the CHECK constraint
goes with its column). Records survive.

Revision ID: memfacets_01
Revises: overlord_01_interventions
Create Date: 2026-09-19

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "memfacets_01"
down_revision: str | Sequence[str] | None = "overlord_01_interventions"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add ``user_id`` / ``device_id`` / ``applies_at`` (indexes: memfacets_03)."""
    # Both FKs take a SHARE ROW EXCLUSIVE lock on the REFERENCED table
    # (auth.users, coord.devices) for the duration of the ALTER, so bound
    # the wait rather than queueing behind a long reader.
    op.execute("SET LOCAL lock_timeout = '3s'")
    # No inline REFERENCES and no NOT NULL: both are rejected by coord's
    # migration classifier. The FKs follow as ADD CONSTRAINT ... NOT VALID,
    # and the CHECK carries the non-NULL rule (module docstring).
    op.execute(
        """
        ALTER TABLE coord.memory_records
            ADD COLUMN IF NOT EXISTS user_id UUID,
            ADD COLUMN IF NOT EXISTS device_id UUID,
            ADD COLUMN IF NOT EXISTS applies_at TEXT DEFAULT 'tenant'
                CONSTRAINT ck_memory_records_applies_at
                CHECK (applies_at IS NOT NULL AND applies_at IN (
                    'fleet', 'tenant', 'user', 'device', 'session'
                ))
        """
    )
    # NOT VALID skips only the scan of existing rows, all of which are NULL
    # in these brand-new columns. New writes are checked and ON DELETE SET
    # NULL fires exactly as on a validated FK. The names are the ones
    # Postgres derives for an inline FK; memory.py matches on them.
    op.execute(
        """
        ALTER TABLE coord.memory_records
            ADD CONSTRAINT memory_records_user_id_fkey
                FOREIGN KEY (user_id) REFERENCES auth.users(id)
                ON DELETE SET NULL NOT VALID
        """
    )
    op.execute(
        """
        ALTER TABLE coord.memory_records
            ADD CONSTRAINT memory_records_device_id_fkey
                FOREIGN KEY (device_id) REFERENCES coord.devices(device_id)
                ON DELETE SET NULL NOT VALID
        """
    )
    # SET LOCAL is transaction-scoped and env.py wraps the WHOLE run in one
    # transaction, so restore the default rather than let the 3s ceiling leak
    # into later revisions. (`RESET` is not an admitted statement; this is.)
    op.execute("SET LOCAL lock_timeout = DEFAULT")


def downgrade() -> None:
    """Drop the three columns (their FKs and CHECK go with them)."""
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
