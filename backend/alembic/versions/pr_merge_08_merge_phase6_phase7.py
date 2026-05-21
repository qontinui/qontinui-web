"""pr_merge phase 6+7 sibling-head merge

Revision ID: pr_merge_08_merge_phase6_phase7
Revises: pr_merge_05_merge_escalations_meta, pr_merge_07_merge_heads
Create Date: 2026-05-22

Empty bookkeeping revision joining the two sibling heads that emerged
from parallel-session work on Phase 6 + Phase 7 of the PR Merge
Orchestrator:

* ``pr_merge_05_merge_escalations_meta`` (Phase 6 D6.1 + D6.4 — the
  ``coord.merge_escalations_meta`` sidecar table + ``coord.alerts``
  resolution columns + ``coord.merge_decisions.resolved_alert_id``).
* ``pr_merge_07_merge_heads`` (the parent merge of Phase 7 D7.4's
  ``coord.user_overrides`` table and Phase 1.1's
  ``coord.device_status.tenant_id`` column).

Per ``feedback_alembic_sibling_head_merge`` + the existing
``pr_merge_04_merge_heads`` / ``pr_merge_07_merge_heads`` /
``wave_7_01_merge_heads`` / ``wave_6_02_merge_heads`` pattern: the
second PR to ship in a wave that adds an alembic migration off the
then-single head must author an empty merge revision joining both
heads. Without it the canonical-stack migrator container refuses to
start (two heads is an alembic error, not a warning).

Phase 6 + Phase 7 don't touch each other's tables. The merge is purely
topological — both upgrade paths run independently and the result is
the same regardless of which was applied first.

Nothing happens at upgrade time beyond stamping the new head.
"""

from collections.abc import Sequence

# revision identifiers, used by Alembic.
revision: str = "pr_merge_08_merge_phase6_phase7"
# Single-line tuple is intentional — the ``alembic-graph-pr.yml`` gate's
# offline parser regex matches ``^down_revision: ... = (...)$`` on one
# line. Mirror of ``pr_merge_04_merge_heads`` / ``pr_merge_07_merge_heads``.
down_revision: tuple[str, str] = ("pr_merge_05_merge_escalations_meta", "pr_merge_07_merge_heads")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """No-op — this revision exists solely to merge the two sibling
    heads back into a single linear chain."""


def downgrade() -> None:
    """No-op — see upgrade()."""
