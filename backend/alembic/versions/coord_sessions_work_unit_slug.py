"""coord.sessions.work_unit_slug — EXPAND half of the plan_slug → work_unit_slug rename

Revision ID: coord_sessions_work_unit_slug
Revises: coord_memory_synthesis_jobs
Create Date: 2026-07-13

Stage 2a of plan
``D:/qontinui-root/plans/2026-07-06-coord-plan-slug-to-work-unit-slug-rename.md``
("retire the legacy plan_slug path across coord").

This is the **expand** half of an expand/contract column rename. ``coord.sessions``
carries an advisory nullable slug naming the unit of work a session is executing
(added as ``plan_slug`` by ``coord_sessions_plan_linkage``, back when coord still
had a first-class *plan* model). The plan model was retired in P4; the surviving
anchor is ``coord.work_units``. This revision lands the successor column so the
coord crate can cut over without a flag-day:

* ``work_unit_slug TEXT`` (nullable) — the slug of the work unit this session is
  executing (e.g. ``2026-07-06-coord-plan-slug-to-work-unit-slug-rename``).
  Nullable because not every session is work-unit-scoped. Deliberately a plain
  TEXT slug and **not** a FK to ``coord.work_units(id)``: like ``plan_slug``
  before it, this is an *advisory* correlation hint that may be recorded before
  (or without) a work-unit row ever existing. (Contrast
  ``coord.work_unit_pr_citations.work_unit_id``, which IS a hard FK — a citation
  can only be minted for a unit coord already knows.)

Both columns coexist after this revision. The contract half (dropping
``plan_slug``) is a LATER migration, and is only safe once no deployed coord
image writes ``plan_slug`` any more — see the ordering note below.

Backfill
========

``UPDATE coord.sessions SET work_unit_slug = plan_slug`` for every row that has a
``plan_slug`` — so readers can switch to the new column without a COALESCE for
historical rows. Guarded by ``work_unit_slug IS NULL`` so a re-run is a no-op.
``coord.sessions`` is a bounded operational table (sessions, not events), so a
single-statement backfill is appropriate; no batching required.

Rollout ordering (expand → dual-write → stop-write → contract)
==============================================================

1. **THIS revision** (expand): add + backfill ``work_unit_slug``. Safe against the
   currently-deployed coord, which does not know the column exists. Additive
   ``ADD COLUMN`` of a nullable column with no default is a catalog-only change
   in PG11+ (no table rewrite).
2. coord dual-writes both columns and reads ``work_unit_slug``. Deploy.
3. coord stops writing ``plan_slug`` entirely. Deploy.
4. Only THEN a contract migration may ``DROP COLUMN plan_slug``.

Dropping ``plan_slug`` before step 3 would break **every session INSERT** in the
live coord image (it still names the column), so the drop MUST NOT be folded into
this revision or the next one.

Idempotency / authorship posture
================================

* DDL uses ``ADD COLUMN IF NOT EXISTS`` / ``DROP COLUMN IF EXISTS`` raw SQL —
  matching the ``coord.*`` migration house style (see
  ``coord_sessions_plan_linkage``). coord boots against this same schema, so
  re-running against an already-applied DB must be a no-op.
* **alembic is the SOLE author of the coord.* schema.** No Rust
  ``CREATE``/``ALTER`` self-heal — the coord crate only SELECTs / INSERTs /
  UPDATEs this column.
* This web migration MUST be applied to prod RDS BEFORE the coord image that
  reads/writes ``work_unit_slug`` deploys, or coord errors on the missing column.
  (coord's deploy workflow enforces this with its migration-drift gate.)
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_sessions_work_unit_slug"
down_revision: str | Sequence[str] | None = "coord_memory_synthesis_jobs"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE coord.sessions ADD COLUMN IF NOT EXISTS work_unit_slug TEXT"
    )
    # Backfill the successor column from the legacy one. Guarded so a re-run
    # (or a run after coord has already begun dual-writing) is a no-op and never
    # clobbers a value coord wrote.
    op.execute(
        "UPDATE coord.sessions SET work_unit_slug = plan_slug "
        "WHERE plan_slug IS NOT NULL AND work_unit_slug IS NULL"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE coord.sessions DROP COLUMN IF EXISTS work_unit_slug")
