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

Why the watcher needs it (plan §Phase 1): the ``behind_count`` column measures
HEAD behind ``origin/<current_branch>``. (At the time this revision was
authored, ``behind_count`` was in the production database only, not in the
alembic chain — see the correction note below.) When a primary
checkout is *parked on a non-default branch* (a peer branch-switched the
contested shared tree), that distance reads ~0 against its own upstream ref
even though the tree is badly stale relative to ``main`` — the very condition
that lets a session vet/implement against a stale checkout.
``behind_default_count`` measures distance from ``origin/<default_branch>``
explicitly, so the watcher can fire the parked-on-merged-branch staleness
signal regardless of which branch the checkout currently sits on.

Clarified 2026-08-05: the paragraph above originally called ``behind_count``
"the existing column". That was true of the PRODUCTION database but NOT of the
alembic chain at the time this revision was authored, so the parenthetical
qualifying it was added and this note records why. ``behind_count`` (with
``head_detached`` and ``untracked_count``) existed only because the
since-deleted Rust ``ALTER TABLE`` self-heal created it, so a FRESH database
migrated to head did not have it. It joined the chain much later, in
``coord_primary_trees_selfheal_backfill`` (plan
``2026-07-28-web-primary-trees-backfill-migration``) — which runs *after* this
revision, so on a fresh database ``behind_count`` still does not exist at this
point in the chain; the "existing column" reading holds only from that revision
onward. Do not read this note as clearance to reference ``behind_count`` from a
revision at this position: that is a 42703 on a fresh database. Recorded because
the original phrasing — repeated across two migrations — is what made the chain
gap look already-solved for two months.

* ``behind_default_count INTEGER`` (nullable) — ``git rev-list --count
  HEAD..origin/<default_branch>`` as computed by the runner publisher
  (``capture_tree``). NULL = not sampled / on the default branch (where the
  signal is moot and ``behind_count`` already covers it) / an old
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
