"""coord phase 1b 01 declared_overlap_paths

Revision ID: coord_phase_1b_01_declared_overlap_paths
Revises: fleet_phase_1_01_machine_budget
Create Date: 2026-05-14

Phase 1B of the branch-per-agent coordination plan
(``D:/qontinui-root/plans/2026-05-14-branch-per-agent-coordination-plan.md``
§4.10). Adds ``coord.agent_worktrees.declared_overlap_paths`` — the
per-agent file/glob set used by the L2 overlap-broadcast layer.

Rechained 2026-05-15 onto the then-current single head
``fleet_phase_1_01_machine_budget``. The original branch chained off
``coord_phase_1_01_agent_worktrees`` (a mid-chain ancestor, not a
head) and carried a second revision
``coord_phase_1b_02_merge_revoked_tokens`` that merged this with the
sibling ``row_9_phase_2_01_revoked_tokens`` head. Both
``coord_phase_1_01_agent_worktrees`` and ``row_9_phase_2_01_revoked_tokens``
have since landed on main as mid-chain ancestors of the single head,
so the merge revision is obsolete and was dropped — this is now a
plain single-parent revision off the current head.

Why a separate column rather than reusing ``intent``:

* The two columns serve different consumers. ``intent`` is opaque
  human text shown in dashboards; ``declared_overlap_paths`` is a
  structured array consumed by ``detect_overlap`` for set-intersection
  comparison against other live agents' declared paths.
* Agent-supplied paths and LLM-derived paths share the same column;
  the source-of-truth is "what's persisted." Re-derivation runs only
  when the agent does not supply paths.
* The column is nullable because Phase 1 rows pre-exist this
  migration; new allocations always write at least an empty array.

Behavior is purely informational per §4.10: empty / stale paths
yield missed overlap signals, not breakage. The merge train remains
the authoritative conflict gate.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_phase_1b_01_declared_overlap_paths"
down_revision: str = "fleet_phase_1_01_machine_budget"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "agent_worktrees",
        sa.Column(
            "declared_overlap_paths",
            postgresql.ARRAY(sa.Text()),
            nullable=True,
        ),
        schema="coord",
    )

    # GIN index supports the array-overlap operator (``&&``) used by
    # ``detect_overlap`` to scan active agents in O(matching) rather
    # than O(all_active).
    op.create_index(
        "idx_agent_worktrees_overlap_paths_gin",
        "agent_worktrees",
        ["declared_overlap_paths"],
        schema="coord",
        postgresql_using="gin",
    )


def downgrade() -> None:
    op.execute(
        "DROP INDEX IF EXISTS coord.idx_agent_worktrees_overlap_paths_gin"
    )
    op.drop_column("agent_worktrees", "declared_overlap_paths", schema="coord")
