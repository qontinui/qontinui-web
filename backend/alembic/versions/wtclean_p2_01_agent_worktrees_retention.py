"""wtclean p2 01 -- coord.agent_worktrees.retention keep-for-follow-up pin

Revision ID: wtclean_p2_01_agent_worktrees_retention
Revises: coord_policy_clauses_01
Create Date: 2026-07-19

Phase 2 (schema half) of the worktree cleanup / lifecycle-tracking plan
(``2026-07-19-worktree-cleanup-lifecycle-tracking``). Builds on the Phase-6
reclaim-lifecycle columns added by ``twin_p6_01_worktree_reclaim_lifecycle``
(``reclaim_candidate_at`` / ``trigger_signal``).

Column added
============

* ``coord.agent_worktrees.retention TEXT NOT NULL DEFAULT 'auto'`` -- the
  operator/agent-settable *keep-for-follow-up pin*:

  - ``'auto'``   -- the worktree participates in normal reclaim. A genuinely
    done worktree eventually reclaims. **This is deliberately the default**:
    it matches today's behavior exactly (every existing row backfills to
    ``'auto'``), so there is no silent unbounded disk growth and the common
    case self-cleans.
  - ``'pinned'`` -- explicit opt-in: the worktree is being kept for follow-up
    work and must be excluded from the reclaim candidate set regardless of
    the G-gate signals.

  ``NOT NULL DEFAULT 'auto'`` means the column needs no backfill statement --
  Postgres 11+ materializes the default for existing rows without a table
  rewrite.

Constraint
==========

* ``coord_agent_worktrees_retention_check`` -- ``CHECK (retention IN ('auto',
  'pinned'))``. This follows the house idiom for enum-ish TEXT columns on
  ``coord.*`` (see ``coord_gates_clearance_audience`` for the identical
  add-column-then-add-constraint shape, and ``coord_phase_1_01_agent_worktrees``
  where ``status`` itself is TEXT + CHECK rather than a PG ENUM -- TEXT + CHECK
  survives schema drift better because widening the value set is a plain
  DROP/ADD CONSTRAINT instead of an ENUM ALTER needing its own transaction).

  Note this differs from ``trigger_signal``, which is intentionally
  *un*-CHECKed because later phases add new signal kinds. ``retention`` is a
  closed two-valued pin whose semantics are the reclaim gate itself, so a
  typo'd value silently changing reclaim behavior is exactly what the CHECK
  must prevent.

Index
=====

* ``idx_agent_worktrees_retention_pinned`` -- **partial** index
  ``WHERE retention = 'pinned'``. Precedent:
  ``idx_agent_worktrees_work_unit_id`` on this same table is a partial index
  chosen for the same reason -- pinned rows are the rare, specifically
  queried-for subset ("show me everything being kept for follow-up" / "exclude
  pins from the reclaim sweep"), so a partial index stays tiny while the
  overwhelmingly-common ``'auto'`` rows never enter it.

Idempotency / authorship posture
================================

DDL uses ``ADD COLUMN IF NOT EXISTS`` / ``DROP ... IF EXISTS`` raw SQL,
matching the ``coord.*`` migration house style. **alembic in qontinui-web is
the sole author of the coord.* schema** -- the Rust in qontinui-coord runs no
``coord.*`` DDL (CI-enforced, no allowlist), so this migration is the only
place the column exists.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "wtclean_p2_01_agent_worktrees_retention"
down_revision: str | Sequence[str] | None = "coord_policy_clauses_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE coord.agent_worktrees
            ADD COLUMN IF NOT EXISTS retention TEXT NOT NULL DEFAULT 'auto'
        """
    )
    op.execute(
        """
        ALTER TABLE coord.agent_worktrees
            DROP CONSTRAINT IF EXISTS coord_agent_worktrees_retention_check
        """
    )
    op.execute(
        """
        ALTER TABLE coord.agent_worktrees
            ADD CONSTRAINT coord_agent_worktrees_retention_check
            CHECK (retention IN ('auto', 'pinned'))
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_agent_worktrees_retention_pinned
            ON coord.agent_worktrees (retention)
            WHERE retention = 'pinned'
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS coord.idx_agent_worktrees_retention_pinned")
    op.execute(
        """
        ALTER TABLE coord.agent_worktrees
            DROP CONSTRAINT IF EXISTS coord_agent_worktrees_retention_check
        """
    )
    op.execute("ALTER TABLE coord.agent_worktrees DROP COLUMN IF EXISTS retention")
