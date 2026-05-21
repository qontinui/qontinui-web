"""pr_merge phase 4+5 sibling-head merge

Revision ID: pr_merge_04_merge_heads
Revises: pr_merge_03_merge_decisions, pr_merge_03_pr_dependencies
Create Date: 2026-05-21

Empty bookkeeping revision joining the two sibling heads that
emerged from parallel-session work on Phase 4 + Phase 5 of the
PR Merge Orchestrator:

* ``pr_merge_03_merge_decisions`` (Phase 4 D4.6 — coord.merge_decisions
  audit table for the merge-specialist subagent).
* ``pr_merge_03_pr_dependencies`` (Phase 5 D5.1 — coord.pr_dependencies
  cross-repo + same-repo dependency edges).

Per ``feedback_alembic_sibling_head_merge`` + the existing
``wave_6_02_merge_heads`` / ``wave_7_01_merge_heads`` / etc. pattern:
the second PR to ship in a wave that adds an alembic migration off
the then-single head must author an empty merge revision joining
both heads. Without it the canonical-stack migrator container
refuses to start (two heads is an alembic error, not a warning).

Phase 4 + Phase 5 don't touch each other's tables. The merge is
purely topological — both upgrade paths run independently and the
result is the same regardless of which was applied first.

Nothing happens at upgrade time beyond stamping the new head.
"""

from collections.abc import Sequence

# revision identifiers, used by Alembic.
revision: str = "pr_merge_04_merge_heads"
# Single-line tuple is intentional — the ``alembic-graph-pr.yml``
# gate's offline parser regex matches ``^down_revision: ... = (...)$``
# on one line. Mirror of ``wave_6_02_merge_heads`` shape.
down_revision: tuple[str, str] = ("pr_merge_03_merge_decisions", "pr_merge_03_pr_dependencies")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """No-op — this revision exists solely to merge the two sibling
    heads back into a single linear chain."""


def downgrade() -> None:
    """No-op — see upgrade()."""
