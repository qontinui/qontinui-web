"""Add merge_commit_sha + merged_at to coord.repo_branches

Per-PR deploy-state plan
(``D:/qontinui-root/plans/2026-06-19-per-pr-deploy-state-in-web.md``).

coord needs to record, per merged PR, the exact merge commit SHA and the
timestamp it landed so it can compute per-PR deploy-state (is the merge
commit live on the deployed surface, and how far behind). Both columns
are nullable — every row that pre-dates this migration, and every open
(unmerged) PR row, has NULL.

* ``merge_commit_sha TEXT`` — the squash/merge commit SHA GitHub stamps
  on the base branch when the PR lands.
* ``merged_at TIMESTAMPTZ`` — when the PR merged.

Revision ID: d7e8f9a0b1c2
Revises: machine_display_names_01
Create Date: 2026-06-19

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d7e8f9a0b1c2"
down_revision: str | None = "machine_display_names_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "repo_branches",
        sa.Column("merge_commit_sha", sa.Text(), nullable=True),
        schema="coord",
    )
    op.add_column(
        "repo_branches",
        sa.Column("merged_at", sa.DateTime(timezone=True), nullable=True),
        schema="coord",
    )


def downgrade() -> None:
    op.drop_column("repo_branches", "merged_at", schema="coord")
    op.drop_column("repo_branches", "merge_commit_sha", schema="coord")
