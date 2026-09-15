"""coord.ci_job_observations — the two indexes its writer and its reaper read through

Revision ID: coord_ci_job_observations_02
Revises: coord_ci_runner_quarantines_01
Create Date: 2026-09-15

Follow-up to ``coord_ci_job_observations_01`` (plan
``2026-09-14-a-poison-ci-runner-takes-every-job-and-no-detector-sees-it``,
Phase 1a). That revision is already applied in production, so it is frozen:
an index added to its ``upgrade()`` would never be created on the table that
already exists. These two live here instead.

The pre-PR review of the coord sampler (Phase 1b) found reads that the
``_01`` indexes do not serve, and that seq-scan a table holding 30 days of
per-job rows for every repo with a self-hosted registration:

* ``ix_ci_job_obs_run`` on ``(repo, run_id, run_attempt)`` — the sampler's
  work-queue anti-join, ``NOT EXISTS`` an observation for ``(repo, run_id,
  COALESCE(run_attempt, 1))`` of a completed ``coord.ci_runs`` row. Three
  equality columns, run once per tick per repo.
* ``ix_ci_job_obs_completed`` on ``(completed_at)`` — the 24h
  ``coord_ci_job_observations_total{outcome}`` gauge recompute on every
  ``/metrics`` scrape on every replica (``completed_at > now() - 24h``), and
  the ``completed_at < cutoff`` arm of the 30-day retention delete. That
  delete must be written as index-able arms on the coord side —
  ``completed_at < $cutoff OR (completed_at IS NULL AND observed_at < $cutoff)``
  — because a btree on a column cannot serve a predicate over
  ``COALESCE(completed_at, observed_at)``; the coord PR of the same plan
  carries that rewrite, and nothing here pretends to serve the COALESCE form.

``ix_ci_job_obs_key (repo, head_sha, job_name)`` shares only its leading
``repo`` with the first, and the partial ``ix_ci_job_obs_runner_completed
(runner_name, completed_at) WHERE self_hosted`` cannot serve an unfiltered
range on ``completed_at``, so neither new index duplicates an existing one.

## Safety

Both statements are ``CREATE INDEX IF NOT EXISTS`` on a table that is hours
old and near-empty, inside the one transaction ``env.py`` wraps the batch in
(``CONCURRENTLY`` is unavailable there and unnecessary here). ``downgrade()``
drops exactly the two indexes and nothing else. Every SQL string is a static
literal. Expected coord migration-classifier disposition: Reject, for the
same two reasons as ``_01`` (non-concurrent ``CREATE INDEX``; ``DROP`` in
``downgrade()``).
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "coord_ci_job_observations_02"
down_revision: str | Sequence[str] | None = "coord_ci_runner_quarantines_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create the work-queue and completed_at indexes on coord.ci_job_observations."""
    # The sampler's work queue: which completed run attempts have no
    # observation yet (an anti-join against coord.ci_runs every 120 s tick).
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_ci_job_obs_run
            ON coord.ci_job_observations (repo, run_id, run_attempt)
        """
    )
    # The 24h scrape read, and the completed_at arm of the retention delete.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_ci_job_obs_completed
            ON coord.ci_job_observations (completed_at)
        """
    )


def downgrade() -> None:
    """Drop the two indexes; the table and its _01 indexes are untouched."""
    op.execute("DROP INDEX IF EXISTS coord.ix_ci_job_obs_completed")
    op.execute("DROP INDEX IF EXISTS coord.ix_ci_job_obs_run")
