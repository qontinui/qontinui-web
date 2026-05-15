"""wave 6 02 merge sibling heads — bors batching + phase 1b declared paths

Revision ID: wave_6_02_merge_heads
Revises: coord_phase_1b_01_declared_overlap_paths, wave_6_01_coord_merge_batches
Create Date: 2026-05-16

Empty bookkeeping revision joining the two sibling heads that emerged
during Wave 6:

* ``coord_phase_1b_01_declared_overlap_paths`` (Phase 1B §4.10 — the
  declared-overlap-paths column on ``coord.agent_worktrees``)
* ``wave_6_01_coord_merge_batches`` (this wave — bors-style batching
  state for the merge scheduler)

Per [[feedback_alembic_sibling_head_merge]]: the second PR to ship
in a Wave that adds an alembic migration off a then-single head must
author an empty merge revision joining both heads. Without it the
``alembic-heads-pr`` gate fails and the canonical-stack migrator
container refuses to start. Shape mirrors the earlier
``8e1c421417fd_merge_heads`` and
``wave_3_merge_phase_3_and_row_9_phase_3`` revisions.

Nothing happens at upgrade time beyond stamping the new head.
"""

from collections.abc import Sequence

revision: str = "wave_6_02_merge_heads"
# Single-line tuple is intentional — the `alembic-graph-pr.yml` gate's
# offline parser regex matches `^down_revision: ... = (...)$` on one
# physical line. A multi-line tuple defeats the parser and the gate
# fails with "N heads" even though alembic itself accepts the merge.
down_revision: tuple[str, str] = ("coord_phase_1b_01_declared_overlap_paths", "wave_6_01_coord_merge_batches")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
