"""twin p7 03 — Ξ_Worktree canonical-checkout state (§3.2 twin fact)

Revision ID: twin_p7_03_canonical_checkout_state
Revises: blast_radius_gate_cols_01
Create Date: 2026-06-06

Phase 7.3 of plan ``2026-06-06-twin-worktree-phase7-informed-isolation`` (DRAFT):
the census already walks the tree but is blind to the *canonical checkout's* own
git state — the input the SharedBranch safety preconditions (P1 clean / P2 right
base, §3.3) need. These columns are the census-carried half: the runner census
producer reports, per canonical repo checkout, its current branch, dirty bit, and
base divergence; coord ingests them into ``TwinSnapshot`` so ``decide_isolation``
can prove (or fail to prove) that the shared-branch fast path is safe.

Columns
=======

* ``coord.worktree_census.canonical_current_branch TEXT`` (nullable) —
  ``git symbolic-ref --short HEAD`` of the canonical checkout. NULL = old runner /
  unavailable (honest unknown → P2 unprovable → conservative Worktree).
* ``coord.worktree_census.canonical_is_dirty BOOLEAN`` (nullable) —
  ``git status --porcelain`` non-empty. NULL = unknown → P1 unprovable.
* ``coord.worktree_census.canonical_base_divergence TEXT`` (nullable) —
  ahead/behind vs the request's intended base (or "on <branch>").

Expand-only / forward-only, nullable, no backfill, no index — identical posture
and rationale to ``twin_p6_02_census_building``: pure derived per-tick facts,
legacy rows carry NULL, census facts read via existing census indexes. alembic
remains the SOLE author of the ``coord.*`` schema. Every precondition degrades to
Worktree under missing facts, so no behavior change until the producer ships.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "twin_p7_03_canonical_checkout_state"
down_revision: str | Sequence[str] | None = "blast_radius_gate_cols_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE coord.worktree_census "
        "ADD COLUMN IF NOT EXISTS canonical_current_branch TEXT"
    )
    op.execute(
        "ALTER TABLE coord.worktree_census "
        "ADD COLUMN IF NOT EXISTS canonical_is_dirty BOOLEAN"
    )
    op.execute(
        "ALTER TABLE coord.worktree_census "
        "ADD COLUMN IF NOT EXISTS canonical_base_divergence TEXT"
    )


def downgrade() -> None:
    op.execute(
        "ALTER TABLE coord.worktree_census "
        "DROP COLUMN IF EXISTS canonical_base_divergence"
    )
    op.execute(
        "ALTER TABLE coord.worktree_census "
        "DROP COLUMN IF EXISTS canonical_is_dirty"
    )
    op.execute(
        "ALTER TABLE coord.worktree_census "
        "DROP COLUMN IF EXISTS canonical_current_branch"
    )
