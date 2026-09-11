"""Persist the required-checks walk on coord.repo_branches

Plan ``2026-09-01-coord-cannot-name-the-missing-required-check``, Phase 2.

coord's ``walk_required_checks``
(``qontinui-coord/crates/coord/src/pr_merge/mod.rs:2934``) already computes
``RequiredChecksWalk::non_passing: Vec<(type_name, name)>`` -- the NAMES of the
required contexts that are missing or non-passing -- and then throws them away.
``classify_merge_status`` (``mod.rs:4144-4149``) says so against itself: *"We
cannot NAME the offending context here... Persisting it is the real fix and
needs a new column (hence a qontinui-web migration first)"*. These four columns
are that storage. Nothing reads them yet -- the coord reader lands separately
and must not merge before this migration deploys.

* ``required_checks_non_passing JSONB`` -- the walk's result as a JSON array of
  ``{"type_name": "...", "name": "..."}`` objects. JSONB rather than ``text[]``
  because the sole existing consumer branches on ``type_name``
  (``mod.rs:3018-3021``), so the pair must survive round-tripping.
* ``required_checks_walk_at TIMESTAMPTZ`` -- when the walk that produced the
  row's value ran.
* ``required_checks_walk_truncated BOOLEAN`` -- its own column because the walk
  distinguishes a truncated page (``mod.rs:3013``) from a genuinely empty
  result. A schema that cannot express that difference re-creates the
  absence-is-not-zero defect this work exists to close.
* ``required_checks_walk_head_sha TEXT`` -- the walk is per-head while
  ``repo_branches`` is per-branch, so a reader must be able to tell a stale set
  of names from a current one.

All four are nullable with no default and no backfill: existing rows stay NULL,
and NULL is meaningful here -- it means "no walk recorded for this row yet",
which is NOT the same as "the walk found nothing". No index: nothing queries
these columns.

Note the pre-existing sibling ``required_checks_satisfied BOOLEAN``
(``pr_merge_01_pr_state_extensions``) -- that is the derived boolean verdict and
is deliberately left alone; these columns name WHICH checks produced it.

Revision ID: reqchk_walk_01
Revises: coord_agent_questions_audience_backfill
Create Date: 2026-09-01

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "reqchk_walk_01"
down_revision: str | None = "coord_agent_questions_audience_backfill"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "repo_branches",
        sa.Column(
            "required_checks_non_passing",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
        schema="coord",
    )
    op.add_column(
        "repo_branches",
        sa.Column("required_checks_walk_at", sa.DateTime(timezone=True), nullable=True),
        schema="coord",
    )
    op.add_column(
        "repo_branches",
        sa.Column("required_checks_walk_truncated", sa.Boolean(), nullable=True),
        schema="coord",
    )
    op.add_column(
        "repo_branches",
        sa.Column("required_checks_walk_head_sha", sa.Text(), nullable=True),
        schema="coord",
    )


def downgrade() -> None:
    op.drop_column("repo_branches", "required_checks_walk_head_sha", schema="coord")
    op.drop_column("repo_branches", "required_checks_walk_truncated", schema="coord")
    op.drop_column("repo_branches", "required_checks_walk_at", schema="coord")
    op.drop_column("repo_branches", "required_checks_non_passing", schema="coord")
