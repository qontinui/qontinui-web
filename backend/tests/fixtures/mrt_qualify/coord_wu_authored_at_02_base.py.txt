"""coord.work_units.authored_at — refill dated slugs created after the first backfill

Revision ID: coord_wu_authored_at_02
Revises: devconn_inst_01_device_connections_instance
Create Date: 2026-09-13

Follow-up to ``coord_wu_authored_at_01`` (plan
``2026-09-02-coord-work-units-carry-no-authoring-date``) and qontinui-web#1348.

Problem
=======

``coord_wu_authored_at_01`` backfilled ``authored_at`` from the slug's
``YYYY-MM-DD-`` prefix ONCE, for the rows that existed when it ran. Two writers
have created dated units since without supplying a date:

* the ``coord_work_unit_upsert`` MCP door, whose ``authored_at`` argument is
  optional and which most callers omit; and
* runner builds predating Phase B of that plan, which never send it.

coord's upsert stored ``authored_at`` only when the caller supplied it, so those
rows read NULL. Measured against coord on 2026-09-13 (``coord_work_unit_list``,
``shepherd-`` excluded): **29** units with a dated slug and a NULL column, every
one created since 2026-09-10 — the NEWEST units in the corpus. The Plans page
now derives the date from the slug itself (qontinui-web#1348, ``planAuthoredAt``),
but every other reader of the column — ``coord_work_unit_list``, the work-unit
HTTP doors, ``/chart`` — still sees "not recorded" for a plan whose slug names
its authoring day.

The companion qontinui-coord change makes ``upsert_work_unit`` derive the date
from a dated slug when the caller omits it, which closes the source. This
revision repairs the rows already written. **Land and deploy that coord change
FIRST**: a dateless dated-slug row created between this revision applying and
the coord deploy would read NULL again, and nothing re-runs this refill. The
web PR carries a ``coord:downstream-of`` label on the coord PR for that reason.

What it does
============

Re-runs ``coord_wu_authored_at_01``'s backfill, unchanged: for every row with
``authored_at IS NULL`` whose slug starts with an anchored ``YYYY-MM-DD-``, set
``authored_at`` to midnight UTC on that date. The block is copied VERBATIM from
that revision rather than imported (alembic version modules are not an
importable package) — a test pins the two byte-equal — so the eligibility
predicate stays the runner's ``authored_at_from_stem`` exactly, and so do its
three protections:

* anchored regex with the trailing dash (``feature-2026-01-01-x`` and a bare
  ``2026-05-14`` stay undated);
* an explicit ``...T00:00:00Z`` literal, so the stored instant does not depend
  on the migrator's session time zone;
* a per-row ``EXCEPTION`` handler, so one non-calendar prefix
  (``2026-02-30-…``) leaves that row NULL with a ``WARNING`` instead of rolling
  back the whole pipeline-applied migration.

Guarded by ``authored_at IS NULL`` in both the scan and the ``UPDATE``, so a
value any writer stored — including a caller-supplied time of day on a
bodyless unit — is never replaced, and a re-run is a no-op.

Lock posture
============

No DDL, so no ``ACCESS EXCLUSIVE`` lock and no ``autocommit_block`` split: the
``UPDATE`` takes row locks on the few dozen rows it touches and blocks no
reader. There is deliberately NO ``lock_timeout``. ``coord_wu_authored_at_01``
set one only to bound its ``ADD COLUMN``, then escaped it by running the
backfill in an autocommit block. Here the loop would run INSIDE the timed
transaction, and the per-row handler catches only datetime errors — so a
scanner upsert holding one row for a few seconds would raise
``lock_not_available`` and fail the unattended ``migrate.yml`` run for no safety
gain. Waiting on a row lock is the right behaviour for a data-only revision.

Downgrade
=========

A no-op. The rows this fills are indistinguishable afterwards from rows coord
dated itself, and nulling ``authored_at`` for every dated slug would destroy
dates the first backfill and the runner wrote. The column's DDL belongs to
``coord_wu_authored_at_01``, whose downgrade drops it.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
#
# `down_revision` stays on ONE line, unannotated: the CI head gate
# (`scripts/ci/_alembic_graph.py`) reads it with a single-line regex, and the
# annotated form is long enough for the formatter to wrap it in parentheses,
# which that gate parses as "no parent" and counts as a second head.
revision: str = "coord_wu_authored_at_02"
down_revision = "devconn_inst_01_device_connections_instance"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# Verbatim from coord_wu_authored_at_01 — see that revision's docstring for the
# per-row DO block, the time-zone-independent literal and the anchored regex.
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
    op.execute(_BACKFILL_SQL)


def downgrade() -> None:
    # Deliberately a no-op — see "Downgrade" in the module docstring.
    pass
