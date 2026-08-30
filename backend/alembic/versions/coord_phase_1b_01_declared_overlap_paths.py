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

* The two columns serve different consumers, and the persisted array is
  the one overlap detection can actually read. ``declared_overlap_paths``
  is a structured array consumed by ``detect_overlap`` for
  set-intersection comparison against other live agents' declared paths,
  under the GIN index created below. ``intent`` is free text.
* **``intent`` is not opaque to coord — it is parsed, twice**, and one of
  those parses populates THIS column.
  ``agent_worktrees::resolve_overlap_paths`` derives
  ``declared_overlap_paths`` from the intent text (via
  ``intent_paths::derive_best_effort``) whenever the caller supplies no
  paths — which the next bullet has described since Phase 1B, so calling
  ``intent`` "opaque human text shown in dashboards", as this bullet did
  until 2026-08-29, contradicted this same docstring on the day it was
  written. Separately, ``worktree_reclaim::parse_shepherd_intent`` has
  read the column since qontinui-coord #1597, to recover a shepherd
  worktree's target PR and tier from the un-truncated intent rather than
  from the 60-character branch slug. The full account of what parses
  ``intent`` lives on the column itself, in
  ``coord_phase_1_01_agent_worktrees`` — keep it there rather than
  restating it here, so the two copies cannot drift apart.
* Agent-supplied paths and derived paths share the same column; the
  source-of-truth is "what's persisted." Re-derivation runs only when the
  agent does not supply paths, and its policy is LLM → deterministic
  heuristic → nothing, with the 5-second budget wrapped inside the one
  door (``intent_paths::derive_best_effort``). This bullet said
  "LLM-derived" until 2026-08-29: the deployment carries no LLM
  credential, so the heuristic leg is the one that actually runs. It
  exists because the LLM-only version recorded an EMPTY glob set for
  every free-text intent, and an empty set reads as "clear" rather than
  "unknown" to every downstream overlap check — see plan
  ``2026-07-31-coord-declare-intent-records-empty-scope``.
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
