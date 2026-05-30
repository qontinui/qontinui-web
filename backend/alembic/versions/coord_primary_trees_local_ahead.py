"""coord.primary_trees.local_ahead — unpushed-ahead count on the local default branch

Revision ID: coord_primary_trees_local_ahead
Revises: twin_02_coord_infra_drift_observations
Create Date: 2026-05-30

Phase 0 of plan
``D:/qontinui-root/plans/2026-05-30-coordination-pull-decision.md``
(Coordination-Layer Pull Decision — the ``repo_pull`` decision domain).

Adds the single new persisted git-state field the ``repo_pull`` verdict
needs that ``coord.primary_trees`` lacks today: ``local_ahead`` — the
number of commits the machine's LOCAL default branch (``main``) is ahead
of ``origin/<default>``, i.e. unpushed local commits on default.

Why the verdict needs it (plan §4 ladder step 4): a *clean, default-branch*
tree that is ``local_ahead > 0`` is DIVERGED — someone has an unpushed
commit on ``main``. Auto-pulling (even ff-only) is exactly the destructive
move ``/pull-scoped`` forbids, so that case must self-escalate. Without
this column coord cannot distinguish "clean + safe to ff" from "clean but
locally ahead → must escalate".

``coord.primary_trees`` already tracks ``behind_count`` (HEAD behind
``origin/<branch>``), ``dirty`` / ``dirty_files`` / ``untracked_count``,
and ``head_detached`` — but has *no* unpushed-ahead column. This migration
adds exactly that one column.

* ``local_ahead INT NOT NULL DEFAULT 0`` — ``git rev-list --count
  origin/<default>..<default>`` as computed by the runner publisher
  (``capture_tree``). ``0`` means "local default is not ahead of origin"
  (the common, safe case). ``DEFAULT 0`` is a fast metadata-only default
  on PG 11+, safe to add to a populated table; pre-Phase-0 runners that do
  not yet report the field leave it at the default until they ship the
  publisher change.

Idempotency: ``ADD COLUMN IF NOT EXISTS`` so a re-apply (or a canonical-PG
that already carries the column from a manual reconcile) is a strict
no-op. Mirrors the ``coord.primary_trees`` test fixture in
``qontinui-coord/src/primary_trees.rs::create_primary_trees_for_test``.

Chains off ``twin_02_coord_infra_drift_observations`` — the single linear
head of the coord migration chain verified via ``alembic heads`` 2026-05-30
(``feedback_verify_origin_state_before_phase_start``).

alembic is the SOLE author of ``coord.*`` schema
(``proj_alembic_sole_author_coord_schema``); the coord Rust binary asserts
table presence at boot and never authors DDL in production. This column is
authored here, not in Rust.
"""

from collections.abc import Sequence

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "coord_primary_trees_local_ahead"
down_revision: str = "twin_02_coord_infra_drift_observations"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add ``coord.primary_trees.local_ahead``. Idempotent."""
    op.execute(
        """
        ALTER TABLE coord.primary_trees
            ADD COLUMN IF NOT EXISTS local_ahead INT NOT NULL DEFAULT 0
        """
    )


def downgrade() -> None:
    """Drop ``coord.primary_trees.local_ahead``."""
    op.execute("ALTER TABLE coord.primary_trees DROP COLUMN IF EXISTS local_ahead")
