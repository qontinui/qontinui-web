"""coord.agent_status: the session-grain primary key (contract)

Revision ID: coord_agent_status_session_02
Revises: overlord_04_runner_start_and_nudge_time
Create Date: 2026-11-14

Phase 6a of plan ``2026-11-11-intent-overlap-excludes-the-callers-whole-device``
(decision D2, as corrected at vet 2026-11-11 and at Phase 1 review 2026-11-12).
This is the CONTRACT half of the expand/contract change whose expand half is
``coord_agent_status_session_01``. It makes the primary key of
``coord.agent_status``::

    agent_status_pkey PRIMARY KEY (device_id, work_unit_id, tenant_id, agent_session_id)

so two sessions on one device that declare the same ``work_unit_id`` keep two
rows instead of the later one overwriting the earlier one's globs. The nil UUID
(``agent_session_id``'s default, "unattributed") keeps today's device-grain
collapse for writers coord cannot attribute: every nil writer of one
(device, unit, tenant) still lands on one row.

What it does
============

1. Builds ``uq_agent_status_session_grain`` UNIQUE ``(device_id, work_unit_id,
   tenant_id, agent_session_id)`` ``CONCURRENTLY``, so the build holds no SHARE
   lock against coord's writes. It is a bare unique INDEX, never a ``UNIQUE``
   constraint: ``ADD PRIMARY KEY USING INDEX`` refuses an index that already
   backs a constraint. The build cannot fail on a duplicate, because the
   3-column key still makes every 4-tuple unique while it runs.
2. SWAPS the primary key onto that index in ONE statement, so the table is never
   without a primary key (replica identity holds at every moment; see below)::

       ALTER TABLE coord.agent_status
           DROP CONSTRAINT <old pk>,
           ADD CONSTRAINT agent_status_pkey
               PRIMARY KEY USING INDEX uq_agent_status_session_grain

   ``<old pk>`` is resolved from ``pg_constraint`` (``contype = 'p'``), not
   assumed, inside a ``DO`` block that also checks, before it changes anything,
   that the index is VALID, UNIQUE, non-partial, has no expression column and
   keys EXACTLY those four columns in that order. ``USING INDEX`` itself
   refuses a partial, expression or non-default-ordered index, but not one over
   the wrong columns, and ``IF NOT EXISTS`` in step 1 would keep a same-named
   index of any shape. The promotion renames the index to ``agent_status_pkey``.

The order is load-bearing
=========================

Before this revision, coord's original upsert was ``INSERT ... ON CONFLICT
(device_id, work_unit_id, tenant_id) DO UPDATE``. After the swap no unique index
matches that conflict target exactly, so that statement fails ``42P10`` (no
arbiter) and every ``coord_declare_intent`` and intent-shaped
``coord_report_status`` would error. Two windows are covered:

- **Between the build and the swap**, a second unique index sits beside the
  3-column key. An upsert arbitrating on the 3-column key checks it with an
  immediate uniqueness check, so two concurrent FIRST inserts of one key could
  fail ``23505`` on it.
- **After the swap**, the 3-column arbiter is gone (the ``42P10`` above).

Plan Phase 2 (qontinui-coord#4123, land ``ac5f845ba4``) replaced that upsert with
a shape-agnostic write: an ``UPDATE`` on the 4-tuple, then ``INSERT ... ON
CONFLICT DO NOTHING`` with NO arbiter (which absorbs a violation of ANY unique
index), then a ``FOR UPDATE`` read of the 3-tuple row. Its legacy path, taken
only while a replica has not observed ``agent_session_id``, falls back to that
write on ``42P10``. So this revision is applied only once every coord replica
SERVES Phase 2: this PR was opened by the continuation of a ``deploy_healthy
{service: coord, expected_rev: ac5f845ba4}`` gate, after that was checked again
on every replica. Rolling coord back past Phase 2 while this key is in place
breaks every intent write; downgrade this revision first.

After this revision, coord's Phase 6b replaces the three-step write with a
direct ``ON CONFLICT ON CONSTRAINT agent_status_pkey DO UPDATE``.

Replica identity
================

``coord`` is to be published ``FOR TABLES IN SCHEMA coord`` (plan
``2026-10-15-coord-and-web-data-move-off-aws-by-logical-replication`` D1).
PostgreSQL refuses UPDATE and DELETE on a published table with no replica
identity, and ``relreplident = 'd'`` uses the primary key. The swap is one
``ALTER TABLE`` statement, so no transaction can observe the table without a
primary key, and every key column is ``NOT NULL`` (the three original ones as
key columns, ``agent_session_id`` since ``coord_agent_status_session_01``), so
the promotion needs no ``SET NOT NULL`` and no verifying scan. The standing guard
``tests/test_replica_identity_published_schemas.py`` walks the chain to the head
and checks this; it is part of this revision's gate.

Locking
=======

The ``CONCURRENTLY`` build runs inside ``autocommit_block()`` with no
``lock_timeout`` and no ``statement_timeout`` in force: a ``CONCURRENTLY``
build's waits for older transactions are lock waits, and a timeout there fails
the build and leaves an INVALID index. A role-, database- or
``PGOPTIONS``-level value would be in force there (``RESET`` restores such a
value rather than clearing it), so the block sets both to ``0``
at session level itself before the build and resets both straight after it
(``env.py``'s per-revision ``RESET`` covers ``lock_timeout`` and ``search_path``, not
``statement_timeout``).

The swap commits at once, in its own transaction, through an empty
``autocommit_block()`` after it. Otherwise its ACCESS EXCLUSIVE lock would be
held until ``env.py``'s batch transaction commits, through the
``alembic_version`` stamp and every later non-autocommit revision of the same
``upgrade head``, blocking coord's intent reads and writes all that time. A
process killed between that commit and the version stamp re-runs into the
early return below (Idempotence). ``downgrade()`` commits its swap the same
way.

The swap takes ACCESS EXCLUSIVE on the table. Every ``coord_declare_intent`` and
intent-shaped ``coord_report_status`` writes it, and a queued ACCESS EXCLUSIVE
request blocks every reader and writer behind it, so its WAIT is bounded with
``SET LOCAL lock_timeout = '3s'`` in the swap's own transaction. Once granted,
the swap is catalog-only: the index already exists and every column is already
``NOT NULL``. On a busy table it fails loudly and is re-run; it never stalls
coord's writes behind a queued lock.

A killed ``CONCURRENTLY`` build leaves an INVALID index of the same name, which
``IF NOT EXISTS`` alone would keep. Before the build the revision probes
``pg_index.indisvalid``; on an INVALID index of its own name it logs a warning
naming it and runs a plain ``REINDEX INDEX`` in a transaction of its own, under
``SET LOCAL lock_timeout = '3s'``, which rebuilds it VALID in place. This is
``coord_agent_status_session_01``'s handling, for the same reasons (that
revision's Locking section): a plain REINDEX rather than ``REINDEX
CONCURRENTLY``, whose failure leaves a ``<name>_ccnew`` leftover no probe sees,
and a bound that ends with the REINDEX's transaction so it never reaches the
build. The REINDEX cannot fail on a duplicate either, for the reason step 1
cannot. Nothing is dropped.

Idempotence
===========

When ``agent_session_id`` is already a column of the primary key (the swap was
applied, or the database was stamped back past it), ``upgrade()`` builds
nothing and swaps nothing. That check matters because the promotion renames the
index: a re-run that went on to ``CREATE UNIQUE INDEX ... IF NOT EXISTS
uq_agent_status_session_grain`` would build a second unique index on the same
four columns beside the key.

Downgrade — fails loudly on same-unit sibling rows
==================================================

``downgrade()`` swaps the 3-column key back in one statement, in one
transaction with a bounded lock wait::

    ALTER TABLE coord.agent_status
        DROP CONSTRAINT <pk>,
        ADD CONSTRAINT agent_status_pkey
            PRIMARY KEY (device_id, work_unit_id, tenant_id)

That builds the 3-column index under the ACCESS EXCLUSIVE lock it already holds
(the table's size as ``coord_agent_status_session_01``'s docstring records
it: about 4,560 rows, 4.3 MB, measured by plan Phase 0 on 2026-11-11).

**It REFUSES, and changes nothing, while any (device_id, work_unit_id,
tenant_id) holds more than one row**: two sessions on one device that declared
the same work unit, which is exactly what this revision exists to allow. A
3-column key cannot hold them. The downgrade checks this first, under the same
lock as the swap, and raises naming the number of such keys. It never deletes a
row to make the key fit: which sibling's declaration to keep is not the
migration's call. To downgrade, wait for the duplicate rows to expire (coord's
intent rows live an hour), or delete the rows you choose to lose, and re-run.
If the check were bypassed the ``ADD CONSTRAINT`` would still fail atomically
with ``23505``.

Run this downgrade only against a coord whose intent write does not need the
4-column key: Phase 2's shape-agnostic write works under both keys; Phase 6b's
``ON CONFLICT ON CONSTRAINT agent_status_pkey`` keeps working by name but then
arbitrates on three columns, so roll coord back to a pre-6b build first if
siblings must keep separate rows. ``coord_agent_status_session_01``'s own
downgrade refuses while ``agent_session_id`` is in the key, so this revision's
downgrade must run before it.

Chain and classifier
====================

``down_revision`` is ``overlord_04_runner_start_and_nudge_time``, the single
head printed by ``poetry run alembic heads`` on qontinui-web ``origin/main``
``808c7a745`` at authoring time.

Every ``op.execute`` in ``upgrade()`` and ``downgrade()`` takes one static SQL
literal; the old key's name is resolved inside the ``DO`` blocks, never
formatted into Python SQL. Coord's migration classifier still rejects this file (the probes run SQL
through the bind, the REINDEX helper's ``op.execute(sql)`` takes a parameter,
and its ``BEGIN``/``COMMIT``/``ROLLBACK`` reach the fail-closed catch-all), so
the PR takes the ``alembic/versions`` escalate path, cleared with
``coord_submit_escalate_evidence``.
"""

