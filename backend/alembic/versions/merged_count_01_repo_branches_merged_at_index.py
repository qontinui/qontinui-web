"""Index coord.repo_branches for the recently-merged PR window

``d7e8f9a0b1c2`` added ``merge_commit_sha`` + ``merged_at`` but no index, so
every "which PRs landed in the last N hours?" read sequentially scans
``coord.repo_branches``. Two coord reads run that predicate:

* ``query_recently_merged_prs`` — the fleet page's "Merged" tab rows.
* ``count_recently_merged_prs`` — the cheap count that labels that tab, which
  now rides the dashboard's hot poll (every open dashboard, every poll gap).

The partial index matches both predicates exactly: they filter
``merge_commit_sha IS NOT NULL AND merged_at > now() - <window>``, and the
partial WHERE keeps the index to landed rows only — a small fraction of the
table, since every open PR row and every pre-``d7e8f9a0b1c2`` row has NULL
there. ``merged_at DESC`` matches the newest-first window scan.

Revision ID: merged_count_01_merged_at_idx
Revises: served_sha_01_devices_columns
Create Date: 2026-07-24

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "merged_count_01_merged_at_idx"
down_revision: str | None = "served_sha_01_devices_columns"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_INDEX_NAME = "idx_repo_branches_merged_at"


def upgrade() -> None:
    op.create_index(
        _INDEX_NAME,
        "repo_branches",
        [sa.text("merged_at DESC")],
        schema="coord",
        postgresql_where=sa.text("merge_commit_sha IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index(_INDEX_NAME, table_name="repo_branches", schema="coord")
