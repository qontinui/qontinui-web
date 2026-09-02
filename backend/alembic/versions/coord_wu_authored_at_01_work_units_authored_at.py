"""coord.work_units.authored_at — the date a plan was WRITTEN, plus a slug-prefix backfill

Revision ID: coord_wu_authored_at_01
Revises: atu_02_atu_provenance
Create Date: 2026-09-02

Phase A of plan ``2026-09-02-coord-work-units-carry-no-authoring-date``.

Problem
=======

``coord.work_units`` is the store behind the operator's Plans page
(``/admin/coord/plans``). It carries four time columns and **none of them is the
authoring date**:

* ``created_at`` — Postgres default at INSERT: when the scanner first INGESTED
  the file into coord, not when anyone wrote it.
* ``updated_at`` — ``now()`` on every upsert: when the scanner last touched the
  row, which it does every ~68 s.
* ``first_in_progress_at`` / ``first_shipped_at`` — derived from
  ``work_unit_status_history``: when a TRANSITION was recorded.

Measured 2026-09-02: 20 plans authored between 2026-05-14 and 2026-06-10 all
carry ``created_at = 2026-06-28`` — the day of the bulk backfill. 113 of 194
``draft`` units have a ``created_at`` that disagrees with the ``YYYY-MM-DD``
prefix of their own slug. The runner ALREADY computes the right value
(``plan_workunit_adapter/body_push.rs`` ``authored_at_from_stem``: the
``YYYY-MM-DD`` off the filename stem, as ``YYYY-MM-DDT00:00:00Z``) and sends it
to the plan-library sink — but coord's ``UpsertRequest`` has no date field, so on
the coord path the value is thrown away. This revision gives it somewhere to go.

The column
==========

``authored_at TIMESTAMPTZ NULL``, no default.

**NULL means "not recorded" — never "same as created_at".** Defaulting it to
``created_at`` would re-manufacture exactly the lie this plan removes: a row
whose authoring date nobody knows would render as authored on its ingestion day.
A reader that wants a fallback applies one explicitly and labels it ("Ingested"),
which is what Phase C's frontend does. Nothing in the schema does it silently.

Backfill
========

In the same revision, ``authored_at`` is set from the slug prefix for every row
whose slug starts with an anchored ``YYYY-MM-DD-`` (four digits, dash, two, dash,
two, dash). The predicate mirrors the runner's ``authored_at_from_stem``
byte-for-byte: it is ANCHORED, so ``feature-2026-01-01-x`` is NOT dated (the
Rust rejects it too), and it requires the TRAILING dash, so a bare ``2026-05-14``
is not dated either (the Rust's ``len() < 11`` check). Two writers — this
backfill now, the runner's per-scan upsert after Phases B and D — must agree on
which stems carry a date, or the 113-of-194 disagreement class simply moves to a
new column. Rows whose stem carries no date stay NULL; that is the honest
answer, and the frontend renders it as "authored not recorded".

The backfill runs once, here, in the pipeline, for every row — including the
bodyless units that were POSTed straight into coord and that no scanner will
ever re-visit. It is guarded by ``authored_at IS NULL``, so a re-run is a no-op
and can never overwrite a value coord itself wrote later (Phase D's upsert uses
``COALESCE(EXCLUDED.authored_at, coord.work_units.authored_at)`` for the same
reason: an established date is never nulled or replaced by a later scan).

**The value is midnight UTC on that calendar date, independent of the session
time zone.** The expression is::

    (substring(slug from '^\\d{4}-\\d{2}-\\d{2}') || 'T00:00:00Z')::timestamptz

and NOT ``to_timestamp(prefix, 'YYYY-MM-DD')``. ``to_timestamp`` interprets the
text in the SESSION time zone, so under a migrator whose ``PGTZ`` / RDS default
is not UTC the stored instant is off by the zone offset — and appending
``AT TIME ZONE 'UTC'`` does not repair it: applied to a timestamptz that yields a
timestamp WITHOUT time zone, which is then re-interpreted in the session zone on
assignment, for a net shift of zero. The explicit ``Z`` offset in the literal
pins the instant to UTC regardless of any session setting, and produces exactly
the string the runner emits (``YYYY-MM-DDT00:00:00Z``), so both writers derive
the identical instant.

**A slug prefix that matches the shape but is not a calendar date
(``2026-02-30-…``) must not abort the migration.** This revision is applied to
the canonical RDS by ``migrate.yml`` on merge, with nobody at a keyboard. A
plain ``UPDATE`` would raise ``datetime_field_overflow`` on the first such row
and roll the whole backfill back, leaving the pipeline red on a data defect in
ONE slug. So the backfill is a PL/pgSQL ``DO`` block that visits eligible rows
one at a time and, per row, catches ``datetime_field_overflow`` /
``invalid_datetime_format``, leaves that row NULL, and emits a ``WARNING``
naming the slug. Every other row is still dated. The table is a bounded
operational one (hundreds of rows, not events), so a row loop is not a cost.

Lock posture (deliberate)
=========================

alembic runs a migration inside ONE transaction, so a naive ``ADD COLUMN`` +
backfill would hold the ``ADD COLUMN``'s ``ACCESS EXCLUSIVE`` lock on
``coord.work_units`` through the whole backfill — blocking every scanner
upsert, every Plans-page read and every MCP ``coord_work_unit_*`` call for that
window. Same two guards as ``coord_sessions_work_unit_slug``:

* ``SET LOCAL lock_timeout = '3s'`` — the ``ADD COLUMN`` fails FAST rather than
  queueing behind an in-flight query (a queued ``ACCESS EXCLUSIVE`` request
  itself blocks every new reader that arrives behind it).
* the backfill runs in ``op.get_context().autocommit_block()`` — entering the
  block commits the DDL, so the ``ACCESS EXCLUSIVE`` lock is RELEASED before
  the row-rewriting backfill starts. The backfill then takes only row-level
  locks and never blocks a reader. Splitting the two is safe precisely because
  each half is independently idempotent.

``ADD COLUMN`` of a nullable column with no default is a catalog-only change in
PG11+ (no table rewrite).

Rollout ordering
================

1. **THIS revision** (qontinui-web) lands on ``main``; ``migrate.yml`` builds
   ``qontinui-migrator:staging`` and applies it to the canonical RDS. Safe
   against the currently-deployed coord, which does not know the column exists
   — it neither reads nor writes it.
2. Runner (Phase B) sends ``authored_at`` on every coord-sink upsert. Safe
   against a pre-Phase-D coord: ``UpsertRequest`` has no ``deny_unknown_fields``,
   so the extra field is ignored, not rejected.
3. coord (Phase D) stores and serves it — reads ``w.authored_at`` in
   ``list_work_units`` / ``get_work_unit_by_slug``. coord's
   ``schema_read_contract`` gate asserts every ``coord.<table>.<column>`` a SQL
   literal reads exists at the alembic head of the PINNED migrator image
   (``.github/workflows/ci.yml`` ``MIGRATOR_DIGEST`` / ``MIGRATOR_ALEMBIC_HEAD``),
   so the coord PR must bump that pin to an image containing THIS revision in
   the same PR. That gate is what enforces "coord reads land AFTER this", and
   why the read is never waived ahead of the migration.

Idempotency / authorship posture
================================

* DDL uses ``ADD COLUMN IF NOT EXISTS`` / ``DROP COLUMN IF EXISTS`` raw SQL,
  every statement schema-qualified as ``coord.work_units`` — matching the
  ``coord.*`` migration house style. Re-running against an already-applied DB is
  a no-op.
* **alembic is the SOLE author of the coord.* schema.** No Rust
  ``CREATE``/``ALTER`` self-heal; the coord crate only SELECTs / INSERTs /
  UPDATEs this column.
* ``downgrade`` drops only ``authored_at``. ``created_at`` is a truthful record
  of when coord first saw the row and is not touched in either direction.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_wu_authored_at_01"
down_revision: str | Sequence[str] | None = "atu_02_atu_provenance"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# The slug-prefix backfill. See the module docstring for why it is a per-row
# DO block rather than one UPDATE (a non-calendar prefix must not abort the
# pipeline-applied migration) and why the value is built from an explicit
# `...T00:00:00Z` literal rather than to_timestamp (session-time-zone
# independence). Both regexes are ANCHORED and require the trailing dash so the
# eligibility predicate is the runner's `authored_at_from_stem` exactly.
#
# The message is assembled with `||` under `USING MESSAGE =` rather than RAISE's
# own `%` placeholders so the statement carries no `%` for the DBAPI paramstyle
# layer to misread. Dollar-quoted, so the regex backslashes reach Postgres
# unescaped (the Python string is raw for the same reason).
_BACKFILL_SQL = r"""
DO $backfill$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT id,
               slug,
               substring(slug from '^\d{4}-\d{2}-\d{2}') AS ymd
          FROM coord.work_units
         WHERE authored_at IS NULL
           AND slug ~ '^\d{4}-\d{2}-\d{2}-'
    LOOP
        BEGIN
            UPDATE coord.work_units
               SET authored_at = (r.ymd || 'T00:00:00Z')::timestamptz
             WHERE id = r.id
               AND authored_at IS NULL;
        EXCEPTION
            WHEN datetime_field_overflow OR invalid_datetime_format THEN
                RAISE WARNING USING MESSAGE =
                    'coord.work_units ' || r.id::text || ' slug ' || r.slug
                    || ': prefix ' || r.ymd || ' is not a calendar date; '
                    || 'authored_at left NULL (not recorded)';
        END;
    END LOOP;
END
$backfill$
"""


def upgrade() -> None:
    # Bound the DDL's lock wait: a queued ACCESS EXCLUSIVE request blocks every
    # reader that arrives behind it, so fail fast instead of stalling coord's
    # scanner upserts and Plans-page reads behind one slow in-flight query.
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute(
        "ALTER TABLE coord.work_units "
        "ADD COLUMN IF NOT EXISTS authored_at TIMESTAMPTZ NULL"
    )

    # Backfill OUTSIDE the DDL transaction: entering the autocommit block
    # commits the ADD COLUMN, releasing its ACCESS EXCLUSIVE lock before the
    # row-rewriting backfill begins. Guarded by `authored_at IS NULL` so a
    # re-run is a no-op and never clobbers a value coord wrote later.
    with op.get_context().autocommit_block():
        op.execute(_BACKFILL_SQL)


def downgrade() -> None:
    op.execute("ALTER TABLE coord.work_units DROP COLUMN IF EXISTS authored_at")
