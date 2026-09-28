"""coord priority lane — ci_job_observations.queued_at + ci_dispatches.priority_tier/priority_reason

Revision ID: coordprio_01_queued_at_priority_tier
Revises: cinode_03_dispatch_pr_head_base_sha
Create Date: 2026-09-28

Web DDL half of plan
``2026-09-28-coord-priority-end-to-end-lane-ci-dispatch-and-observability``
(Phase 1, plus Phase 3's two ledger columns — one migration, so coord has a
single ordering dependency on this repo).

What it adds (all nullable, no default, no backfill)
==========================================================================

* ``coord.ci_job_observations.queued_at TIMESTAMPTZ NULL`` — the GitHub
  job's ``created_at``, i.e. when the job entered the queue. coord's
  ``ci_job_sampler`` already fetches ``actions/runs/{id}/jobs`` and records
  ``started_at`` / ``completed_at``; with ``queued_at`` beside them,
  ``started_at - queued_at`` is the queue wait that Phase 1 measures per
  priority cohort (self-hosted pool vs hosted), which decides whether the
  plan's deferred capacity-reservation option (D1(c)) is ever built. It goes on
  ``ci_job_observations`` rather than ``pr_check_runs`` because this is the
  per-job store that already carries the job's pool and timing.

* ``coord.ci_dispatches.priority_tier SMALLINT NULL`` — the merge-scheduler
  tier coord computed for the proposal at ci-node dispatch time
  (``0`` = the priority class).
* ``coord.ci_dispatches.priority_reason TEXT NULL`` — why it got that tier
  (``label`` | ``red_main_fix`` | ``aged`` | ``none`` | …; the vocabulary is
  coord's, so it is deliberately not CHECK-constrained here).

NULL means "not recorded": every pre-existing row, and every row written by a
coord build that predates the consumer. A NULL ``priority_tier`` MUST NOT be
read as "not priority", and a NULL ``queued_at`` MUST NOT be read as a zero
queue wait. Per served policy ``production-and-cost``
``alembic-sole-authorship`` this revision lands before any coord read of the
columns; coord degrades on ``undefined_column`` until it does.

Shape
==========================================================================

Plain static ``op.execute`` literals (coord's merge classifier admits only a
static argument, and the ``alembic-schema-arg-gate`` hook parses the SQL to
prove each statement names its schema). ``ADD COLUMN IF NOT EXISTS`` /
``DROP COLUMN IF EXISTS`` so a re-run is harmless. Adding a nullable column
with no default is a catalog-only change, so the ACCESS EXCLUSIVE lock is held
only momentarily; ``lock_timeout`` bounds the wait to acquire it, because
coord writes both tables continuously and a queued exclusive lock blocks every
writer behind it.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coordprio_01_queued_at_priority_tier"
down_revision: str | Sequence[str] | None = "cinode_03_dispatch_pr_head_base_sha"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the three nullable columns and comment them."""
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute(
        """
        ALTER TABLE coord.ci_job_observations
            ADD COLUMN IF NOT EXISTS queued_at TIMESTAMPTZ NULL
        """
    )
    op.execute(
        """
        ALTER TABLE coord.ci_dispatches
            ADD COLUMN IF NOT EXISTS priority_tier SMALLINT NULL,
            ADD COLUMN IF NOT EXISTS priority_reason TEXT NULL
        """
    )
    # SET LOCAL is transaction-scoped and env.py wraps the WHOLE run in one
    # transaction, so put it back or it leaks into every later revision.
    op.execute("SET LOCAL lock_timeout = DEFAULT")
    op.execute(
        """
        COMMENT ON COLUMN coord.ci_job_observations.queued_at IS
            'GitHub job created_at: when the job entered the queue. started_at - queued_at is the '
            'queue wait. NULL = not recorded (never a zero wait).'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.ci_dispatches.priority_tier IS
            'Merge-scheduler tier coord computed at ci-node dispatch time (0 = priority class). '
            'NULL = not recorded (never "not priority").'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.ci_dispatches.priority_reason IS
            'Why the dispatch got priority_tier (label | red_main_fix | aged | none | ...; '
            'vocabulary owned by coord). NULL = not recorded.'
        """
    )


def downgrade() -> None:
    """Drop the three columns. Idempotent."""
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute(
        """
        ALTER TABLE coord.ci_dispatches
            DROP COLUMN IF EXISTS priority_reason,
            DROP COLUMN IF EXISTS priority_tier
        """
    )
    op.execute(
        """
        ALTER TABLE coord.ci_job_observations
            DROP COLUMN IF EXISTS queued_at
        """
    )
    op.execute("SET LOCAL lock_timeout = DEFAULT")