import contextlib
import logging
from collections.abc import Sequence

from sqlalchemy import text

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_agent_status_session_02"
down_revision: str | Sequence[str] | None = "overlord_04_runner_start_and_nudge_time"
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
    """True when ``agent_session_id`` is a column of the table's primary key."""
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
    """Build the session-grain unique index CONCURRENTLY, then swap the PK onto it."""
    if _session_column_is_in_primary_key():
        # Already swapped (or stamped back past it). The promotion renamed the
        # index, so building it again would add a second unique index.
        logger.info(
            "coord.agent_status primary key already includes agent_session_id: "
            "nothing to build or swap"
        )
        return

    with op.get_context().autocommit_block():
        # No timeout may fail the build (see Locking). Session-level, so it
        # covers the autocommit statements below; both are RESET after the
        # build, since env.py's per-revision RESET omits statement_timeout.
        op.execute("SET lock_timeout = 0")
        op.execute("SET statement_timeout = 0")
        # A killed CONCURRENTLY build leaves an INVALID index that IF NOT EXISTS
        # would keep. REINDEX rebuilds it VALID in place.
        if _index_is_invalid("uq_agent_status_session_grain"):
            logger.warning(
                "coord.uq_agent_status_session_grain is INVALID, the leftover of a "
                "killed CONCURRENTLY build: rebuilding it with REINDEX"
            )
            _reindex_in_own_transaction(
                "REINDEX INDEX coord.uq_agent_status_session_grain"
            )
        op.execute(
            """
            CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_agent_status_session_grain
            ON coord.agent_status (device_id, work_unit_id, tenant_id, agent_session_id)
            """
        )
        op.execute("RESET statement_timeout")
        op.execute("RESET lock_timeout")

    # The autocommit_block COMMITted the batch transaction; this runs in a new
    # one. Bound the ACCESS EXCLUSIVE wait of the swap.
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute(
        """
        DO $$
        DECLARE
            old_pk     text;
            idx_oid    oid;
            idx_ok     boolean;
            idx_cols   text[];
        BEGIN
            SELECT c.oid,
                   i.indisvalid AND i.indisunique AND i.indpred IS NULL
                       AND i.indexprs IS NULL
                       AND NOT EXISTS (SELECT 1 FROM pg_constraint k
                                        WHERE k.conindid = c.oid),
                   ARRAY(SELECT a.attname::text
                           FROM unnest(i.indkey::int2[]) WITH ORDINALITY AS u(attnum, ord)
                           JOIN pg_attribute a
                             ON a.attrelid = i.indrelid AND a.attnum = u.attnum
                          ORDER BY u.ord)
              INTO idx_oid, idx_ok, idx_cols
              FROM pg_class c
              JOIN pg_namespace n ON n.oid = c.relnamespace
              JOIN pg_index i ON i.indexrelid = c.oid
             WHERE n.nspname = 'coord'
               AND c.relname = 'uq_agent_status_session_grain'
               AND i.indrelid = 'coord.agent_status'::regclass;

            IF idx_oid IS NULL THEN
                RAISE EXCEPTION 'coord_agent_status_session_02: index '
                    'coord.uq_agent_status_session_grain is missing; the PK swap '
                    'needs it';
            END IF;
            IF NOT idx_ok
               OR idx_cols IS DISTINCT FROM
                  ARRAY['device_id', 'work_unit_id', 'tenant_id', 'agent_session_id']
            THEN
                RAISE EXCEPTION 'coord_agent_status_session_02: index '
                    'coord.uq_agent_status_session_grain is not a valid, unique, '
                    'non-partial, unconstrained index on exactly (device_id, '
                    'work_unit_id, tenant_id, agent_session_id): columns %', idx_cols;
            END IF;

            SELECT conname INTO old_pk
              FROM pg_constraint
             WHERE conrelid = 'coord.agent_status'::regclass AND contype = 'p';
            IF old_pk IS NULL THEN
                RAISE EXCEPTION 'coord_agent_status_session_02: coord.agent_status '
                    'has no primary key to swap';
            END IF;

            EXECUTE format(
                'ALTER TABLE coord.agent_status DROP CONSTRAINT %I, '
                'ADD CONSTRAINT agent_status_pkey '
                'PRIMARY KEY USING INDEX uq_agent_status_session_grain',
                old_pk);
        END
        $$
        """
    )
    # Commit the swap now, releasing ACCESS EXCLUSIVE before the version stamp
    # and any later revision of the batch (see Locking).
    with op.get_context().autocommit_block():
        pass


