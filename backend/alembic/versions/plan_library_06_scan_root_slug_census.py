"""agent.plan_scan_root_observations — the per-device plan-stem census

Revision ID: plan_library_06_scan_root_slug_census
Revises: coord_repo_branches_touched_files_authoritative_01
Create Date: 2026-09-15

Phase 1 (web half) of
``2026-09-15-captured-vs-authored-coverage-is-a-set-difference``.

The gap
=======

Every shipped plan-capture surface counts a NUMERATOR and none owns a
DENOMINATOR, so the fleet has never been able to answer *"of the plans that
exist, how many did the corpus capture?"* The naive answers computed off a
single git ref have read 76.5% and 101.8% for the same corpus — the second
because the corpus is not a subset of any one trunk. The signal that survives
is a SET DIFFERENCE scoped to one ``source_repo``, and that needs the set of
stems that EXIST, which only the scanning device can enumerate.

It is the scanning device because the plan adapter's two halves read different
sources: the work-unit half reads the fetched default REF (``read_ref_dir``),
while the body sync that fills ``agent.work_artifacts`` reads the WORKING TREE
(``scan_one_root``). One process holds both listings; nothing else in the fleet
holds either.

What this revision does
=======================

Adds six nullable columns to ``agent.plan_scan_root_observations`` — no new
table, no new index, no new CHECK, and one row per ``(organization, device)``
unchanged:

* ``ref_census`` / ``ref_census_digest`` — the stems listed at the default ref.
* ``work_tree_census`` / ``work_tree_census_digest`` — the stems listed in the
  scanned working tree, the side that bounds what the corpus could capture.
* ``census_ref_sha`` — what the default ref pointed at when the ref census was
  listed.
* ``census_observed_at`` — the runner's clock for the report that carried one.

The two JSONB columns hold the request's ``PlanSlugCensus`` object whole
(``source``, ``ref_sha``, ``count``, ``digest``, ``slugs``, ``truncated``). The
digest is lifted into its own TEXT column because the upsert compares it: a
device may send ``slugs: null`` to mean *"unchanged since my last report"*, and
the stored stems are kept only when the digest matches — a mismatch clears them
to UNKNOWN rather than vouching for a set nobody claims. See
``app.crud.plan_scan_root``.

**Every column is nullable, and NULL is UNKNOWN, never an empty side.** At the
moment this lands no runner sends a census at all; an idle or failed scan cycle
sends none either. A reader that takes NULL for "this side holds no plans"
manufactures exactly the false-coverage reading the plan exists to remove.

That sentence is a claim about SQL NULL, and the DDL alone does not secure it:
SQLAlchemy's JSON types serialize a Python ``None`` as the JSON DOCUMENT
``null`` unless the column says ``JSONB(none_as_null=True)``, which would leave
``ref_census IS NULL`` FALSE and ``jsonb_typeof(ref_census)`` = ``'null'`` for
every UNKNOWN row — and a later ``WHERE ref_census IS NOT NULL`` meaning "this
device has a census" true for all of them. The model declares
``none_as_null=True`` for exactly that reason, and the migration test asserts
both predicates in raw SQL, which is the only place the two encodings are
distinguishable (JSONB ``null`` deserializes to Python ``None``).

No CHECK constraint is added. The census shape is the request schema's contract
(``app.schemas.plan_library_scan_roots``), which verifies the digest against the
stems it was computed over; a Postgres CHECK over JSON structure would be a
second, weaker copy of a rule that is already enforced where the error can name
the offending key.

Deploy ordering
===============

This revision, and the schema that accepts the census, MUST be deployed before
the runner half ships. ``ScanRootReport`` carries ``extra="forbid"``, so an
unknown field is a 422 that refuses the WHOLE report — and the runner builds
that body from its configuration, so such a 422 would silence that device on
every attempt, forever.

Downgrade
=========

Drops the six columns. The censuses are a live diagnostic every reporting
runner re-posts within one heartbeat, so nothing durable is lost.

Idempotency: every statement uses ``IF NOT EXISTS`` / ``IF EXISTS``, so a
partially-applied run re-runs cleanly.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "plan_library_06_scan_root_slug_census"
down_revision: str | Sequence[str] | None = (
    "coord_repo_branches_touched_files_authoritative_01"
)
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE = "agent.plan_scan_root_observations"

#: ``(column, type)`` — the order the upgrade adds them and the downgrade drops
#: them. Spelled once so the two halves cannot drift.
_CENSUS_COLUMNS: tuple[tuple[str, str], ...] = (
    ("ref_census", "JSONB"),
    ("ref_census_digest", "TEXT"),
    ("work_tree_census", "JSONB"),
    ("work_tree_census_digest", "TEXT"),
    ("census_ref_sha", "TEXT"),
    ("census_observed_at", "TIMESTAMPTZ"),
)


def upgrade() -> None:
    """Add the nullable census columns."""
    for column, column_type in _CENSUS_COLUMNS:
        op.execute(
            f"ALTER TABLE {_TABLE} ADD COLUMN IF NOT EXISTS {column} {column_type}"
        )


def downgrade() -> None:
    """Drop them. Every reporting runner re-posts within a heartbeat."""
    for column, _column_type in reversed(_CENSUS_COLUMNS):
        op.execute(f"ALTER TABLE {_TABLE} DROP COLUMN IF EXISTS {column}")
