"""coord.primary_trees.behind_default_count — HEAD distance behind origin/<default>

Revision ID: chkguard_01_behind_default_count
Revises: twin_p6_02_census_building
Create Date: 2026-06-05

Phase 1 of plan
``D:/qontinui-root/plans/2026-06-05-coord-stale-primary-checkout-guard.md``
(stale-primary-checkout guard — the parked-on-merged-branch staleness signal).

Adds the one persisted git-state field the staleness watcher needs that
``coord.primary_trees`` lacks today: ``behind_default_count`` — the number of
commits the machine's checkout ``HEAD`` is behind ``origin/<default_branch>``.

Why the watcher needs it (plan §Phase 1): the existing ``behind_count`` column
measures HEAD behind ``origin/<current_branch>``. When a primary checkout is
*parked on a non-default branch* (a peer branch-switched the contested shared
tree), that distance reads ~0 against its own upstream ref even though the tree
is badly stale relative to ``main`` — the very condition that lets a session
vet/implement against a stale checkout. ``behind_default_count`` measures
distance from ``origin/<default_branch>`` explicitly, so the watcher can fire
the parked-on-merged-branch staleness signal regardless of which branch the
checkout currently sits on.

* ``behind_default_count INTEGER`` (nullable) — ``git rev-list --count
  HEAD..origin/<default_branch>`` as computed by the runner publisher
  (``capture_tree``). NULL = not sampled / on the default branch (where the
  signal is moot and the existing ``behind_count`` already covers it) / an old
  runner that does not yet report the field (honest unknown). Nullable rather
  than ``DEFAULT 0`` precisely because 0 and "unknown" must stay distinct here:
  a real 0 (up to date with default) and an unsampled NULL drive different
  watcher verdicts.

Expand-only / forward-only, nullable, no backfill, no index — a pure derived
per-tick git fact recomputed each publisher tick; legacy rows carry NULL and
there is nothing meaningful to backfill (the next tick repopulates the live
set). Read in the per-tick staleness scan alongside the other ``primary_trees``
git-state columns, never point-looked-up by this column, so no index is added
(matches the ``local_ahead`` / ``behind_count`` posture on this table).

Idempotency: ``ADD COLUMN IF NOT EXISTS`` so a re-apply (or a canonical-PG that
already carries the column from a manual reconcile) is a strict no-op — matching
the ``coord.primary_trees`` house style (see ``coord_primary_trees_local_ahead``)
and the coord boot-against-this-same-schema posture.

alembic is the SOLE author of ``coord.*`` schema
(``proj_alembic_sole_author_coord_schema``); the coord Rust binary asserts table
presence at boot and never authors DDL in production. This column is authored
here, not in Rust.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "chkguard_01_behind_default_count"
down_revision: str = "twin_p6_02_census_building"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add ``coord.primary_trees.behind_default_count``. Idempotent."""
    op.execute(
        """
        ALTER TABLE coord.primary_trees
            ADD COLUMN IF NOT EXISTS behind_default_count INTEGER
        """
    )


def downgrade() -> None:
    """Drop ``coord.primary_trees.behind_default_count``."""
    op.execute(
        "ALTER TABLE coord.primary_trees DROP COLUMN IF EXISTS behind_default_count"
    )
