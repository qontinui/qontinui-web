"""coord.subproject_note_events — the history ledger of a subproject's next_steps_note

Phase 3 (the qontinui-web half, which lands and applies FIRST) of plan
``2026-11-22-subproject-next-steps-note-refuses-scheduled-buckets-and-keeps-history``.
Creates one new, empty table, its comment and one index beside its primary key,
all in ONE transaction::

    coord.subproject_note_events (id, tenant_id, subproject_id, written_at,
                                  written_by, note, prior_note, prior_note_by,
                                  prior_note_at)
        idx_subproject_note_events_tenant_subproject_written
            (tenant_id, subproject_id, written_at DESC)

Every name, type, default and key is the one the plan's Phase 3 fixes. The
coord half (Phase 4, ``crates/coord/src/subprojects/note_events.rs``) is built
against it, so a shape change here is a contract change there.

Why this table exists
=====================

``coord.subprojects.next_steps_note`` holds ONE note, and coord's
``writes::apply_patch`` overwrites it on every write. Two close-out procedures
(``/unattended`` Step 4.9b and ``/finish-session`` Part A step 4) write it, and
every session in a standing ``scheduled:<label>`` subproject writes the same
row, so each close-out silently replaced the last one's text. There was no
record of what was overwritten, by whom, or when. This ledger is that record:
coord inserts one row per accepted note write, in the same transaction as the
``UPDATE`` of ``coord.subprojects``, carrying both the new note and the one it
replaced. A clobbered note is then recoverable from the read door
(``coord_subproject_get`` -> ``note_events[].prior_note``).

Column authority
================

* ``id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY`` — a surrogate key;
  the house idiom for an append-only ledger
  (``coord_test_result_heads_01_head_ledger``). It also gives the table the
  replica identity the logical-replication publication requires.
* ``tenant_id uuid NOT NULL`` — every subproject door is tenant-scoped. Like
  ``coord.subprojects.tenant_id`` it carries no foreign key.
* ``subproject_id uuid NOT NULL`` -> ``coord.subprojects (id)``
  (``fk_subproject_note_events_subproject``, NO ACTION, the PostgreSQL
  default). A subproject is never deleted — it is archived, or merged by
  writing ``merged_into`` — so a DELETE that would orphan its history is
  refused rather than taking the ledger with it.
* ``written_at timestamptz NOT NULL DEFAULT now()`` — ``now()`` is
  transaction-start time, so a ledger row inserted in the transaction that
  sets ``coord.subprojects.next_steps_note_at = now()`` carries the SAME
  instant. Phase 6's arming read relies on that equality; coord's writer must
  not use ``clock_timestamp()``.
* ``written_by text NOT NULL`` — the ``next_steps_note_by`` actor string of the
  write: ``session:<uuid>`` | ``operator``.
* ``note text`` — the note as written. NULL records a CLEAR (the write set the
  note to NULL), which is itself a write worth keeping.
* ``prior_note text``, ``prior_note_by text``, ``prior_note_at timestamptz`` —
  the row's ``next_steps_note`` / ``_by`` / ``_at`` as they stood immediately
  before this write. NULL on the first write a subproject ever receives. A
  closer pair's two rows chain: a row's ``prior_note_at`` equals the preceding
  row's ``written_at`` unless a write landed between them (the plan's Phase 6
  convention check).

No CHECK pins ``written_by``: the actor vocabulary is coord's, already free
text on ``coord.subprojects.next_steps_note_by``, and a ledger that refused a
write the subproject row accepted would fail the note write itself.

Index
=====

``idx_subproject_note_events_tenant_subproject_written`` —
``(tenant_id, subproject_id, written_at DESC)``: a subproject's history, newest
first. It serves the only read the plan defines, coord's
``note_events::recent`` on the detail path (the newest 20 rows), and the
``note_written`` history events.

Built in the SAME transaction as the table — a plain ``CREATE INDEX IF NOT
EXISTS``, never ``CONCURRENTLY``. coord's migration classifier admits a
non-concurrent ``CREATE INDEX`` on a table the same file creates earlier as a
new-table CLAIM, which the merge engine discharges by proving trunk has never
named the table (``pr_merge::migration_new_table_proof``). Trunk named
``subproject_note_events`` nowhere when this was authored, so this revision
must land before any other trunk file names it; the plan orders it first.

Retention
=========

None in this revision. A row is written only on a close-out note write and a
note is at most 16k characters. The plan's Phase 1(c) sizes the write rate;
above 5k writes a day, Phase 4 adds a keep-newest-200-per-subproject trim to
coord's reconciler tick. Below that the table is not trimmed.

Lock posture
============

The table is new and invisible to every other session until this transaction
commits, and its index is built on it. The foreign key's validation takes a
``SHARE ROW EXCLUSIVE`` lock on ``coord.subprojects`` for the rest of the
transaction — it blocks writes to that table (not reads) only for the
milliseconds this short transaction holds it, and the table it validates is
empty, so there is nothing to scan. No ``lock_timeout`` is set, matching
``coord_subprojects_01``, whose member-table foreign key has the same shape.

Idempotency / authorship posture
================================

* ``CREATE TABLE IF NOT EXISTS`` / ``CREATE INDEX IF NOT EXISTS`` /
  ``COMMENT ON``, all in one transaction, so a failed apply rolls back whole;
  a symmetric ``downgrade()`` drops the index and then the table. ``IF NOT
  EXISTS`` matches on NAME only; acceptable because no earlier revision spells
  the table.
* **alembic is the SOLE author of the ``coord.*`` schema** (served policy
  ``production-and-cost`` ``alembic-sole-authorship``). coord only INSERTs and
  SELECTs this table, and this revision must be APPLIED in production before
  the coord PR that writes it deploys (the plan's Phase 3 -> 4 gate is
  ``coord.subproject_note_events`` existing on the serving database). coord's
  ``schema_manifest.rs`` lists it best-effort in Phase 4, and
  ``crates/coord-migrations/schema.manifest`` moves only when the migrator pin
  is bumped past this revision — never by hand.
* The ``coord_tenant`` / ``coord_tenant_preflight`` roles get their table and
  sequence privileges from ``coordrls_01``'s ``ALTER DEFAULT PRIVILEGES``; the
  identity column's implicit sequence needs no statement here either.
* No backfill: the overwritten notes before this revision are gone, and the
  ledger starts empty. The downgrade drops the table and its rows; the history
  does not return.
* Every SQL string is a static literal (so the revision renders unchanged in
  offline ``--sql`` mode), and none carries a ``:word`` sequence, which
  SQLAlchemy ``text()`` would read as a bind parameter, or a ``%``.

Chaining
========

``down_revision = "coord_conditions_02_honest_runs"`` — ``main``'s single
alembic head, measured 2026-11-22 with ``scripts/ci/count_alembic_heads.py``
(``HEAD_COUNT=1``) at ``origin/main`` ``4c7f77651`` (re-pointed after main gained ``coord_conditions_02_honest_runs``). ``coord_subprojects_04``
is NOT the head (``cirscope_02_devices_ci_runner_scope_index`` already chains
off it). A re-point is three coupled edits: ``down_revision``, the ``Revises:``
line below, and ``_PARENT_REVISION_ID`` in
``tests/test_coord_subprojects_05_note_events_migration.py``.

Hand-authored; ``alembic revision --autogenerate`` was not run (served policy
``production-and-cost`` ``alembic-sole-authorship``).

Revision ID: coord_subprojects_05_note_events
Revises: coord_conditions_02_honest_runs
Create Date: 2026-11-22

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_subprojects_05_note_events"
down_revision: str | None = "coord_conditions_02_honest_runs"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create the ledger, its comment and its index in ONE transaction."""
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.subproject_note_events (
            id             bigint       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
            tenant_id      uuid         NOT NULL,
            subproject_id  uuid         NOT NULL,
            -- transaction-start time: equals the subproject row's
            -- next_steps_note_at when written in the same transaction
            written_at     timestamptz  NOT NULL DEFAULT now(),
            -- the next_steps_note_by actor string of this write
            written_by     text         NOT NULL,
            -- NULL = the write cleared the note
            note           text,
            -- the subproject row's note, _by and _at just before this write
            prior_note     text,
            prior_note_by  text,
            prior_note_at  timestamptz,
            CONSTRAINT fk_subproject_note_events_subproject
                FOREIGN KEY (subproject_id) REFERENCES coord.subprojects (id)
        )
        """
    )
    op.execute(
        """
        COMMENT ON TABLE coord.subproject_note_events IS
            'Append-only history of coord.subprojects.next_steps_note, one row per '
            'accepted note write (plan '
            '2026-11-22-subproject-next-steps-note-refuses-scheduled-buckets-and-keeps-history). '
            'Written by coord only, in the transaction that updates the subproject, '
            'and alembic authors the DDL. note NULL records a clear. prior_note, '
            'prior_note_by and prior_note_at are the values this write replaced, '
            'so an overwritten note is recoverable.'
        """
    )
    # Built in the transaction that created the table: a non-concurrent index
    # on a table the same file creates is what coord's migration classifier
    # admits as a new-table claim. A subproject's history, newest first.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_subproject_note_events_tenant_subproject_written
            ON coord.subproject_note_events (tenant_id, subproject_id, written_at DESC)
        """
    )


def downgrade() -> None:
    """Drop the index, then the table. The ledger's rows do not return."""
    op.execute(
        "DROP INDEX IF EXISTS coord.idx_subproject_note_events_tenant_subproject_written"
    )
    op.execute("DROP TABLE IF EXISTS coord.subproject_note_events")
