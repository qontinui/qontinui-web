"""wave 3 merge — Coord Phase 3 §4.5 + Row 9 Phase 3 sibling heads

Revision ID: wave_3_merge_phase_3_and_row_9_phase_3
Revises: coord_phase_3_01_merge_proposals, row_9_phase_3_01_machines_state
Create Date: 2026-05-15

Empty merge revision per ``feedback_alembic_sibling_head_merge``: two
Wave 3 PRs each added one alembic head off the same parent
(``row_9_phase_2_01_revoked_tokens``). Without this merge the
``alembic-heads-pr`` gate fails on the second-to-ship PR.

The sibling heads:

* ``coord_phase_3_01_merge_proposals`` — Coordination Phase 3
  (Wave 3 Prompt 1; landed as qontinui-web PR #119,
  merged at fdb10229).
* ``row_9_phase_3_01_machines_state`` — Row 9 Phase 3 health-watcher
  schema (this stream; qontinui-web PR #120).

Same shape as ``8e1c421417fd_merge_heads.py`` per the memory.
"""

from collections.abc import Sequence

revision: str = "wave_3_merge_phase_3_and_row_9_phase_3"
down_revision: tuple[str, str] = ("coord_phase_3_01_merge_proposals", "row_9_phase_3_01_machines_state")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """No-op — pure graph join."""


def downgrade() -> None:
    """No-op — pure graph join."""
