"""coord.merge_proposals — two-tier merge-classification fingerprint columns

Revision ID: coord_singleauthored_11_merge_class_columns
Revises: chkguard_01_behind_default_count
Create Date: 2026-06-06

Phase 2 of plan
``D:/qontinui-root/plans/2026-05-31-coord-two-tier-merge-classification.md``
(two-tier merge classification — independent vs. contending merges).

Adds the three persisted columns the two-tier classifier needs on
``coord.merge_proposals``. The table itself is alembic-owned
(``wave_6_01_coord_merge_batches``); these columns are likewise authored here,
never in Rust DDL.

* ``scope_fingerprint TEXT`` (nullable) — the blake3 hex digest of the
  proposal's sorted, deduped touched-file paths (newline-joined), stamped by
  the PR-merge engine at INSERT time (``pr_merge/engine.rs``). Lets the
  dequeue-time classifier compare scopes without re-hydrating the file set.
  NULL = a row inserted by an engine build that predates the stamp (honest
  unknown; the classifier treats NULL as "scope unknown" → contending).
* ``has_dependencies BOOLEAN`` (nullable) — precomputed at INSERT time:
  whether ``coord.pr_dependencies`` carries any ``upstream_of`` / ``stacked_on``
  edge touching this PR. NULL = unknown (pre-stamp engine build).
* ``merge_class TEXT`` (nullable) — ``'independent'`` | ``'contending'``, the
  audit record of the classification decision. NOT stamped at INSERT (left
  NULL here); Phase 3 stamps it at *dequeue* time as an audit trail. NULL =
  not yet dequeued / classified.

Expand-only / forward-only, all nullable, no backfill, no index — these are
per-proposal derived facts; legacy rows carry NULL and there is nothing
meaningful to backfill (closed/merged proposals never re-enter the queue, and
``scope_fingerprint`` / ``has_dependencies`` are only stamped on rows the new
engine build inserts going forward). Read in the dequeue-time classification
scan alongside the other ``merge_proposals`` columns, never point-looked-up by
these columns, so no index is added (matches the existing column posture on
this table — see ``coord_singleauthored_09_merge_proposals_columns``).

Idempotency: ``ADD COLUMN IF NOT EXISTS`` so a re-apply (or a canonical-PG that
already carries the columns from a manual reconcile) is a strict no-op —
matching the ``coord.merge_proposals`` house style and the coord
boot-against-this-same-schema posture.

alembic is the SOLE author of ``coord.*`` schema
(``proj_alembic_sole_author_coord_schema``); the coord Rust binary asserts
table presence at boot and never authors DDL in production. These columns are
authored here, not in Rust (guarded by
``qontinui-coord/tests/coord_schema_authorship.rs``).
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_singleauthored_11_merge_class_columns"
down_revision: str = "chkguard_01_behind_default_count"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the two-tier classification columns. Idempotent."""
    op.execute("CREATE SCHEMA IF NOT EXISTS coord")
    op.execute(
        "ALTER TABLE coord.merge_proposals "
        "ADD COLUMN IF NOT EXISTS scope_fingerprint TEXT"
    )
    op.execute(
        "ALTER TABLE coord.merge_proposals "
        "ADD COLUMN IF NOT EXISTS has_dependencies BOOLEAN"
    )
    op.execute(
        "ALTER TABLE coord.merge_proposals "
        "ADD COLUMN IF NOT EXISTS merge_class TEXT"
    )


def downgrade() -> None:
    """Drop the two-tier classification columns."""
    op.execute("ALTER TABLE coord.merge_proposals DROP COLUMN IF EXISTS merge_class")
    op.execute("ALTER TABLE coord.merge_proposals DROP COLUMN IF EXISTS has_dependencies")
    op.execute("ALTER TABLE coord.merge_proposals DROP COLUMN IF EXISTS scope_fingerprint")
