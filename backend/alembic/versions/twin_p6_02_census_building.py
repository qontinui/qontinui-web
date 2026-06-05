"""twin p6 02 — Ξ_Worktree census ``building`` (G6 shadow-mode prove-out)

Revision ID: twin_p6_02_census_building
Revises: coord_gates_clearance_audience
Create Date: 2026-06-05

Follow-up to ``twin_p6_01_worktree_reclaim_lifecycle`` (plan
``2026-06-05-twin-worktree-phase6-lifecycle-reclaim``, SHIPPED): the G6
in-flight-build guard ships runner-side but its outcomes were runner-local
log lines only, AND the guard only evaluated when an action was armed — so
the Q1 graduation gate ("flip rejunction default-on once G6 is proven") had
no passively-collectable evidence. This column is the census-carried half of
G6 **shadow mode**: the runner now probes ``worktree_is_building()`` for
every censused worktree each tick and reports the result here, so coord can
gauge "instructions that WOULD have been skipped (building)" with arming
still safely OFF.

Column
======

* ``coord.worktree_census.building BOOLEAN`` (nullable) — the runner-side G6
  probe result (cargo ``.cargo-lock`` exclusive-open probe + recent-activity
  mtime window). NULL = old runner / probe unavailable (honest unknown).
  Sits alongside ``is_dirty`` / ``landed_in_main`` on the per-tick census
  oplog row.

Expand-only / forward-only, nullable, no backfill, no index — identical
posture and rationale to ``twin_p6_01_worktree_reclaim_lifecycle`` (pure
derived per-tick fact; legacy rows carry NULL; census facts are read via the
existing census indexes, never point-looked-up by this column). alembic
remains the SOLE author of the ``coord.*`` schema.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "twin_p6_02_census_building"
down_revision: str = "coord_gates_clearance_audience"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE coord.worktree_census ADD COLUMN IF NOT EXISTS building BOOLEAN"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE coord.worktree_census DROP COLUMN IF EXISTS building")
