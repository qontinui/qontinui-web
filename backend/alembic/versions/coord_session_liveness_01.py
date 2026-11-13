"""coord session liveness (expand): closed_reason, last_seen meaning, handle status

Revision ID: coord_session_liveness_01
Revises: coord_ci_runs_head_sha_idx_01
Create Date: 2026-11-13

Phase 4 (the EXPAND migration) of plan
``2026-11-12-coord-closes-a-live-sessions-row-because-last-seen-is-not-a-heartbeat``.

coord authors zero ``coord.*`` DDL (served policy ``production-and-cost``
``alembic-sole-authorship``), so the schema the plan's coord phases write and
read lands here, and this revision must be APPLIED in production, and confirmed
there through the migration-state door, before the coord PR of plan Phase 5
(the first that names ``closed_reason``) deploys.

Why
===

coord's handle sweep closed three live sessions' ``coord.agent_sessions`` rows
because it read ``last_seen`` as a heartbeat. Once a row is closed nothing says
WHICH writer closed it, so each occurrence had to be traced by hand, and
``coord.session_handles.status`` could contradict its own ``closed_at`` with
nothing to refuse it. This revision gives the plan's coord phases the columns
and constraints they need:

``coord.agent_sessions``
------------------------

* ``closed_reason TEXT NULL`` -- which writer closed the row, set by coord's
  closers from plan Phase 5 on (until then no writer sets it). CHECK
  ``ck_agent_sessions_closed_reason`` limits it to the plan's vocabulary:
  ``handle_autoclose`` / ``superseded_reap`` (the sweep's pass 4, its
  closed-handle and superseded arms), ``rebind_reap`` (the rebind-time reap),
  ``stamp_ended_insert`` (the session-identity stamp's ended insert),
  ``stamp_reported_ended`` (plan D4's guarded stamp close, added at vet) and
  ``unrecorded``.
* Every row closed when this revision runs is backfilled to ``unrecorded``.
  That is the honest value: no writer recorded why. Only rows whose reason is
  still NULL are touched, so a re-run never overwrites a reason a writer set.
* ``COMMENT ON COLUMN last_seen`` restates the column as plan D2 decided: the
  latest POSITIVE EVIDENCE that the session is alive (an id-bearing coord write
  or a live harness observation), not a heartbeat. That is the contract the
  plan's coord phases bring coord to, not coord as this revision found it, so
  the comment dates each part by phase. At qontinui-coord ``origin/main``
  edca5ef1 (2026-11-12) the identity stamp never writes ``last_seen`` on an
  existing row (Phase 1 makes a live stamp move it), and sweep pass 4 still
  closes a session on ``last_seen`` older than its cutoff alone (Phase 3 adds
  the heartbeat plane to it and to the rebind reap; Phase 7 moves the other
  liveness readers to a verdict over every plane).

``coord.session_handles.status``
--------------------------------

* A NULL ``status`` is backfilled to ``closed`` where ``closed_at`` is set and
  ``stale`` otherwise.
* ``SET DEFAULT 'live'`` comes BEFORE ``SET NOT NULL`` (added at vet): three of
  coord's DB-test fixtures insert handles without ``status``
  (``device_reaper.rs``, ``mcp/tools.rs``, ``pr_merge/stuck_author_nudge.rs``)
  and would fail 23502 once coord CI's migrator pin includes this revision.
  ``'live'`` is what coord's own mint writes.
* ``SET NOT NULL``, then CHECK ``ck_session_handles_status``
  (``status IN ('live', 'stale', 'closed')``) and CHECK
  ``ck_session_handles_status_closed_at``
  (``(status = 'closed') = (closed_at IS NOT NULL)``): a handle whose status
  contradicts its own close is refused by the database.

Production sizing (read-only, 2026-11-13)
=========================================

Measured through the production read door (ECS Exec into the ``web``
container, psycopg2 with ``set_session(readonly=True)``; the session read
``transaction_read_only = on``), on PostgreSQL 16.13 at this revision's parent:

* ``coord.agent_sessions``: 24,063 rows, 10,654 of them closed (458 closed in
  the preceding 24 h), a 7.6 MB heap. The ``unrecorded`` backfill is therefore
  one bounded statement, not a batched loop: on a replica of that size at this
  revision's parent (local PostgreSQL 16, every index present, 5.6 MB heap) it
  updated the 10,654 rows in 0.21 s, under row locks only (step 2 below).
* ``coord.session_handles``: 3,159 rows, NONE with a NULL ``status``, none with
  a value outside the vocabulary, and none that would violate either handle
  CHECK after the backfill rule. The handle backfill is a no-op in production;
  it is here for every other database.

Writers of ``coord.session_handles``
====================================

Read at qontinui-coord ``origin/main`` 7eaeef4c (2026-11-12). Every production
writer satisfies both handle CHECKs: the bind sets ``status = 'live'`` and
``closed_at = NULL`` together; the mint inserts ``'live'`` with no
``closed_at``; sweep pass 1 sets ``'live'`` only where ``closed_at IS NULL``;
pass 2 sets ``'stale'`` only where ``closed_at IS NULL``; pass 3 sets
``'closed'`` and ``closed_at`` together. qontinui-runner and qontinui-web write
the table nowhere. The three status-less test fixtures above insert no
``closed_at`` either, so the default makes them ``('live', NULL)``, which both
CHECKs admit. If any writer this census missed contradicts a CHECK, the
database refuses it from the moment this revision commits, which is the point.

Transaction shape and locking
=============================

``env.py`` runs a whole upgrade batch in one transaction. Here that would hold
``coord.agent_sessions``'s ``ACCESS EXCLUSIVE`` lock (taken by the ``ADD
COLUMN``) through a 10,654-row backfill, and hold both tables' locks at once,
which coord's own transactions take in BOTH orders (a rebind and sweep pass 1
lock the handle before the session; pass 4 locks the session first), so a
deadlock could abort either transaction (PostgreSQL aborts the backend whose
deadlock check first sees the cycle). So the revision runs as four steps, one
table at a time:

1. ``coord.agent_sessions`` DDL under ``SET LOCAL lock_timeout = '3s'``: the
   column ``ADD`` (nullable, no default: catalog-only), its CHECK ``NOT VALID``
   (no scan; enforced on every write from here) and both comments.
2. ``autocommit_block()`` -- entering it COMMITS step 1, releasing the lock.
   The ``unrecorded`` backfill then runs as its own transaction under row locks
   only, and ``VALIDATE CONSTRAINT`` scans under ``SHARE UPDATE EXCLUSIVE``,
   which blocks no reader or writer.
3. ``coord.session_handles`` DDL in the transaction alembic reopens, again
   under ``SET LOCAL lock_timeout = '3s'``: ``SET DEFAULT`` first (its
   ``ACCESS EXCLUSIVE`` lock means no writer can insert a NULL status between
   the backfill and ``SET NOT NULL``), the backfill, ``SET NOT NULL`` (a scan of
   3,159 rows) and both CHECKs ``NOT VALID``.
4. A second ``autocommit_block()`` commits step 3 and validates both CHECKs.

Each ``SET LOCAL`` ends with the transaction the following block commits, and
``env.py``'s ``_reset_revision_settings`` RESETs ``lock_timeout`` after the
revision anyway, so neither group restores it. Nothing inside an autocommit
block is bounded by it.

Partial apply and re-run
========================

Every step is idempotent: ``ADD COLUMN IF NOT EXISTS``; each CHECK is added
only when the table has no CHECK of that name (``pg_constraint`` is read first;
PostgreSQL has no ``ADD CONSTRAINT IF NOT EXISTS``), and a constraint of that
name that is not a CHECK makes the add fail loudly; both backfills touch only
rows still NULL; ``SET DEFAULT`` / ``SET NOT NULL`` / ``COMMENT`` / ``VALIDATE``
repeat harmlessly. So an upgrade that fails part-way -- a lock timeout, or a
``VALIDATE`` refusing a row a writer wrote after the census above -- leaves
alembic at the parent with the committed steps in place; repair the named rows
and re-run, and it converges. A ``NOT VALID`` CHECK left committed by such a
failure is already enforced on new writes.

Downgrade
=========

The schema inverse: both handle CHECKs, ``NOT NULL`` and the default go;
``last_seen`` returns to carrying no comment (no earlier revision gave it one);
the reason CHECK and ``closed_reason`` go, and with the column its data. The
handle-status backfill is NOT reversed: nothing records which rows were NULL
(production had none), and the backfilled values are ones the old schema
already admits.

It runs one table at a time too, for the same deadlock: held in one
transaction, its two ``ACCESS EXCLUSIVE`` locks (``coord.session_handles``,
then ``coord.agent_sessions``) deadlocked (40P01) against a pass-4-shaped
UPDATE in review. So the ``coord.session_handles`` group runs first, an
``autocommit_block()`` COMMITS it and releases that lock, and the
``coord.agent_sessions`` group runs in the transaction alembic reopens, the
one that stamps the version. Each group opens with its own ``SET LOCAL
lock_timeout = '3s'``, since a ``SET LOCAL`` ends with its transaction. Every
statement is ``IF EXISTS`` or repeats harmlessly, so a downgrade that fails in
its second group (the handle group committed, alembic still at this revision)
converges when re-run.

Ordering against coord
======================

The deployed coord neither reads nor writes ``closed_reason``, so this revision
is safe ahead of every coord change. Plan Phase 5's coord PR is held on
``schema_object_exists`` for the production column, and bumps coord CI's
migrator pin (``MIGRATOR_DIGEST`` / ``MIGRATOR_ALEMBIC_HEAD``) to a head that
includes this revision. Until Phase 5 deploys, coord keeps closing rows with no
reason (about 450 a day) AND keeps reopening rows without clearing a reason,
so an open row can carry ``unrecorded``; plan Phase 8 reconciles both before it
pairs ``closed_reason`` with ``closed_at`` by CHECK.

Merge-train disposition
=======================

coord's migration classifier will NOT prove this revision additive: the
backfill DML, ``SET NOT NULL``, the dollar-quoted constraint blocks and
``VALIDATE CONSTRAINT`` are all outside the forms it admits, so a PR carrying
it is held on coord's ``migrations`` escalate path until reviewed. That is the
expected verdict, not a finding. ``upgrade()`` and everything outside
``downgrade()`` carry no destructive token, so coord's alembic re-point (its E6
clause) can still move this revision onto a newer head; the companion test
pins that.

Head choice
===========

``down_revision`` is the single head of ``origin/main`` at authoring time
(``scripts/ci/count_alembic_heads.py``: ``HEAD_COUNT=1``). If another revision
lands first, coord re-points ``down_revision`` and the ``Revises:`` line at
land time; the companion test reads the parent from this file.

Every SQL string is a static literal with no ``:word`` bind-parameter
sequence, so the revision renders unchanged in offline ``--sql`` mode.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "coord_session_liveness_01"
# KEEP THIS ASSIGNMENT ON ONE LINE: coord's alembic-graph parser is line-scoped.
down_revision: str | Sequence[str] | None = "coord_ci_runs_head_sha_idx_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add closed_reason and the handle-status constraints, one table at a time."""
    # Step 1 -- coord.agent_sessions DDL. Fail fast rather than queue an
    # ACCESS EXCLUSIVE request in front of every reader of the table.
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute(
        "ALTER TABLE coord.agent_sessions ADD COLUMN IF NOT EXISTS closed_reason TEXT"
    )
    # NOT VALID: no scan, enforced on every write from here.
    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1
                  FROM pg_constraint
                 WHERE conrelid = 'coord.agent_sessions'::regclass
                   AND conname = 'ck_agent_sessions_closed_reason'
                   AND contype = 'c'
            ) THEN
                ALTER TABLE coord.agent_sessions
                    ADD CONSTRAINT ck_agent_sessions_closed_reason
                    CHECK (
                        closed_reason IS NULL
                        OR closed_reason IN (
                            'handle_autoclose',
                            'superseded_reap',
                            'rebind_reap',
                            'stamp_ended_insert',
                            'stamp_reported_ended',
                            'unrecorded'
                        )
                    ) NOT VALID;
            END IF;
        END
        $$
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.agent_sessions.closed_reason IS
            'Which writer closed this session row: handle_autoclose (the '
            'session-handle sweep closed it once its handle closed), '
            'superseded_reap (the sweep reaped a session its handle no longer '
            'points at), rebind_reap (a handle rebind reaped the session it '
            'superseded), stamp_ended_insert (the session-identity stamp first '
            'saw the session already ended), stamp_reported_ended (the stamp '
            'reported it ended while every liveness plane was stale) or '
            'unrecorded (closed before any writer named itself, the backfilled '
            'value). Meaningful only while closed_at is set. NULL = no writer '
            'recorded a reason. Written from Phase 5 of plan '
            '2026-11-12-coord-closes-a-live-sessions-row-because-last-seen-is-not-a-heartbeat '
            'on, by the coord write that sets closed_at (session_handles.rs, '
            'agent_sessions.rs, session_identity_stamp.rs). A row closed '
            'before then reads unrecorded where the backfill that added this '
            'column found it closed, and NULL otherwise.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.agent_sessions.last_seen IS
            'Latest positive evidence that this session is alive: the newest '
            'coord write that carried this session id or, from Phase 1 of plan '
            '2026-11-12-coord-closes-a-live-sessions-row-because-last-seen-is-not-a-heartbeat '
            'on, the newest live harness observation of the session (the '
            'runner session-identity stamp reporting it live). It is evidence '
            'of life, not a heartbeat: a quiet live session is observed only '
            'as often as one of those happens, so a stale value alone does not '
            'prove the session ended (design decision D2 of that plan). Coord '
            'adopts that reading by plan phase: from Phase 3 the handle sweep '
            'and the rebind reap no longer close a row on a stale value alone, '
            'and from Phase 7 no other liveness reader acts on a stale value '
            'alone.'
        """
    )

    # Step 2 -- entering the block COMMITS step 1, so the backfill rewrites rows
    # under row locks only, and VALIDATE scans under SHARE UPDATE EXCLUSIVE.
    with op.get_context().autocommit_block():
        op.execute(
            "UPDATE coord.agent_sessions SET closed_reason = 'unrecorded' "
            "WHERE closed_at IS NOT NULL AND closed_reason IS NULL"
        )
        op.execute(
            "ALTER TABLE coord.agent_sessions "
            "VALIDATE CONSTRAINT ck_agent_sessions_closed_reason"
        )

    # Step 3 -- coord.session_handles DDL, in the transaction alembic reopened.
    # SET DEFAULT first: its lock keeps any writer from inserting a NULL status
    # between the backfill and SET NOT NULL.
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute(
        "ALTER TABLE coord.session_handles ALTER COLUMN status SET DEFAULT 'live'"
    )
    op.execute(
        "UPDATE coord.session_handles "
        "SET status = CASE WHEN closed_at IS NOT NULL THEN 'closed' ELSE 'stale' END "
        "WHERE status IS NULL"
    )
    op.execute("ALTER TABLE coord.session_handles ALTER COLUMN status SET NOT NULL")
    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1
                  FROM pg_constraint
                 WHERE conrelid = 'coord.session_handles'::regclass
                   AND conname = 'ck_session_handles_status'
                   AND contype = 'c'
            ) THEN
                ALTER TABLE coord.session_handles
                    ADD CONSTRAINT ck_session_handles_status
                    CHECK (status IN ('live', 'stale', 'closed')) NOT VALID;
            END IF;
        END
        $$
        """
    )
    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1
                  FROM pg_constraint
                 WHERE conrelid = 'coord.session_handles'::regclass
                   AND conname = 'ck_session_handles_status_closed_at'
                   AND contype = 'c'
            ) THEN
                ALTER TABLE coord.session_handles
                    ADD CONSTRAINT ck_session_handles_status_closed_at
                    CHECK ((status = 'closed') = (closed_at IS NOT NULL)) NOT VALID;
            END IF;
        END
        $$
        """
    )

    # Step 4 -- commit step 3, then validate both handle CHECKs.
    with op.get_context().autocommit_block():
        op.execute(
            "ALTER TABLE coord.session_handles "
            "VALIDATE CONSTRAINT ck_session_handles_status"
        )
        op.execute(
            "ALTER TABLE coord.session_handles "
            "VALIDATE CONSTRAINT ck_session_handles_status_closed_at"
        )


def downgrade() -> None:
    """Remove exactly what upgrade added (the status backfill is not reversed),
    one table at a time like upgrade(), so it never holds both tables' locks.
    """
    # coord.session_handles first, under its own lock bound.
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute(
        "ALTER TABLE coord.session_handles "
        "DROP CONSTRAINT IF EXISTS ck_session_handles_status_closed_at"
    )
    op.execute(
        "ALTER TABLE coord.session_handles "
        "DROP CONSTRAINT IF EXISTS ck_session_handles_status"
    )
    op.execute("ALTER TABLE coord.session_handles ALTER COLUMN status DROP NOT NULL")
    op.execute("ALTER TABLE coord.session_handles ALTER COLUMN status DROP DEFAULT")

    # Entering the block COMMITS the session_handles group, releasing its lock
    # before the agent_sessions group asks for one (coord takes the two tables'
    # locks in both orders); leaving it opens the transaction alembic stamps in.
    with op.get_context().autocommit_block():
        pass

    # coord.agent_sessions, under a fresh bound: the commit ended the first.
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute("COMMENT ON COLUMN coord.agent_sessions.last_seen IS NULL")
    op.execute(
        "ALTER TABLE coord.agent_sessions "
        "DROP CONSTRAINT IF EXISTS ck_agent_sessions_closed_reason"
    )
    op.execute("ALTER TABLE coord.agent_sessions DROP COLUMN IF EXISTS closed_reason")
