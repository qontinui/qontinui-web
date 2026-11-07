"""coord.condition_runs honest-run columns — what a run covered, and why it reads unknown

Revision ID: coord_conditions_02_honest_runs
Revises: outbound_budget_windows_01
Create Date: 2026-11-07

Phase 3 of plan
``2026-11-06-a-regression-test-run-is-judged-by-what-it-covered-and-a-silent-run-reads-unknown``.

Six nullable columns on ``coord.condition_runs``, so a regression-test run can
record what it covered, what its agent merely claimed, and why it reads
``unknown``. No build reads or writes them yet. Coord moves the first four onto
them in plan Phase 5 (Phase 2 keeps them inside the ``results`` JSONB until
then) and writes the last two in Phase 11. So this revision must be APPLIED
before either of those coord PRs deploys: alembic is the sole author of
``coord.*`` DDL (served policy ``production-and-cost``
``alembic-sole-authorship``).

The six columns
===============

* ``claimed_status`` TEXT -- the status the condition agent reported for the
  whole run, kept as a claim beside the status coord derives from coverage
  (plan D-D1; D-D2 names the one typed exception, the runner's spawn-failure
  report).
* ``coverage`` JSONB -- the condition ids the run was dispatched with, then the
  counts the report derives from them: ``expected``, ``reported``, ``unknown``
  and the ``missing`` ids (the shape plan Phase 1 renders).
* ``unknown_reason`` TEXT -- the run's code from the shared ``UnknownCode``
  set (plan D-D12): why the run reads ``unknown``, or ``producer_failed`` on a
  spawn-failure ``error`` run (D-D2).
* ``unknown_detail`` TEXT -- the run-level cause beside that code, from the
  closed list the plan owns (``no_report_within_deadline``,
  ``publish_refused``, ``runner_refused`` plus its reason, ``spawn_failed``,
  ``legacy_status``, ``no_secret_capable_runner``).
* ``plan`` JSONB -- the check plan the agent commits before it reports, one
  entry per condition: ``condition_id``, ``observe``, ``pass_when`` and
  ``deterministic`` (plan D-D6).
* ``plan_committed_at`` TIMESTAMPTZ -- when coord accepted that plan; stamped
  by the server, never by the agent (plan D-D6).

``NULL`` in any of them means "not written": every existing row, and every run
a build before Phases 5 and 11 records. A reader shows it as UNKNOWN, never as
a default (served policy ``verification-and-evidence``
``unknown-must-not-render-as-a-default``), so there is no default and no
backfill.

Nothing else
============

No row changes, no constraint and no index. The run-status vocabulary gets its
CHECK in a later revision (``coord_conditions_03_run_status_vocabulary``, plan
Phase 4), and only once coord derives the status itself: applied before that,
a CHECK would turn the report UPDATE, which still stores the agent's own word,
into a 500.

Head choice
===========

``down_revision`` is the single head of web ``main`` at authoring
(``poetry run alembic heads``). Eight hand-authored revisions from five plans
share this one chain (this one, Phase 4's, and six from sibling plans), so the
PR re-chains ``down_revision`` onto the single head ``main`` has when it opens
and after every rebase, moving the ``Revises:`` line above with it. The
companion test reads the parent from this file, so it follows a re-chain.

Safety
======

Nullable with no default, so each ADD is catalogue-only and rewrites no row.
``SET LOCAL lock_timeout`` bounds the ACCESS EXCLUSIVE wait in both directions,
and env.py's ``on_version_apply`` hook RESETs it after the step.
``if_not_exists=True`` renders ``ADD COLUMN IF NOT EXISTS`` and
``if_exists=True`` renders ``DROP COLUMN IF EXISTS``; both match on NAME only,
which is acceptable because no earlier revision in this chain spells any of
these six names on this table.

Merge-train classifier disposition
==================================

coord's migration classifier (``pr_merge/migration_classifier.rs``) admits
each ``op.add_column`` here because its column is an inline nullable
``sa.Column`` with no default and the file carries an idempotency marker. It
reads that marker from the file's TEXT (``has_idempotency_guard``), not from
the ``if_not_exists=True`` keyword: the ``IF NOT EXISTS`` spelled in this
docstring and in ``upgrade()``'s comment is that marker. ``SET LOCAL
lock_timeout`` is its one admitted non-DDL statement. ``downgrade()`` is
outside the path it classifies, and outside
``scripts/ci/check_coord_column_drops.py``'s scan.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_conditions_02_honest_runs"
down_revision: str | Sequence[str] | None = "outbound_budget_windows_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the six nullable honest-run columns to ``coord.condition_runs``."""
    op.execute("SET LOCAL lock_timeout = '3s'")

    # if_not_exists=True renders ADD COLUMN IF NOT EXISTS, so re-applying this
    # step is a no-op. Each column is written inline because the merge-train
    # classifier reads a column's options only from an inline sa.Column(...).
    op.add_column(
        "condition_runs",
        sa.Column("claimed_status", sa.Text(), nullable=True),
        schema="coord",
        if_not_exists=True,
    )
    op.add_column(
        "condition_runs",
        sa.Column("coverage", postgresql.JSONB(), nullable=True),
        schema="coord",
        if_not_exists=True,
    )
    op.add_column(
        "condition_runs",
        sa.Column("unknown_reason", sa.Text(), nullable=True),
        schema="coord",
        if_not_exists=True,
    )
    op.add_column(
        "condition_runs",
        sa.Column("unknown_detail", sa.Text(), nullable=True),
        schema="coord",
        if_not_exists=True,
    )
    op.add_column(
        "condition_runs",
        sa.Column("plan", postgresql.JSONB(), nullable=True),
        schema="coord",
        if_not_exists=True,
    )
    op.add_column(
        "condition_runs",
        sa.Column("plan_committed_at", sa.TIMESTAMP(timezone=True), nullable=True),
        schema="coord",
        if_not_exists=True,
    )


def downgrade() -> None:
    """Drop the six columns again (a catalogue inverse; their values do not return)."""
    op.execute("SET LOCAL lock_timeout = '3s'")

    op.drop_column(
        "condition_runs", "plan_committed_at", schema="coord", if_exists=True
    )
    op.drop_column("condition_runs", "plan", schema="coord", if_exists=True)
    op.drop_column("condition_runs", "unknown_detail", schema="coord", if_exists=True)
    op.drop_column("condition_runs", "unknown_reason", schema="coord", if_exists=True)
    op.drop_column("condition_runs", "coverage", schema="coord", if_exists=True)
    op.drop_column("condition_runs", "claimed_status", schema="coord", if_exists=True)
