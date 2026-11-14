"""coord.agent_status: a session column and its partial lookup index (expand)

Revision ID: coord_agent_status_session_01
Revises: runmem_01
Create Date: 2026-11-11

Phase 1 of plan ``2026-11-11-intent-overlap-excludes-the-callers-whole-device``
(decision D2, as corrected at vet 2026-11-11). This is the EXPAND half of an
expand/contract change to the row identity of ``coord.agent_status``. It adds:

- ``agent_session_id UUID NOT NULL DEFAULT
  '00000000-0000-0000-0000-000000000000'``: the harness session that wrote the
  row. That is a ``coord.agent_sessions.id``, the same id space as
  ``coord.gates.agent_session_id``. The nil UUID means UNATTRIBUTED (coord
  could not prove the writer's session), and every existing row reads it. A
  ``COMMENT ON COLUMN`` says so in the catalog too.
- ``idx_agent_status_session``: ``(agent_session_id) WHERE agent_session_id <>
  <nil>``, for coord's "this session's rows" reads. It covers attributed rows
  only, so it stays the size of the stamped population.

It builds NO unique index, and the primary key ``agent_status_pkey
(device_id, work_unit_id, tenant_id)`` is NOT touched. The session-grain unique
key arrives with the contract, plan Phase 6a, and the section below says why it
cannot arrive sooner.

Why the column exists
=====================

The table is keyed ``(device_id, work_unit_id, tenant_id)`` and records no
session. So coord's intent-overlap reads can only leave out "the caller" by
leaving out the caller's whole DEVICE, and a sibling session on the same device
is never reported as a peer. On 2026-11-11 two sessions on one device did the
same task: each session's intent-overlap read hid the other's live declaration
on the same file (coord finding ``910db579``). Separately, two sessions on one
device that declare the same ``work_unit_id`` share one row, so the later
declaration overwrites the earlier one's globs. A session column fixes the
root. Coord's device-grain workarounds go away with it (plan Phases 2-5).

Why NOT NULL with a nil sentinel, not a nullable column
=======================================================

The column joins the primary key at the contract step, and a primary-key column
is NOT NULL. ``coord`` will be published ``FOR TABLES IN SCHEMA coord`` (plan
``2026-10-15-coord-and-web-data-move-off-aws-by-logical-replication`` D1,
created in its Phase 3). The standing at-head guard
``tests/test_replica_identity_published_schemas.py`` requires a replica
identity on every table in that schema; once published, PostgreSQL requires one
at every moment. Without a primary key it refuses every UPDATE and DELETE on a
published table, and a ``REPLICA IDENTITY USING INDEX`` needs all-NOT-NULL
columns as well (``replident_01``).

The nil UUID keeps today's device-grain collapse for an unattributed writer:
one row per (device, unit, tenant), as a NULL under ``NULLS NOT DISTINCT``
would give, but without a nullable key column, which the primary key could not
hold. Coord already puts a nil-UUID sentinel inside a real composite key for
this shape (``hooks/ledger.rs``). Coord's readers will map the nil UUID to
"unattributed" in one helper, in the ``intent_overlap.rs`` module plan Phase 2
adds. No key column can hold a NULL, so Phase 6a's unique index needs no
``NULLS NOT DISTINCT``.

Expand / contract: the order, and which phase is the contract
=============================================================

1. **Expand (this revision, plan Phase 1).** Add the column and its partial
   lookup index. Nothing reads or writes the column yet. Coord's live upsert
   does not name it, so its inserts take the DEFAULT, and the 3-column primary
   key is still the table's only unique index. So behaviour does not change.
2. **Shape-agnostic write (qontinui-coord, plan Phase 2).** Coord stamps the
   proven session with a write that is correct under BOTH keys. It runs an
   ``UPDATE`` on the 4-tuple, then if needed ``INSERT ... ON CONFLICT DO
   NOTHING`` with NO arbiter, which absorbs a violation of ANY unique index,
   then if needed a ``FOR UPDATE`` read of the 3-tuple row. An arbiter would
   name one key, and a violation of the other would then raise. While the old
   key exists, two live sessions on one unit still share one row, and coord
   reports the displaced session as ``intent_row_shared_with_sibling:`` instead
   of hiding it. Coord reads the column behind its optional-column readiness
   gate. This revision still lands and is applied in production FIRST (served
   policy ``production-and-cost`` ``alembic-sole-authorship``).
3. **Contract (qontinui-web, plan Phase 6a, revision
   ``coord_agent_status_session_02``).** It builds the session-grain key,
   ``uq_agent_status_session_grain`` UNIQUE ``(device_id, work_unit_id,
   tenant_id, agent_session_id)``, CONCURRENTLY. It then SWAPS the primary key
   onto that index in one statement, so the table is never without one::

       ALTER TABLE coord.agent_status
           DROP CONSTRAINT agent_status_pkey,
           ADD CONSTRAINT agent_status_pkey
               PRIMARY KEY USING INDEX uq_agent_status_session_grain

   The index must be a bare unique INDEX, never a ``UNIQUE`` constraint,
   because ``ADD PRIMARY KEY USING INDEX`` refuses an index that already backs
   a constraint. It must also be valid and non-partial, with default ordering.
   The promotion would set NOT NULL on any nullable key column, with a
   full-table scan to verify it. This revision's column is already NOT NULL,
   which spares 6a that scan. The build cannot fail on a duplicate, because the
   3-column key still makes every 4-tuple unique while it runs, and Phase 0
   measured the table at about 4,560 rows (4.3 MB) on 2026-11-11, so the build
   is short. This revision's migration test rehearses the build and the swap
   inside a transaction it rolls back.

   **Why the unique index is not built here.** Coord's live upsert is
   ``INSERT ... ON CONFLICT (device_id, work_unit_id, tenant_id) DO UPDATE``,
   which arbitrates on the primary key only. PostgreSQL checks every OTHER
   unique index of such an insert with an immediate uniqueness check
   (``ExecInsertIndexTuples`` in ``execIndexing.c``). With a second unique index
   present, two concurrent FIRST inserts of one key can therefore end with the
   second failing 23505 on that index instead of taking the update. That window
   would open as soon as a build starts maintaining the index, and close only
   when coord serves Phase 2, whose arbiter-less insert absorbs a conflict on
   any unique index. 6a is opened only after that.

   **The contract must not land before coord SERVES Phase 2.** Coord today
   upserts with ``ON CONFLICT (device_id, work_unit_id, tenant_id)``. Once the
   3-column key is gone, that statement has no arbiter, and every
   ``coord_declare_intent`` and every intent-shaped ``coord_report_status``
   errors. So Phase 6a is opened only by a ``deploy_healthy`` gate on Phase 2's
   land sha. After 6a, Phase 6b (coord) replaces the three-step write with a
   direct ``ON CONFLICT ON CONSTRAINT agent_status_pkey`` upsert.

Locking
=======

``ADD COLUMN`` with a constant default is catalog-only on PG 11+: the default
is stored once in ``pg_attribute.attmissingval``, and no row is rewritten. It
still takes ACCESS EXCLUSIVE for the catalog update, and every
``coord_declare_intent`` and every intent-shaped ``coord_report_status`` writes
this table. A queued ACCESS EXCLUSIVE request blocks every reader and writer
behind it, so the wait is bounded with ``SET LOCAL lock_timeout = '3s'``. The
``COMMENT ON COLUMN`` runs in the same transaction, under the lock the ``ADD
COLUMN`` already holds. The ``autocommit_block()`` that follows COMMITs the
batch transaction. That releases the lock and ends the ``SET LOCAL``, so the
bound reaches nothing else.

The partial index is built ``CONCURRENTLY`` inside ``autocommit_block()``, so
the build holds no SHARE lock that would block coord's writes. On first
application every row is nil, so it indexes nothing.

A killed CONCURRENTLY build leaves an INVALID index of the same name. ``IF NOT
EXISTS`` alone would keep it: no read can use it, and once its build has
marked it ready, every write pays to maintain it. So before the build the revision probes ``pg_index.indisvalid``.
On an INVALID index of its own name it logs a warning naming the index, then
runs a plain ``REINDEX INDEX``, which rebuilds it VALID in place. This is the
``coord_agent_questions_effect`` pattern. Nothing is dropped, so ``upgrade()``
holds no destructive statement.

Unlike that precedent, the REINDEX runs in a transaction of its own under
``SET LOCAL lock_timeout = '3s'``. Per the PostgreSQL 16 source (``indexcmds.c``
``ReindexIndex`` takes the table's SHARE lock first; ``plancat.c`` opens every
index before skipping invalid ones): queued behind
an open writer, a plain REINDEX waits for the table's SHARE lock and blocks new
writers. Once it holds that lock, it also blocks new readers, because the
planner locks every index of the table, the invalid one included. That covers
its wait for the index lock behind an open reader, and the rebuild itself.

The bound covers the lock WAITS only. On a busy table the re-run fails loudly
instead of stalling coord's writes behind a queued REINDEX, and the operator
re-runs it. Once its locks are granted, a REINDEX holds them for a full rebuild
of the index, and no timeout shortens that.

The bound is ``SET LOCAL`` so that it ends with the REINDEX's own transaction
and never reaches the CONCURRENTLY build that follows. A CONCURRENTLY build's
waits for older transactions are lock waits too. Under a ``lock_timeout`` a
healthy build fails, and leaves the very INVALID index this guards against
(PostgreSQL 16 source: ``indexcmds.c`` waits through ``VirtualXactLock``,
which ``LockAcquire``s, and ``proc.c`` applies ``lock_timeout`` to that wait).

It is a plain REINDEX, not ``REINDEX INDEX CONCURRENTLY``. A failed
CONCURRENTLY reindex leaves a second INVALID index, ``<name>_ccnew``, beside
the original. The ``indisvalid`` probe looks up only the index's own name, so
it never sees that leftover, and no re-run would clean it up. A CONCURRENTLY
reindex also gives the index a new oid (PostgreSQL 16 ``indexcmds.c``: the
``ccnew`` name, a new index relation, and the swap that gives it the old
name).

Every statement is a plain SQL literal that names ``coord.``, never an
f-string. The ``alembic-schema-arg-gate`` hook audits the ``ALTER TABLE`` and
``CREATE`` / ``DROP INDEX`` literals passed to ``op.execute``. It does not see
the ``REINDEX`` statement: that reaches ``op.execute`` through the helper's
parameter, and the hook has no ``REINDEX`` pattern. Coord's migration
classifier rejects this file on several counts: the ``indisvalid`` probe and
``downgrade()``'s primary-key probe both run SQL through the bind rather than
``op.execute``; the REINDEX helper's ``op.execute(sql)`` takes a non-literal
argument; and its static ``BEGIN`` / ``COMMIT`` / ``ROLLBACK`` statements
reach the classifier's fail-closed catch-all. So the PR takes the
``alembic/versions`` escalate path, which the plan clears with
``coord_submit_escalate_evidence``.

Chain
=====

``down_revision`` is ``coord_ci_runs_head_sha_idx_01``, the single head on
qontinui-web ``origin/main`` ``5314f8bbe`` at authoring time. It is computed
from the chain, not reserved. Open PR #2018 adds
``coord.agent_status.intent_globs_declared`` off an older head. Whichever of
the two lands second re-points its ``down_revision``, because the required
``web-guards`` check (its ``alembic-heads-pr`` step) owns the chain.

Downgrade
=========

``downgrade()`` drops the partial index (CONCURRENTLY), then the column. The
rows survive and the 3-column primary key is untouched, so the table returns to
its parent shape. Any stamped session is lost. It has two preconditions:

- **6a is unapplied.** After 6a the primary key includes this column, and
  ``DROP COLUMN`` would silently drop the primary key along with it (ALTER
  TABLE: "Indexes and table constraints involving the column will be
  automatically dropped as well"). 6a's own downgrade, which swaps the 3-column key back, must run
  first. ``downgrade()`` checks this itself, before it changes anything: when
  ``agent_session_id`` is a column of the primary key (6a applied, or the
  database stamped back past it), it raises and leaves the table as it is.
- **No serving coord build writes the column without a fallback.** Once coord
  writes ``agent_session_id``, dropping the column fails every one of those
  writes unless the writer degrades on ``undefined_column``. Plan Phase 2
  specifies that degrade (``pg_error::is_missing_column_error``). Against a
  coord build without it, roll coord back first.

The partial index is dropped CONCURRENTLY in its own autocommit block before
the bounded ``DROP COLUMN``. If that ``DROP COLUMN`` then times out on its
3s lock wait, the index is gone while ``alembic_version`` still records this
revision: re-run the downgrade (it is idempotent), do not reverse it with an
``upgrade``.
"""

