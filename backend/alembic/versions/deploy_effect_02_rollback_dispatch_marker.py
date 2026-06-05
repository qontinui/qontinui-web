"""deploy-effect 02 durable rollback-dispatch marker on coord.deploy_signatures

Revision ID: deploy_effect_02_rollback_dispatch_marker
Revises: twin_p6_01_worktree_reclaim_lifecycle
Create Date: 2026-06-05

Auto-rollback arming prerequisite for the deploy-action effect-signatures plan
(``2026-05-31-deploy-action-effect-signatures`` §4 Phase 4). coord's
``deploy_rollback::maybe_dispatch_rollback`` is at-most-once via an in-process
``HashSet`` today — a coord restart forgets it, and with >=2 ECS replicas the
set is per-task, so two replicas verifying the same failed signature could each
dispatch the rollback workflow. Before ``QONTINUI_DEPLOY_AUTO_ROLLBACK_ARMED``
is ever flipped on, the marker must be durable AND cluster-wide.

``rollback_dispatched_at`` is that marker: coord claims it atomically
(``UPDATE ... SET rollback_dispatched_at = now() WHERE id = $1 AND
rollback_dispatched_at IS NULL RETURNING id``) BEFORE dispatching — zero rows
means another process/replica already owns the dispatch. NULL (the default,
and the backfill for every existing row) means "never dispatched".

Same best-effort, non-boot-gated overlay posture as ``deploy_effect_01``: the
coord Rust side tolerates the column's absence (a failed claim fails CLOSED —
no dispatch — which is the correct direction for a rollback action).
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "deploy_effect_02_rollback_dispatch_marker"
down_revision: str = "twin_p6_01_worktree_reclaim_lifecycle"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the durable at-most-once rollback-dispatch marker."""
    op.execute(
        """
        ALTER TABLE coord.deploy_signatures
            ADD COLUMN IF NOT EXISTS rollback_dispatched_at TIMESTAMPTZ NULL
        """
    )


def downgrade() -> None:
    """Drop the marker column (reversible — it is an idempotence latch only)."""
    op.execute(
        """
        ALTER TABLE coord.deploy_signatures
            DROP COLUMN IF EXISTS rollback_dispatched_at
        """
    )
