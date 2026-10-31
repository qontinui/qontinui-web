"""coord.agent_status.intent_globs_declared — how many intent globs a row SHOULD hold

Revision ID: agent_status_intent_globs_declared_01
Revises: slice_tel_01
Create Date: 2026-10-30

Phase 2 of plan
``qontinui-dev-notes/plans/2026-10-23-coord-declare-intent-silently-keeps-only-the-first-eight-explicit-globs.md``
(design decision D3).

coord authors **zero** ``coord.*`` DDL (``[policy: alembic-sole-authorship]``),
so the one column coord's Phase 3 reads and writes lands here, and this
revision must be applied **before** coord touches it. Hand-authored;
``alembic revision --autogenerate`` was not run and is never run against
``coord.*``. Chained off the single head at authoring time.

Why
===

``coord_declare_intent`` stores a capped ``coord.agent_status.intent_globs``
array. When the cap (or another scope-losing filter) drops entries, a peer
reading the row cannot tell a complete declaration from a truncated one, so a
no-collision verdict reads ``clear`` while the declarer's real scope is wider
than what was recorded. D3's consumer rule
(``unknown-must-not-render-as-a-default``): a truncated row must withhold
clearance. This column is what lets a reader see it.

What the column carries (D3)
============================

* For the **explicit** and **heuristic** legs: the recorded glob count PLUS
  the number of SCOPE-LOSING drops (``absolute``, ``overlong``, ``over_cap``,
  ``invalid_glob``; D2). Duplicate and blank entries are NOT counted — a
  dropped duplicate loses no scope, and counting it would pin every peer's
  verdict in the tenant to ``unknown`` for as long as the row lives.
* For the **LLM** leg: the recorded count only, so coord's own guess never
  reads as truncated (that leg's contract is "0-8 entries; missing an overlap is
  acceptable"). The declarer still sees ``intent_globs_truncated`` in the
  response.
* ``NULL``: the row was written by a coord build that predates Phase 3 (or
  before ``schema_readiness`` observed this column). It means *not known to be
  truncated* — readers treat it exactly as rows read today.

Readers flag a row as partially blind when
``array_length(intent_globs, 1) > 0 AND intent_globs_declared >
array_length(intent_globs, 1)``. The non-empty guard keeps that arm disjoint
from the existing blind count (an EMPTY row is already counted blind and stays
so). The name is deliberately not ``intent_globs_supplied``: the response field
of that name is the raw count as sent, and one name never carries two
quantities.

Ordering and readiness
======================

Phase 3 of the plan will have coord read and write this column only once its
``schema_readiness`` probe observes it ``Present``; on ``Missing`` / ``Unknown``
it will write today's statement, and the truncated count reads UNKNOWN and folds
as incomplete, never as zero. Neither deploy order fails a declare, though with
coord deployed first every no-collision verdict reads ``unknown`` until the
column is observed. Phase 2's gate orders this revision first, which also means an image
exists for Phase 3's migrator pin. This revision on its own changes no behaviour.

Type: ``INTEGER`` (Postgres int4). coord must bind and read it as ``i32`` /
``Option<i32>`` — a read as ``i64`` of an int4 column fails with no SQLSTATE,
and ``Row::get`` panics on it. A declaration's glob count is bounded far below
2^31.

Nullable with no default: the ADD is a catalogue-only change (no table
rewrite) and needs no backfill — every existing row correctly reads NULL,
"not known to be truncated". Downgrade drops the column.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "agent_status_intent_globs_declared_01"
down_revision: str | Sequence[str] | None = "slice_tel_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the nullable declared-count column and document it in the catalogue."""
    # `IF NOT EXISTS` matches on NAME only; acceptable because no revision in
    # this chain spells `intent_globs_declared` (coord.agent_status is created
    # by `coord_agent_status` and not altered since).
    # coord writes coord.agent_status on every declare and heartbeat; bound the
    # ACCESS EXCLUSIVE wait rather than queue every writer behind it.
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute(
        """
        ALTER TABLE coord.agent_status
            ADD COLUMN IF NOT EXISTS intent_globs_declared INTEGER
        """
    )

    op.execute(
        """
        COMMENT ON COLUMN coord.agent_status.intent_globs_declared IS
            'How many intent globs this row should hold. Explicit/heuristic '
            'legs: recorded count plus scope-losing drops (absolute, overlong, '
            'over_cap, invalid_glob; not duplicates or blanks). LLM leg: the '
            'recorded count. A row with a non-empty intent_globs and '
            'intent_globs_declared > array_length(intent_globs, 1) is '
            'truncated, and readers withhold clearance on it. NULL = written '
            'by a coord before this column was read (not known to be '
            'truncated). Phase 3 of plan 2026-10-23-coord-declare-intent-silently-'
            'keeps-only-the-first-eight-explicit-globs writes it, only once '
            'schema_readiness observes the column. int4: read as i32.'
        """
    )


def downgrade() -> None:
    """Exact inverse — drop the column."""
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute(
        "ALTER TABLE coord.agent_status DROP COLUMN IF EXISTS intent_globs_declared"
    )
