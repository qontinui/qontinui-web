"""Provenance + altitude facets on coord memories and findings; operator-inbox index.

ONE revision carrying what four unlanded revisions used to carry, folded
together so the change lands as a single migration on a single head:

* ``memfacets_01`` / ``findfacets_02`` / ``memfacets_03`` — Phase 1 of plan
  ``qontinui-dev-notes/plans/2026-08-06-user-and-device-facets-on-memories-and-findings.md``
  (§5), from qontinui-web#1404 (adopted as #1626, split as #1829 / #1830).
* ``coord_agent_questions_operator_pending_idx`` — the backend half of plan
  ``2026-09-12-a-correctly-escalated-question-is-unreachable-in-the-operator-inbox``,
  from qontinui-web#1461 (adopted as #1627).

None of the four ever reached ``main`` or a deployed database, so their ids
are retired rather than kept. They were kept apart only because "Migration
Reversal Tested" and coord's escalate-evidence door each take ONE added
migration per PR; as separate PRs they forked each other's alembic chain
every time one of them or anything else landed. Additive, nullable where it
can be, no behaviour change on its own.

What this adds
==========================================================================

* ``coord.memory_records.user_id UUID NULL`` + FK to ``auth.users(id)``
  ``ON DELETE SET NULL`` — the human the record is attributed to, derived
  server-side from the authenticated caller (the device JWT's own
  ``user_id`` claim), NEVER from the request body. §4.1/§6 requirement 1.
* ``coord.memory_records.device_id UUID NULL`` + FK to
  ``coord.devices(device_id)`` ``ON DELETE SET NULL`` — the machine the
  record came from, from the verified ``device_id`` claim.
* ``coord.memory_records.applies_at TEXT DEFAULT 'tenant'`` — the ALTITUDE
  facet, constrained to ``fleet|tenant|user|device|session`` AND to non-NULL
  by its CHECK (see "Why every statement is in the shape coord's migration
  classifier admits" below for why that is a CHECK and not a catalog
  ``NOT NULL``).
* ``coord.findings.author_user UUID NULL`` + FK to ``auth.users(id)``
  ``ON DELETE SET NULL`` — the human behind ``author_device``, which the
  table has carried and populated since ``coord_findings`` (§2.2).
* ``coord.findings.applies_at TEXT DEFAULT 'tenant'`` — the same altitude
  facet with the same CHECK.
* Three partial indexes on ``coord.memory_records`` (see "Indexes") and
  ``idx_agent_questions_operator_pending`` on ``coord.agent_questions``
  (see "The operator-inbox index").

The provenance columns are NULLABLE and stay that way: a caller with no
device identity (operator bearer, service token, CI) writes NULLs and the row
is simply less filterable. **A write is never rejected for missing
provenance** — a memory that fails to save is worse than one that is coarsely
scoped (§4.1 item 3).

Statement order — why the FKs come LAST
==========================================================================

coord's migration classifier admits exactly one index build:
``CREATE INDEX CONCURRENTLY IF NOT EXISTS`` inside
``op.get_context().autocommit_block()``, and that block COMMITS the
transaction ``env.py`` opened. So ``upgrade()`` runs in three steps:

1. In the migration transaction: the five ``ADD COLUMN IF NOT EXISTS``
   (with their CHECKs), under a 3s ``lock_timeout``.
2. The autocommit block, which first commits step 1, then builds the four
   indexes ``CONCURRENTLY IF NOT EXISTS``.
3. In the fresh transaction alembic opens after the block: the three
   ``ADD CONSTRAINT … NOT VALID`` FKs, committed together with this
   revision's ``alembic_version`` stamp.

Every statement that can become durable BEFORE the stamp (steps 1 and 2) is
``IF NOT EXISTS``, so a build that fails or is killed leaves a database the
next ``upgrade`` simply carries on from. The only non-idempotent statements —
the FK adds, which have no ``IF NOT EXISTS`` form — commit atomically with
the stamp, so they either all exist and the revision is stamped, or neither.
(That is why the separate revisions used to exist: with the FKs BEFORE the
index block, a failed build left FKs in place un-stamped and every later
``upgrade`` failed on the duplicate ``ADD CONSTRAINT``.)

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
and so do memories. ``coord.findings.author_user`` carries the identical
clause, below, for the same reason.

This is the DELETE side only. The INSERT side — a token asserting an id
that names no row — is handled in the application, by
``_existing_provenance`` and the savepoint fallback in
``app/api/v1/endpoints/memory.py``.

Why every statement is in the shape coord's migration classifier admits
==========================================================================

coord's merge train lands a migration PR without an operator only when
``qontinui-coord/crates/coord/src/pr_merge/migration_classifier.rs`` proves
every upgrade-path statement additive-safe; anything else parks the PR on
``escalate-path-matched``. The first form of ``memfacets_01`` was rejected
there, so each statement is written in an admitted shape, and each change
is behaviour-neutral for the reason given:

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
  earlier form of ``memfacets_01`` rebuilt both FKs so that re-running the body
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
  pins that. No such database is known to exist.
* **``RESET lock_timeout`` is ``SET LOCAL lock_timeout = DEFAULT``.** Every
  ``RESET`` is rejected; the ``SET LOCAL … = DEFAULT`` form is the admitted
  spelling of the same reset.
* **The indexes are built CONCURRENTLY inside the autocommit block**, the
  only index shape the classifier admits; see "Statement order" above for
  why that block forces the FKs to the end of ``upgrade()``.

The FK names are the ones Postgres derives for an inline column FK
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
equivalent recipe on the FINDINGS side —
``grep -n 'INSERT INTO coord.findings' crates/coord/src/*.rs`` — DOES return
hits, because coord writes findings itself; every hit is an explicit column
list and none of them names ``applies_at``.) Do not replace that
with a count or a line range: both went
stale in the very commit that introduced this banner, and a reader who
follows a citation onto unrelated prose has every reason to discount the
argument it was supporting.

This migration is advertised as behaviour-neutral, and a ``DROP DEFAULT`` on
either table would have taken every memory or finding write in the fleet to a
violation of the ``applies_at`` non-NULL CHECK.

The ``DROP DEFAULT`` belongs to **Phase 3's migration 2b**, landing together
with the API change that makes ``applies_at`` a required field on the wire.
The default is not a back-compat shim: it is the mechanism that lets DDL land
ahead of the code that will supply the value, which is the deploy ordering
§5 mandates (web migration → coord, never the reverse).

The DEFAULT also backfills every existing row to ``'tenant'`` in a single
statement, which is semantically identical to today (§2.1 measured 5,681
memory records, 100% ``scope='tenant'``).

Findings backfill — deferred to Phase 3
==========================================================================

The first form of ``findfacets_02`` carried two ``UPDATE``s::

    UPDATE coord.findings SET applies_at =
      CASE scope WHEN 'fleet-infra' THEN 'fleet' ELSE 'tenant' END;
    UPDATE coord.findings f SET author_user = d.user_id
      FROM coord.devices d WHERE d.device_id = f.author_device
       AND d.user_id IS NOT NULL;

They are REMOVED, because coord's migration classifier rejects every DML
statement on the upgrade path ("data DML / backfill has unbounded blast
radius") and this change must land without an operator override. That is
behaviour-neutral today: nothing reads ``coord.findings.applies_at`` or
``author_user`` until Phase 3 (no reader in this repo, none in coord), and
the ``DEFAULT 'tenant'`` already gives every existing row the value the
``ELSE`` arm would have. What is NOT yet true without the backfill:

* rows with ``scope = 'fleet-infra'`` read ``applies_at = 'tenant'`` rather
  than ``'fleet'``;
* ``author_user`` is NULL on every pre-existing finding, including those
  whose ``author_device`` has a bound user.

**Phase 3 inherits both statements as a requirement** — it is the phase that
introduces the first reader, so it must run them (as a coord-side catch-up
before the reader is armed, or as its own migration that goes through
operator review) before trusting either column on historical rows. The
mapping caveat stands for whoever runs it: ``coord.findings.scope`` has NO
CHECK constraint, so the ``ELSE 'tenant'`` arm is load-bearing — an
unenumerated ``scope`` must still map to a non-NULL value.

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

The operator-inbox index
==========================================================================

- ``idx_agent_questions_operator_pending``
  ``ON coord.agent_questions(tenant_id, created_at DESC)
  WHERE responded_at IS NULL AND audience = 'operator'``

It is the exact mirror image of ``idx_agent_questions_agent_pending``, which
``coord_agent_questions_audience`` created for ``audience = 'agent'`` — same
table, same key, same predicate shape, opposite audience. That revision's
docstring is the authority for every design choice repeated here; this
section records only what differs.

Why the operator inbox needs its own index
--------------------------------------------------------------------------

The audience column split the escalation queue, but only the AGENT side got a
selective index. The census in ``coord_agent_questions_audience``'s header,
measured against production 2026-08-28: **23,700 pending rows**, 23,258 of
them ``pr_fix``. Re-read 2026-09-12 against the audience split, the shape is
lopsided — 23,258 ``pr_fix`` rows carry ``audience='agent'`` and only ~442
rows carry ``audience='operator'``. So the operator's own inbox is **under 2%**
of the pile it has to be found in.

A sibling change adds an ``?audience=operator`` filter to coord's pending
read door. Without this index that filter has no selective path to ride:

- ``idx_agent_questions_agent_pending`` is predicated on
  ``audience = 'agent'`` and therefore cannot serve an ``audience =
  'operator'`` query at all — a partial index is only usable when the
  planner can prove the query implies its predicate, and here it implies the
  negation.
- ``idx_agent_questions_pending`` (``coord_agent_questions``:95) is
  ``ON (created_at DESC) WHERE responded_at IS NULL``, audience-blind AND
  **not led by ``tenant_id``**. Riding it means walking pending rows
  newest-first and re-checking both ``tenant_id`` and ``audience`` per fetched
  row — across a population that is ~98% the wrong audience. That is the
  "poor index" this index exists to remove, and it gets worse monotonically:
  the agent share is the one that grows (244-1,461 new rows/day over the week
  measured in the sibling's header).

Key and predicate, and why they match the sibling exactly
--------------------------------------------------------------------------

``(tenant_id, created_at DESC)``. ``tenant_id`` is ``NOT NULL`` on this table
(``coord_tenant_scope_columns`` then ``coord_tenant_id_not_null``, whose
``_LOCKED_TABLES`` names ``agent_questions``) and coord's pending read filters
it unconditionally — ``agent_questions.rs``:2473 carries the comment
*"Tenant filter (`tenant_id = $4`) is unconditional."* — so the leading
equality column lets ONE index scan satisfy the tenant predicate and the
``ORDER BY created_at DESC LIMIT`` together, instead of re-checking the tenant
per fetched row. (The line number was measured 2026-09-22 and has moved
before — grep the text, not the number.) Identical reasoning to the sibling; the key
is deliberately the same so the two audiences have symmetric read paths and a
future change to one is an obvious change to both.

The predicate is IMMUTABLE (two constant comparisons, no ``now()`` or other
non-IMMUTABLE function), so there is no IMMUTABLE-predicate hazard.

Unlike the sibling, this index is **not** empty on creation: ``audience``
defaults to ``'operator'``, so every pre-split row qualifies and the build
indexes the whole pending population. That is a one-time build cost, paid
CONCURRENTLY (see Locking below) so writers are never blocked by it, and it is
the point — the entries are what the
operator inbox reads.

No column, no constraint, no backfill on agent_questions
--------------------------------------------------------------------------

The column, its CHECK and the agent-side index all shipped in
``coord_agent_questions_audience``. Nothing here re-declares them, and
**no row is reclassified**: this index reads the audience split, it does
not change it. Deliberately no row deletion or retirement either — the pile-up
is a design property (~16 autonomous producers, zero autonomous drains) and
pruning it is a separate decision with its own evidence, not a side effect of
adding an index.

Locking and the INVALID-index trap
==========================================================================

``CONCURRENTLY`` takes SHARE UPDATE EXCLUSIVE, which conflicts with no DML:
readers and writers proceed throughout every build. There is no
``lock_timeout`` around the block, deliberately: each autocommit statement is
its own transaction, so a ``SET LOCAL`` would end before the build starts,
and the session-scoped spellings are rejected by the classifier. A build does
wait for transactions older than it; a long-held one delays the deploy, it
does not stall the table. ``idx_agent_questions_operator_pending`` is NOT
empty on creation (``audience`` defaults to ``'operator'``, so every pre-split
pending row qualifies); the three memory-record indexes cover a ~5.7k-row
table and take milliseconds.

⚠ A KILLED or failed CONCURRENTLY build leaves an INVALID index of the same
name, which ``IF NOT EXISTS`` then skips — the revision reports success while
the index never serves a query (precedent ``coord_alerts_flakeidx_01``).
Dropping a leftover on the upgrade path is not done here because the
classifier rejects any ``DROP`` there. Verify with ``pg_index.indisvalid``,
not existence; if one is invalid, ``DROP INDEX CONCURRENTLY IF EXISTS`` it
and re-run.

Downgrade
==========================================================================

Drops the four indexes (``CONCURRENTLY``, in an autocommit block), then the
five columns — their FKs and CHECKs go with them. Memories, findings and
questions survive; ``coord.findings.scope`` and ``agent_questions.audience``
are never touched.

``down_revision`` is ``leader_worker_runs_01``, the single head of
``origin/main`` at ``d23b7da17``, computed with
``scripts/ci/count_alembic_heads.py`` (``HEAD_COUNT=1``) rather than reserved:
``alembic-heads-pr`` owns the chain, and coord re-points a single-parent
revision mechanically when ``main`` moves.

Revision ID: provfacets_01
Revises: leader_worker_runs_01
Create Date: 2026-10-14

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "provfacets_01"
down_revision: str | Sequence[str] | None = "leader_worker_runs_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Columns, then the four CONCURRENTLY indexes, then the three FKs."""
    # Step 1 -- columns. ADD COLUMN takes ACCESS EXCLUSIVE on the table for
    # the CHECK's scan; bound the wait rather than queueing behind a long
    # reader. No inline REFERENCES and no NOT NULL: both are rejected by
    # coord's migration classifier (module docstring).
    op.execute("SET LOCAL lock_timeout = '3s'")
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
    op.execute(
        """
        ALTER TABLE coord.findings
            ADD COLUMN IF NOT EXISTS author_user UUID,
            ADD COLUMN IF NOT EXISTS applies_at TEXT DEFAULT 'tenant'
                CONSTRAINT ck_findings_applies_at
                CHECK (applies_at IS NOT NULL AND applies_at IN (
                    'fleet', 'tenant', 'user', 'device', 'session'
                ))
        """
    )
    # (`RESET` is not an admitted statement; this is.)
    op.execute("SET LOCAL lock_timeout = DEFAULT")

    # Step 2 -- indexes. The block COMMITS step 1 first; every statement in
    # it is IF NOT EXISTS, so a re-run after a failed build carries on.
    # Static literals, never f-strings: coord's classifier and the
    # alembic-schema-arg-gate pre-commit hook both parse the SQL text.
    with op.get_context().autocommit_block():
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_memory_records_user
                ON coord.memory_records (user_id)
                WHERE user_id IS NOT NULL AND is_tombstone = false
            """
        )
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_memory_records_device
                ON coord.memory_records (device_id)
                WHERE device_id IS NOT NULL AND is_tombstone = false
            """
        )
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_memory_records_altitude
                ON coord.memory_records (tenant_id, applies_at)
                WHERE is_tombstone = false
            """
        )
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS
                idx_agent_questions_operator_pending
            ON coord.agent_questions (tenant_id, created_at DESC)
            WHERE responded_at IS NULL AND audience = 'operator'
            """
        )

    # Step 3 -- FKs, in the transaction alembic opens after the block, so
    # they commit atomically with this revision's stamp. NOT VALID skips only
    # the scan of existing rows, all of which are NULL in these brand-new
    # columns; new writes are checked and ON DELETE SET NULL fires exactly as
    # on a validated FK. Each FK takes SHARE ROW EXCLUSIVE on the REFERENCED
    # table (auth.users, coord.devices), so bound the wait. The names are the
    # ones Postgres derives for an inline FK; memory.py matches on them.
    op.execute("SET LOCAL lock_timeout = '3s'")
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
    op.execute(
        """
        ALTER TABLE coord.findings
            ADD CONSTRAINT findings_author_user_fkey
                FOREIGN KEY (author_user) REFERENCES auth.users(id)
                ON DELETE SET NULL NOT VALID
        """
    )
    # SET LOCAL is transaction-scoped; restore the default rather than let
    # the 3s ceiling leak into later revisions.
    op.execute("SET LOCAL lock_timeout = DEFAULT")


def downgrade() -> None:
    """Drop the four indexes, then the five columns (FKs/CHECKs go with them)."""
    with op.get_context().autocommit_block():
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS coord.idx_agent_questions_operator_pending"
        )
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS coord.idx_memory_records_altitude"
        )
        op.execute("DROP INDEX CONCURRENTLY IF EXISTS coord.idx_memory_records_device")
        op.execute("DROP INDEX CONCURRENTLY IF EXISTS coord.idx_memory_records_user")
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute(
        """
        ALTER TABLE coord.findings
            DROP COLUMN IF EXISTS applies_at,
            DROP COLUMN IF EXISTS author_user
        """
    )
    op.execute(
        """
        ALTER TABLE coord.memory_records
            DROP COLUMN IF EXISTS applies_at,
            DROP COLUMN IF EXISTS device_id,
            DROP COLUMN IF EXISTS user_id
        """
    )
    op.execute("SET LOCAL lock_timeout = DEFAULT")