import contextlib
import logging
from collections.abc import Sequence

from sqlalchemy import text

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_agent_status_session_01"
down_revision: str | Sequence[str] | None = "runmem_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# The logger alembic's own "Running upgrade" lines go to.
logger = logging.getLogger("alembic.runtime.migration")


def _index_is_invalid(index_name: str) -> bool:
    """True when ``coord.<index_name>`` exists and is INVALID (a killed build)."""
    return bool(
        op.get_bind()
        .execute(
            text(
                """
                SELECT NOT i.indisvalid
                  FROM pg_index i
                  JOIN pg_class c ON c.oid = i.indexrelid
                  JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE n.nspname = 'coord' AND c.relname = :idx
                """
            ),
            {"idx": index_name},
        )
        .scalar()
    )


def _session_column_is_in_primary_key() -> bool:
    """True when ``agent_session_id`` is a column of the table's primary key.

    That is plan Phase 6a's key swap, applied or stamped back past.
    """
    return bool(
        op.get_bind()
        .execute(
            text(
                """
                SELECT EXISTS (
                    SELECT 1
                      FROM pg_constraint c
                      JOIN pg_attribute a
                        ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
                     WHERE c.conrelid = 'coord.agent_status'::regclass
                       AND c.contype = 'p'
                       AND a.attname = 'agent_session_id'
                )
                """
            )
        )
        .scalar()
    )