def downgrade() -> None:
    """Swap the 3-column key back; refuse while same-unit sibling rows exist."""
    if not _session_column_is_in_primary_key():
        logger.info(
            "coord.agent_status primary key does not include agent_session_id: "
            "nothing to swap back"
        )
        return
    op.execute("SET LOCAL lock_timeout = '3s'")
    # Take the swap's lock FIRST, so no writer can add a sibling row between the
    # check and the swap.
    op.execute("LOCK TABLE coord.agent_status IN ACCESS EXCLUSIVE MODE")
    op.execute(
        """
        DO $$
        DECLARE
            pk         text;
            shared     bigint;
        BEGIN
            SELECT count(*) INTO shared
              FROM (SELECT 1
                      FROM coord.agent_status
                     GROUP BY device_id, work_unit_id, tenant_id
                    HAVING count(*) > 1) AS s;
            IF shared > 0 THEN
                RAISE EXCEPTION 'coord_agent_status_session_02 downgrade refused: '
                    '% (device_id, work_unit_id, tenant_id) key(s) of '
                    'coord.agent_status hold rows of more than one session, which a '
                    '3-column primary key cannot hold. No row was changed. Wait for '
                    'them to expire or delete the rows you choose to lose, then '
                    're-run.', shared;
            END IF;

            SELECT conname INTO pk
              FROM pg_constraint
             WHERE conrelid = 'coord.agent_status'::regclass AND contype = 'p';

            EXECUTE format(
                'ALTER TABLE coord.agent_status DROP CONSTRAINT %I, '
                'ADD CONSTRAINT agent_status_pkey '
                'PRIMARY KEY (device_id, work_unit_id, tenant_id)',
                pk);
        END
        $$
        """
    )
    # Commit the swap now, releasing ACCESS EXCLUSIVE before the version stamp
    # and any later revision of the batch (see Locking).
    with op.get_context().autocommit_block():
        pass
