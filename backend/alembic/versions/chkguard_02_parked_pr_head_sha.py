"""coord.primary_trees parked-PR identity — merged-PR head SHA + number

Revision ID: chkguard_02_parked_pr_head_sha
Revises: coord_plans_ingested_status
Create Date: 2026-06-13

Phase 3 of plan
``qontinui-dev-notes/plans/2026-06-05-coord-stale-primary-checkout-guard.md``
(stale-primary-checkout guard — auto-remediation), implemented after the
7-day calibration gate cleared on 2026-06-13 with 26/26 verified
true-positive parked-on-merged-branch detections and zero false positives.

Adds the two persisted facts the restore safety predicate needs that
``coord.primary_trees`` lacks today (the watcher already resolves both from
GitHub each tick and persists only the boolean ``parked_merged``):

* ``parked_pr_head_sha TEXT`` (nullable) — the merged PR's head SHA from the
  watcher's cached ``GET /repos/{repo}/pulls?head=<owner>:<branch>`` lookup.
  The Phase-3 safety predicate is ``porcelain-clean AND local head_sha ==
  merged PR head SHA`` — equality proves the parked branch's entire content
  landed via the merged PR, so restoring the tree to the default branch
  provably loses zero work. NULL = not resolved (on-default tree, no App
  credential, or no closed PR found for the branch); a NULL never satisfies
  the predicate (honest unknown, alert-only).
* ``parked_pr_number INTEGER`` (nullable) — the merged PR's number, carried
  into the restore verdict purely for explainability (operator log lines and
  the decision audit say "restoring after PR #N merged" without a GitHub
  round-trip). Same NULL semantics.

Both are watcher-derived per-tick caches of remote GitHub state, refreshed
whenever the observed ``head_sha``/branch changes — like ``parked_merged``
(``twin_07_coord_metrics_2b_tables``) there is nothing meaningful to
backfill (the watcher's next tick repopulates the live set), no index (read
in per-device scans alongside the other git-state columns, never
point-looked-up), and nullable precisely because "unknown" and any real
value must stay distinct for the safety predicate.

Expand-only / forward-only. Idempotency: ``ADD COLUMN IF NOT EXISTS`` so a
re-apply (or a canonical-PG that already carries the columns from a manual
reconcile) is a strict no-op — the ``coord.primary_trees`` house style
(``chkguard_01_behind_default_count``, ``coord_primary_trees_local_ahead``).

alembic is the SOLE author of ``coord.*`` schema
(``proj_alembic_sole_author_coord_schema``); the coord Rust binary asserts
table presence at boot and never authors DDL in production. The coord-side
writer degrades gracefully while these columns are absent (pre-migration
deploys fall back to the single-column ``parked_merged`` UPDATE), so this
migration and the coord PR can land in either order.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "chkguard_02_parked_pr_head_sha"
down_revision: str = "coord_plans_ingested_status"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add ``parked_pr_head_sha`` + ``parked_pr_number``. Idempotent."""
    op.execute(
        """
        ALTER TABLE coord.primary_trees
            ADD COLUMN IF NOT EXISTS parked_pr_head_sha TEXT
        """
    )
    op.execute(
        """
        ALTER TABLE coord.primary_trees
            ADD COLUMN IF NOT EXISTS parked_pr_number INTEGER
        """
    )


def downgrade() -> None:
    """Drop the parked-PR identity columns."""
    op.execute(
        "ALTER TABLE coord.primary_trees DROP COLUMN IF EXISTS parked_pr_number"
    )
    op.execute(
        "ALTER TABLE coord.primary_trees DROP COLUMN IF EXISTS parked_pr_head_sha"
    )