def _reindex_in_own_transaction(sql: str) -> None:
    """Run one plain ``REINDEX`` in its own transaction, lock wait bounded to 3 s.

    Called inside ``autocommit_block()``. ``SET LOCAL`` ends at this
    transaction's COMMIT or ROLLBACK, so the bound never reaches the
    CONCURRENTLY build that follows (see the docstring's Locking section).
    """
    op.execute("BEGIN")
    try:
        op.execute("SET LOCAL lock_timeout = '3s'")
        op.execute(sql)
    except BaseException:
        with contextlib.suppress(Exception):
            op.execute("ROLLBACK")
        raise
    op.execute("COMMIT")


def upgrade() -> None:
    """Add ``agent_session_id``, then build its partial index CONCURRENTLY."""
    # Bound the ACCESS EXCLUSIVE wait of the catalog-only ADD COLUMN. The
    # autocommit_block below COMMITs the batch transaction, which ends this
    # SET LOCAL, so it cannot reach another statement or revision.
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute(
        """
        ALTER TABLE coord.agent_status
            ADD COLUMN IF NOT EXISTS agent_session_id UUID NOT NULL
                DEFAULT '00000000-0000-0000-0000-000000000000'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.agent_status.agent_session_id IS
            'The harness session (a coord.agent_sessions.id) that wrote this row. Sentinel: the nil UUID 00000000-0000-0000-0000-000000000000 means unattributed, because coord could not prove which session wrote it. Never NULL. Plan 2026-11-11-intent-overlap-excludes-the-callers-whole-device, Phase 1.'
        """
    )

    with op.get_context().autocommit_block():
        # A killed CONCURRENTLY build leaves an INVALID index that IF NOT EXISTS
        # would keep. REINDEX rebuilds it VALID in place.
        if _index_is_invalid("idx_agent_status_session"):
            logger.warning(
                "coord.idx_agent_status_session is INVALID, the leftover of a "
                "killed CONCURRENTLY build: rebuilding it with REINDEX"
            )
            _reindex_in_own_transaction("REINDEX INDEX coord.idx_agent_status_session")
        # "This session's rows". Nil (unattributed) rows are left out, so the
        # index holds only rows coord stamped with a proven session. A
        # parameterized `agent_session_id = $1` read should restate
        # `agent_session_id <> '00000000-0000-0000-0000-000000000000'`, because a
        # GENERIC plan cannot prove the index predicate without it. Postgres
        # runs a generic plan only when it is cheaper than the custom plans'
        # average, so an un-restated read keeps being planned as a custom plan,
        # which does use the index. It Seq Scans only under force_generic_plan,
        # or on a table small enough that a Seq Scan costs no more.
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_agent_status_session
            ON coord.agent_status (agent_session_id)
            WHERE agent_session_id <> '00000000-0000-0000-0000-000000000000'
            """
        )


def downgrade() -> None:
    """Drop the partial index, then the column. Rows and the 3-column key survive."""
    # Fail closed before changing anything. After plan Phase 6a this column is
    # in the primary key, and DROP COLUMN would silently drop the key with it.
    if _session_column_is_in_primary_key():
        raise RuntimeError(
            "coord_agent_status_session_01 downgrade refused: agent_session_id is "
            "a column of the coord.agent_status primary key, so plan Phase 6a's "
            "key swap (coord_agent_status_session_02) is in place, or the "
            "database was stamped back past it. DROP COLUMN would silently drop "
            "the primary key with it. Downgrade 6a first: it swaps the 3-column "
            "key back."
        )
    with op.get_context().autocommit_block():
        op.execute("DROP INDEX CONCURRENTLY IF EXISTS coord.idx_agent_status_session")
    # Bound the ACCESS EXCLUSIVE wait, as upgrade() does. env.py's
    # on_version_apply hook (_reset_revision_settings) already RESETs
    # lock_timeout after every applied step; this RESET only keeps the bound
    # visibly scoped to the DROP COLUMN.
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute("ALTER TABLE coord.agent_status DROP COLUMN IF EXISTS agent_session_id")
    op.execute("RESET lock_timeout")
