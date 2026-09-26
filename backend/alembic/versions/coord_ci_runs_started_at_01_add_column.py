"""coord.ci_runs.run_started_at — GitHub's own start time for a workflow run

Revision ID: coord_ci_runs_started_at_01
Revises: coord_iops_idx_01
Create Date: 2026-09-26

Phase 2.1 of plan
``2026-09-12-red-main-alert-since-resets-mid-episode-and-a-non-required-gate-reds-main-through-the-fail-closed-arm``.

## Why

The ``red_main`` alert banner told the operator "main has been red since
<the open alert row's first_seen_at>". That row is resolved whenever coord's
``main_ci_status`` reads green and re-fired on the next red read, while GitHub
can show main red throughout (which verdict arm produced those greens is the
plan's open Phase 1.2 question). 546 of 592 re-fires, on the same workflow
set, across all 593 red_main rows for qontinui-runner, 2026-07-07 to
2026-09-25, landed inside 30 minutes of the previous resolve, per the
``GET /coord/alerts?kind=red_main&source=red_main:qontinui/qontinui-runner&include_resolved=true``
read recorded in the plan's "Vet findings". So the "since" reset
mid-episode: the 2026-09-02T07:58Z to 2026-09-03T08:16Z episode was 13
alert rows, and at about 07:10Z on 2026-09-03 the banner said 1h 45m.

The paired qontinui-coord change will compute ``detail.red_since`` from
GitHub's record instead:
the start time of the EARLIEST completed non-passing ``push`` run on the
default branch, walking back through ``coord.ci_runs`` from the newest run per
failing workflow until a ``success`` is met. That walk needs a timestamp that
is GitHub's, and ``coord.ci_runs`` had none:

* there is no ``created_at`` column, and
* ``observed_at`` is coord's observation time, not the run's: the plain
  upsert re-stamps it (``observed_at = EXCLUDED.observed_at``), while the
  poll backstop keeps the first time coord saw the run completed. Either way
  it records when coord looked, and a re-run's webhook moves it forward.

This revision adds ``run_started_at``: GitHub's ``run_started_at`` field of
the workflow run payload.

## What writes it

The paired ``qontinui-coord`` change (not on coord ``main`` when this revision
was written): both the ``workflow_run`` webhook ingest and the REST poll
backstop will parse ``run_started_at`` off the run, and the ``ci_runs``
upsert will write it with
``COALESCE(ci_runs.run_started_at, EXCLUDED.run_started_at)`` so the FIRST
value observed is kept: whatever a later observation of the same run
carries (a re-run attempt included) cannot move it.

## What reads it

coord's ``red_main`` detector (same paired change), to fill
``detail.red_since``. A row written before this column existed (or by a path
that does not carry the field) is NULL, and the reader will fall back to
``observed_at`` for that row while stamping
``detail.red_since_source = observed_at`` rather than presenting coord's proxy
as GitHub's observation. ``run_started_at`` rows stamp ``run_started_at``.
The qontinui-web ``RedMainBanner`` renders ``detail.red_since`` when present.

## No ORM model

``coord.ci_runs`` has no SQLAlchemy model in this repo: the table is
coord-only, and web is its schema author, never a reader.

## Two-repo ordering: this schema half lands and is APPLIED first

alembic in qontinui-web is the SOLE author of ``coord.*`` schema (served
policy ``production-and-cost`` ``alembic-sole-authorship``). The coord PR that
writes and reads ``run_started_at`` lands after this revision is applied in
production.

## Head choice

``down_revision`` is ``coord_iops_idx_01``, the single head of this branch
when this revision was written (``scripts/ci/count_alembic_heads.py`` reported
``HEAD_COUNT=1``). If main has moved before it lands, re-point
``down_revision``, the ``Revises:`` header and ``_PARENT_REVISION_ID`` in the
migration test at the new single head. Do not add an ``alembic merge``: this
repo keeps strict single-head discipline.

## Merge-train classifier disposition

Not predicted here: coord's migration classifier changes independently of this
file, and it was not run against this revision. Every SQL string is a static
literal, and the upgrade path is one ``SET LOCAL``, one nullable
``ADD COLUMN`` and one ``COMMENT ON COLUMN`` with a plain literal.

## Safety

``ADD COLUMN IF NOT EXISTS`` and a re-runnable ``COMMENT ON``, so a partial
apply re-runs cleanly. ``IF NOT EXISTS`` on the column is type-blind (name
only); acceptable because no revision in this chain spells ``run_started_at``
on ``coord.ci_runs`` before this one.

The column is nullable with no default, so on PostgreSQL the ALTER is
catalogue-only: no row is rewritten. It still takes a brief ``ACCESS
EXCLUSIVE`` lock on ``coord.ci_runs``, which coord writes continuously, so both
directions bound their lock wait with ``SET LOCAL lock_timeout = '3s'`` and
restore the default afterwards (the guard ``coord_ci_job_observations_01``
uses): a blocked apply fails fast instead of queueing in front of coord.

``downgrade()`` drops the column, ``IF EXISTS``. Both directions are pure SQL
execution with no bind or inspection, so they work under ``alembic ... --sql``
offline mode.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_ci_runs_started_at_01"
down_revision: str | Sequence[str] | None = "coord_iops_idx_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Every SQL string below is a STATIC literal. The coord merge-train migration
# classifier extracts string literals from each execute call and rejects a call
# with none as dynamic. Keep these comments free of apostrophes and of the
# op-dot-call spelling: the classifier lexer does not skip Python comments.


def upgrade() -> None:
    """Add the nullable coord.ci_runs.run_started_at column and document it."""
    # The ALTER takes ACCESS EXCLUSIVE on a table coord writes continuously.
    # Bound the wait so a blocked apply fails fast.
    op.execute("SET LOCAL lock_timeout = '3s'")

    # IF NOT EXISTS is name-blind to type; acceptable because nothing earlier
    # in this chain spells run_started_at on coord.ci_runs.
    op.execute(
        """
        ALTER TABLE coord.ci_runs
            ADD COLUMN IF NOT EXISTS run_started_at TIMESTAMPTZ
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.ci_runs.run_started_at IS
            'GitHub run_started_at of this workflow run, to be written by the coord ci_runs upsert (the paired qontinui-coord change) from the workflow_run webhook and its poll backstop with COALESCE(existing, new), so the first value observed is kept and no later observation of the same run moves it. Read by the red_main detector to compute detail.red_since. NULL = written before this column existed, or by a path that does not carry the field; the reader then falls back to observed_at and says so in detail.red_since_source. Nullable with no default so the column add rewrites no row.'
        """
    )

    op.execute("SET LOCAL lock_timeout = DEFAULT")


def downgrade() -> None:
    """Drop coord.ci_runs.run_started_at."""
    # Dropping the column locks coord.ci_runs the same way adding it did.
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute("ALTER TABLE coord.ci_runs DROP COLUMN IF EXISTS run_started_at")
    op.execute("SET LOCAL lock_timeout = DEFAULT")
