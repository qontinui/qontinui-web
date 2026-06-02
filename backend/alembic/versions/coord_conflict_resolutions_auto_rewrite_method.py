"""coord.conflict_resolutions -- widen method CHECK to allow 'auto-rewrite'

Revision ID: coord_conflict_res_auto_rewrite_method
Revises: twin_07_coord_worktree_census
Create Date: 2026-06-02

Adds ``'auto-rewrite'`` to the ``conflict_resolutions_method_chk`` CHECK so
coord can record the conservative auto-resolver's NEW output: a grammar-driven
linearizing *rewrite* (alembic ``down_revision`` re-point / tool-registry
``__count__`` renumber), shipped in qontinui-coord #257 as
``ResolutionMethod::AutoRewrite``. Until this lands, an armed
``COORD_AUTO_REWRITE_ARMED`` write of ``method='auto-rewrite'`` would violate
the CHECK and fail the resolution INSERT; this migration is the explicit
**pre-arm** prerequisite for ever setting that flag.

## Expand-only / forward-compatible

Pure expand: the new CHECK accepts a strict SUPERSET of the prior values
(``auto-identical``, ``auto-commuting``, ``agent``, ``operator``), so an app
rolled back to before #257 -- which never writes ``'auto-rewrite'`` -- remains
fully compatible. Safe under ``migrate.yml`` auto-apply (the migration is not
reverted by a deploy auto-rollback). No contract step is needed.

## Why DROP + ADD (not ALTER)

Postgres cannot modify a CHECK constraint in place. ``DROP CONSTRAINT IF
EXISTS`` keeps this idempotent and collision-safe against the original
``coord_substrate_06_conflict_resolutions`` creator (which emits the narrow
CHECK at table-creation time). coord no longer authors ``coord.*`` schema in
the production binary (the prior Rust self-heal is now a ``#[cfg(test)]``
fixture, and that fixture already lists ``auto-rewrite``), so this alembic
migration is the sole owner of the production CHECK -- no Rust mirror to keep
in lockstep.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "coord_conflict_res_auto_rewrite_method"
down_revision: str | Sequence[str] | None = "twin_07_coord_worktree_census"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# Keep in sync with `ResolutionMethod::as_str` in
# `qontinui-coord/src/conflict_engine.rs` and the `#[cfg(test)]`
# `create_conflict_resolutions_for_test` fixture in the same file.
_METHODS = ("auto-identical", "auto-commuting", "auto-rewrite", "agent", "operator")
_METHODS_PRIOR = ("auto-identical", "auto-commuting", "agent", "operator")


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE coord.conflict_resolutions
            DROP CONSTRAINT IF EXISTS conflict_resolutions_method_chk
        """
    )
    op.execute(
        """
        ALTER TABLE coord.conflict_resolutions
            ADD CONSTRAINT conflict_resolutions_method_chk
            CHECK (method IN ('auto-identical','auto-commuting','auto-rewrite','agent','operator'))
        """
    )


def downgrade() -> None:
    # Best-effort restore of the narrow CHECK. Will fail if any
    # `method='auto-rewrite'` rows exist (correctly — you cannot narrow a
    # CHECK below live data). Downgrades are not run in production.
    op.execute(
        """
        ALTER TABLE coord.conflict_resolutions
            DROP CONSTRAINT IF EXISTS conflict_resolutions_method_chk
        """
    )
    op.execute(
        """
        ALTER TABLE coord.conflict_resolutions
            ADD CONSTRAINT conflict_resolutions_method_chk
            CHECK (method IN ('auto-identical','auto-commuting','agent','operator'))
        """
    )


# Touch the symbols so linters don't strip them.
_ = (_METHODS, _METHODS_PRIOR)
