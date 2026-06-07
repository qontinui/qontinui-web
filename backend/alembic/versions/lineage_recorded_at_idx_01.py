"""coord.commit_lineage — recorded_at DESC index for recency scans

Revision ID: lineage_recorded_at_idx_01
Revises: twin_07_coord_metrics_2b_tables
Create Date: 2026-06-07

Adds a single descending btree index on ``coord.commit_lineage(recorded_at)``
to back the two new lineage read endpoints that scan by record time:

* ``GET /coord/lineage/recent`` — ``ORDER BY recorded_at DESC LIMIT n`` (the
  index satisfies both the sort and the limit without a heap sort).
* ``GET /coord/lineage/stats`` — 30-day rolling window
  (``WHERE recorded_at >= now() - interval '30 days'``); the range scan walks
  the index instead of the full table.

The sibling ``coord_commit_lineage.py`` stood the table up with two indexes
(partial ``agent_session_id`` and ``(repo, pr_number)``) but no ``recorded_at``
index — these endpoints landed after that migration, so the recency scans
currently hit a full table scan + sort. This additive index closes that gap.

Idempotency / authorship posture
================================

* DDL uses ``CREATE INDEX IF NOT EXISTS`` / ``DROP INDEX IF EXISTS`` raw
  ``op.execute`` — matching the ``coord.*`` migration house style (see the
  sibling ``coord_commit_lineage`` migration). coord boots against this same
  schema, so re-running against an already-applied DB must be a no-op.
* **alembic is the SOLE author of the coord.* schema.** No Rust
  ``CREATE``/``ALTER`` self-heal — the Rust side only SELECTs / INSERTs.

Chains off the current single head ``twin_07_coord_metrics_2b_tables``
(verified via ``python -m alembic heads`` against origin/main 2026-06-07).
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "lineage_recorded_at_idx_01"
down_revision: str | Sequence[str] | None = "twin_07_coord_metrics_2b_tables"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_commit_lineage_recorded_at "
        "ON coord.commit_lineage (recorded_at DESC)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS coord.idx_commit_lineage_recorded_at")
