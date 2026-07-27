"""coord.pr_check_runs_latest — re-expand ``SELECT *`` so head_branch is visible

Revision ID: prcheckruns_headbranch_02
Revises: prcheckruns_headbranch_01
Create Date: 2026-07-27

``prcheckruns_headbranch_01`` added ``coord.pr_check_runs.head_branch``. That
column is INVISIBLE through ``coord.pr_check_runs_latest`` until this runs.

Why a second migration is required
----------------------------------
PostgreSQL expands ``SELECT *`` **at view-creation time** and stores the
resolved column list in the view's rewrite rule. Adding a column to the base
table afterwards does NOT propagate: the view keeps the columns it was born
with. Verified empirically on PG (temp table + temp ``SELECT *`` view)::

    create temp table t_probe(a int, b text);
    create temp view v_probe as select distinct on (a) * from t_probe ...;
    alter table t_probe add column c text;
    -- view columns: a,b            <- `c` absent
    create or replace view v_probe as select distinct on (a) * from t_probe ...;
    -- view columns: a,b,c          <- re-expansion picks it up

So a reader doing ``SELECT head_branch FROM coord.pr_check_runs_latest`` gets
``42703 undefined_column`` — even though the column exists on the table and the
view is defined as ``SELECT *``. That is a silent trap of exactly the class the
parent plan exists to close: the read looks total and is not.

It matters because of coord's own table-vs-view convention
(``pr_state::rollup_check_rows``, ``economics::ci_wall_samples``): **verdict
readers use the view, repair paths use the table.** ``ci_wall_samples`` reads
the base table (it needs ``started_at``), so the candidate/PR-branch split that
consumes ``head_branch`` is unaffected — but every future VERDICT-side reader
that wants "which branch was this check run for?" would hit the trap. Closing
it now costs one additive statement.

Shape
-----
Byte-identical to ``coord_pr_check_runs_latest_view``'s definition — same
``DISTINCT ON``, same ``ORDER BY ... started_at DESC NULLS LAST, check_id
DESC`` tie-break (both load-bearing; see that revision's docstring). The ONLY
change is that re-executing it re-expands ``*`` against the current column set.

``CREATE OR REPLACE VIEW`` is legal here precisely because the new column is
APPENDED: PostgreSQL permits replacing a view when the new query keeps every
existing output column at the same position with the same name and type and
only adds columns at the end. ``head_branch`` was added last by
``prcheckruns_headbranch_01``, so it lands at the end of ``*``. No drop, no
dependent-object breakage, no reader downtime.

Idempotent and order-free: re-applying just rebuilds the view, and if a
canonical database already carries the column in the view (because the view
happened to be rebuilt after the ALTER), this is a no-op rewrite of an
identical definition.

Downgrade restores the view definition unchanged — the statement is the same
text either way, so the downgrade exists only to keep the revision reversible;
it does not un-expand the column (nothing can, short of dropping the column,
which is ``prcheckruns_headbranch_01``'s job).
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "prcheckruns_headbranch_02"
down_revision: str | Sequence[str] | None = "prcheckruns_headbranch_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# The canonical definition, kept in one place so upgrade/downgrade cannot drift
# from each other or from `coord_pr_check_runs_latest_view`.
_LATEST_VIEW = """
    CREATE OR REPLACE VIEW coord.pr_check_runs_latest AS
        SELECT DISTINCT ON (repo, head_sha, name) *
        FROM coord.pr_check_runs
        ORDER BY repo, head_sha, name, started_at DESC NULLS LAST, check_id DESC
"""


def upgrade() -> None:
    """Re-expand the view so ``head_branch`` joins its projection."""
    op.execute(_LATEST_VIEW)


def downgrade() -> None:
    """Rebuild the same view definition (see the module docstring)."""
    op.execute(_LATEST_VIEW)
