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

``CREATE INDEX CONCURRENTLY`` (not plain ``CREATE INDEX``), following
``coord_pg_overload_idx_01``: ``coord.repo_branches`` is UPSERTed by every
``pull_request`` webhook, so an in-transaction build would take a
write-blocking ``SHARE`` lock across the build. CONCURRENTLY cannot run inside
a transaction, hence ``op.get_context().autocommit_block()``. On a CI fresh DB
the table is tiny and the build is instant. Additive / forward-only:
``upgrade`` creates ``IF NOT EXISTS``, ``downgrade`` drops ``IF EXISTS``.

Note on a killed CONCURRENTLY build: a partial build leaves an INVALID index of
the same name, which ``IF NOT EXISTS`` would then skip. If that happens, ``DROP
INDEX`` the invalid index manually and re-run.

Revision ID: merged_count_01_merged_at_idx
Revises: dry_run_retire_02_drop_bools
Create Date: 2026-07-24

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "merged_count_01_merged_at_idx"
down_revision: str | None = "dry_run_retire_02_drop_bools"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS
                idx_repo_branches_merged_at
            ON coord.repo_branches (merged_at DESC)
            WHERE merge_commit_sha IS NOT NULL
            """
        )


def downgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS coord.idx_repo_branches_merged_at"
        )
