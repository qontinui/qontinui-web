"""merge the two ``plan_library_07_plan_difficulty`` heads

Revision ID: mrg_aqw_01
Revises: ci_job_mem_01, rsslocal_02_drop_coord_tables
Create Date: 2026-09-20

A NO-OP merge revision. It contains no DDL and exists only to rejoin a forked
revision graph.

Why it exists
=============

``origin/main`` carried **two** heads, both chaining off
``plan_library_07_plan_difficulty``:

* ``ci_job_mem_01`` (``ci_job_mem_01_memory_headroom_columns.py``)
* ``rsslocal_02_drop_coord_tables`` (``rsslocal_02_drop_coord_session_tables.py``)

They were authored concurrently off the same head and both landed, which is the
post-authoring race ``alembic-graph-pr.yml`` exists to catch — its own header
records the 2026-05-07 two-head divergence that "silently broke the canonical
migrator container for four hours". The pre-merge gate fails a PR iff the
resulting chain has more than one head, so while main is forked **every**
migration PR fails that check, whoever opened it and whatever it contains.

``coord_agent_questions_withdrawn`` (this branch) chained off the same parent
and would have made a third head. The gate's own remedy text is that the author
"either rebases or adds an ``alembic merge`` revision"; rebasing cannot help
here, because the fork is between two revisions that have ALREADY landed on
main. So this is the merge revision, and
``coord_agent_questions_withdrawn.down_revision`` is re-pointed onto it.

What it does and does not assert
================================

A merge revision joins the graph; it imposes **no order between its parents**.
It says only that both branches must be applied before anything that follows.
Neither parent's DDL is touched, re-run or re-ordered by this file, and the two
migrations are unrelated — one adds memory-headroom columns to a CI table, the
other drops superseded coord session tables.

``upgrade()`` and ``downgrade()`` are deliberately empty. There is nothing to
do in either direction: alembic needs the graph edge, not a statement.
"""

from collections.abc import Sequence

# revision identifiers, used by Alembic.
revision: str = "mrg_aqw_01"
down_revision: str | Sequence[str] | None = (
    "ci_job_mem_01",
    "rsslocal_02_drop_coord_tables",
)
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """No-op: a merge revision carries no DDL."""


def downgrade() -> None:
    """No-op: a merge revision carries no DDL."""
