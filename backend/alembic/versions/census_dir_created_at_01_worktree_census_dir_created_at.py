"""census dir_created_at 01 — coord.worktree_census birth time of the observed directory

Revision ID: census_dir_created_at_01
Revises: leader_worker_runs_01
Create Date: 2026-10-14

Phase 2a of plan
``2026-10-14-declared-sibling-worktree-reaped-while-its-allocation-is-held``.

Adds one nullable column to the append-only ``coord.worktree_census`` oplog:

* ``dir_created_at TIMESTAMPTZ NULL`` — the birth time of the directory the
  runner observed at that census row's path. The runner reads it as the mtime
  of the worktree's ``.git`` gitlink file (written once by ``git worktree
  add``), falling back to the directory's creation time only when the gitlink
  is missing.

## Why coord needs it persisted

coord stamps ``reclaim_candidate_at`` once and keeps it with COALESCE
thereafter. A directory that is removed and then re-created at the same path
inherits that stamp, so its G5 grace has already run out and it is removed on
the next census tick. Phase 2b makes coord's effective candidacy time
``max(stamp, dir_created_at)``, so a directory born after the stamp waits a
full grace again. That decision spans ticks, so the birth time has to live in
a persisted census column; it cannot ride the instruction alone. (The runner's
own incarnation refusal, Phase 2c, needs no column — coord echoes the value
back on the remove instruction.)

Alembic in qontinui-web is the sole author of the ``coord.*`` schema (served
policy ``production-and-cost`` ``alembic-sole-authorship``), and this revision
must land BEFORE coord reads the column. Hand-authored — ``alembic revision
--autogenerate`` is never run against ``coord.*``.

## Shape

* **Nullable, no default.** The census is an append-only oplog with a long
  tail of historical rows, and a runner that predates the reporting change
  simply omits the field. NULL means "not observed" and coord treats it as
  "no re-candidacy adjustment", never as a birth time. A ``now()`` default
  would read every legacy row as freshly born and restart every grace.
* **TIMESTAMPTZ.** coord compares it against ``reclaim_candidate_at`` and
  ``now()``; a naive ``timestamp`` would bend with the session zone.
* **No index.** Consumers reach it through the existing hot paths
  ``(device_id, observed_at DESC)`` and ``(repo, path)``; it is never a filter
  key, and the table is high-churn.
* **``IF NOT EXISTS`` / ``IF EXISTS``** so a partially-applied pipeline run can
  be re-run.

Additive and reversible: ``downgrade`` drops exactly this column. Roll back the
coord build that reads it first.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "census_dir_created_at_01"
# KEEP THIS ASSIGNMENT ON ONE LINE. Coord's alembic-graph parser (its mirror of
# this branch feeds deploy-coord.yml's drift gate) is line-scoped, so a
# formatter-wrapped `down_revision = (\n "..."\n)` yields no parent at all and
# counts as a second head — see plan_library_06_scan_root_slug_census.py.
down_revision: str | Sequence[str] | None = "leader_worker_runs_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE = "coord.worktree_census"
_COLUMN = "dir_created_at"


def upgrade() -> None:
    """Add the nullable birth time. NULL means "not observed"."""
    op.execute(
        f"ALTER TABLE {_TABLE} ADD COLUMN IF NOT EXISTS {_COLUMN} TIMESTAMPTZ NULL"
    )


def downgrade() -> None:
    """Drop it. Roll the coord build that reads it back first."""
    op.execute(f"ALTER TABLE {_TABLE} DROP COLUMN IF EXISTS {_COLUMN}")
