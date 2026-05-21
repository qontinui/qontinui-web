"""pr_merge phase 7 sibling-head merge — user_overrides + device_status tenant scope

Revision ID: pr_merge_07_merge_heads
Revises: pr_merge_06_user_overrides, coord_device_status_tenant_id
Create Date: 2026-05-21

Empty bookkeeping revision joining the two sibling heads that emerged
from parallel work landed off ``pr_merge_04_merge_heads``:

* ``pr_merge_06_user_overrides`` (Phase 7 D7.4 — coord.user_overrides
  table for author + operator + drift override audit).
* ``coord_device_status_tenant_id`` (Phase 1.1 follow-up — tenant_id
  column on coord.device_status, shipped in #190 in parallel).

Per ``feedback_alembic_sibling_head_merge`` + the existing
``pr_merge_04_merge_heads`` / ``wave_6_02_merge_heads`` /
``wave_7_01_merge_heads`` pattern: the second PR to ship in a wave that
adds an alembic migration off the then-single head must author an empty
merge revision joining both heads. Without it the canonical-stack
migrator container refuses to start (two heads is an alembic error, not
a warning).

The two parent revisions don't touch each other's tables. The merge is
purely topological — both upgrade paths run independently and the
result is the same regardless of which was applied first.

Nothing happens at upgrade time beyond stamping the new head.
"""

from collections.abc import Sequence

# revision identifiers, used by Alembic.
revision: str = "pr_merge_07_merge_heads"
# Single-line tuple is intentional — the ``alembic-graph-pr.yml`` gate's
# offline parser regex matches ``^down_revision: ... = (...)$`` on one
# line. Mirror of ``pr_merge_04_merge_heads`` / ``wave_6_02_merge_heads``
# shape.
down_revision: tuple[str, str] = ("pr_merge_06_user_overrides", "coord_device_status_tenant_id")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """No-op — this revision exists solely to merge the two sibling
    heads back into a single linear chain."""


def downgrade() -> None:
    """No-op — see upgrade()."""
