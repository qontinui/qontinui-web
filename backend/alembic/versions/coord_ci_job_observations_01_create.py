"""coord.ci_job_observations + coord.ci_runs.run_attempt — per-job CI outcomes on self-hosted runners

Revision ID: coord_ci_job_observations_01
Revises: coord_ci_pool_baselines_01
Create Date: 2026-09-15

Phase 1a of plan
``2026-09-14-a-poison-ci-runner-takes-every-job-and-no-detector-sees-it``.

Two changes, both additive:

1. ``coord.ci_job_observations`` — one row per completed GitHub Actions JOB,
   read once per completed run attempt from
   ``GET /repos/{repo}/actions/runs/{run_id}/jobs?filter=all``. This is the
   durable, windowed, step-aware twin of ``ci_runner_admin::sample_host_stats``
   (which is live, 8 runs deep and on demand): the poison-runner detector of
   Phase 2 reads a 2h window of these rows per host, the restore probe of
   Phase 3 lands its canary outcome here, and the replay tests of Phase 2 run
   over a backfill of them.
2. ``coord.ci_runs.run_attempt`` — the attempt number of a workflow run, so a
   re-run (the commonest response to a runner kill) is sampled rather than
   silently skipped.

## What writes it

``qontinui-coord`` ``ci_job_sampler`` (Phase 1b of the same plan), a
leader-gated ledger worker. Each tick it selects completed rows of
``coord.ci_runs`` that have no observation for
``(repo, run_id, COALESCE(run_attempt, 1))``, reads their jobs through the
paced GitHub App client at ``SpendClass::Background``, classifies each job
with the pure ``ci_job_outcome::classify_job_outcome``, and UPSERTs one row per
job keyed ``(repo, job_id)``. It also DELETEs rows whose ``completed_at`` is
older than 30 days, capped per tick. A ``Background`` refusal leaves rows
missing, which the detector reads as fewer samples, never as healthy.

``run_attempt`` on ``coord.ci_runs`` is written by ``ci_runs_watcher``: the
``workflow_run`` webhook ingest (primary) and its 60 s poll backstop both carry
the attempt from the run payload. NULL means the row was written before this
column existed, or by a path that does not know the attempt; the sampler
treats NULL as attempt 1.

## Column shape of coord.ci_job_observations

* ``repo`` TEXT NOT NULL — ``owner/name``.
* ``job_id`` BIGINT NOT NULL — GitHub job id. For an Actions-created check
  run this equals ``coord.pr_check_runs.check_id``. A re-run attempt is a new
  job id.
* ``run_id`` BIGINT NOT NULL, ``run_attempt`` INTEGER NOT NULL DEFAULT 1 —
  the run and attempt the job belongs to. With ``filter=all`` an attempt-2
  read re-UPSERTs attempt 1's jobs idempotently.
* ``workflow_name`` / ``job_name`` TEXT NOT NULL.
* ``head_sha`` / ``head_branch`` TEXT — nullable, as on ``coord.ci_runs``.
* ``runner_name`` TEXT — NULL means UNKNOWN: the field was absent or null in
  the wire (the ``ci_no_verdict`` rule). An empty string is stored as read and
  classified ``unknown`` by the sampler, because a job that never got a runner
  is not a host's outcome.
* ``runner_labels`` TEXT[] NOT NULL DEFAULT '{}' — the job's ``runs-on``
  labels as GitHub reports them. The detector's peer set is built from these.
* ``self_hosted`` BOOLEAN NOT NULL — the labels contain ``self-hosted``. The
  hot index below is partial on it.
* ``conclusion`` TEXT — GitHub's job conclusion, verbatim.
* ``started_at`` / ``completed_at`` TIMESTAMPTZ, ``duration_secs`` INTEGER.
* ``step_count`` / ``failed_step_count`` INTEGER — NULL when the wire carried
  no ``steps`` field at all; ``0`` when it carried an empty array.
* ``outcome`` TEXT NOT NULL — ``pass`` | ``content_fail`` | ``infra_shaped``
  | ``neutral`` | ``unknown``. Text with NO CHECK, the choice
  ``coord.notifications.kind`` makes, so a new class is a Rust PR rather than
  a migration.
* ``duration_band`` TEXT — ``fast`` | ``reaper_plateau`` | ``mid``, set for
  ``infra_shaped`` only; NULL otherwise. No CHECK, for the same reason.
* ``observed_at`` TIMESTAMPTZ NOT NULL DEFAULT now().

Primary key ``(repo, job_id)``: the sampler's UPSERT key.

## Indexes

* ``ix_ci_job_obs_runner_completed`` on ``(runner_name, completed_at)``
  partial on ``self_hosted`` — the detector's per-host window scan. Hosted
  jobs are never a host's outcome, so they never enter the index.
* ``ix_ci_job_obs_key`` on ``(repo, head_sha, job_name)`` — the paired-evidence
  lookup: the same key attempted on two hosts.

Neither predicate names a non-IMMUTABLE function, so both are valid partial or
plain index definitions (cf. ``twin_ci_01_ci_runs`` on why ``now()`` may not
appear in one).

## No FK, no ORM model

No FK to ``coord.ci_runs``: a run row is re-stamped and may be retained on a
different schedule from its jobs, and the sampler must be able to keep a
job's outcome after its run row ages out. No FK to ``coord.tenants`` either:
the row is keyed by repo, and tenancy is resolved through ``coord.tenant_repos``
at read time, the way ``coord.ci_runs`` itself is. No SQLAlchemy model: this
table is coord-only, and web is its schema author, never a reader.

## Two-repo ordering: this schema half lands and is APPLIED first

alembic in qontinui-web is the SOLE author of ``coord.*`` schema; the
``qontinui-coord`` binary authors zero ``coord.*`` DDL and boot-gates on the
table through ``state::require_table``. The coord PR that reads and writes
these surfaces (Phase 1b) lands after this revision is applied in production.

## Head choice

``down_revision`` is ``coord_ci_pool_baselines_01``, the single head of
``origin/main`` at ``72cd8e4f0`` when this revision was written
(``scripts/ci/count_alembic_heads.py`` reported ``HEAD_COUNT=1``). If main has
moved before it lands, re-point ``down_revision``, the ``Revises:`` header and
``_PARENT_REVISION_ID`` in the migration test at the new single head. Do not
add an ``alembic merge``: this repo keeps strict single-head discipline.
``coord_ci_runner_quarantines_01`` (Phase 2a of the same plan) chains off THIS
revision.

## Merge-train classifier disposition

coord's migration classifier (``qontinui-coord``
``crates/coord/src/pr_merge/migration_classifier.rs``) is expected to classify
this revision Reject: it rejects a non-concurrent ``CREATE INDEX`` and does
not recognise ``COMMENT ON``, and it scans ``downgrade()`` too, where it
rejects every ``DROP``. Every SQL string is a static literal, so it is not
rejected for being dynamic. The landed precedents ``coord_ci_pool_baselines_01``
and ``coord_expectation_probes_01`` classify Reject the same way.

## Safety

``CREATE TABLE IF NOT EXISTS``, ``CREATE INDEX IF NOT EXISTS``,
``ADD COLUMN IF NOT EXISTS`` and re-runnable ``COMMENT ON``, so a partial apply
re-runs cleanly. ``IF NOT EXISTS`` on the column is type-blind (name only);
that is acceptable because no revision in this chain spells ``run_attempt``
before this one.

The new column is nullable with no default, so on PostgreSQL it is a
catalogue-only ``ALTER``: no row is rewritten. It still takes a brief
``ACCESS EXCLUSIVE`` lock on ``coord.ci_runs``, which coord's webhook ingest
and poll backstop write continuously, and env.py runs the batch in one
transaction, so both directions bound their lock waits with
``SET LOCAL lock_timeout = '3s'`` and restore the default afterwards (the
guard ``coord_ci_pool_baselines_01`` uses): a blocked apply fails fast instead
of queueing in front of coord.

``downgrade()`` drops the column, the two indexes and the table, in that
order, all ``IF EXISTS``. Both directions are pure SQL execution with no bind
or inspection, so they work under ``alembic ... --sql`` offline mode.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_ci_job_observations_01"
down_revision: str | Sequence[str] | None = "coord_ci_pool_baselines_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Every SQL string below is a STATIC literal. The coord merge-train migration
# classifier extracts string literals from each execute call and rejects a call
# with none as dynamic. Keep these comments free of apostrophes and of the
# op-dot-call spelling: the classifier lexer does not skip Python comments.


def upgrade() -> None:
    """Create coord.ci_job_observations, widen coord.ci_runs, document both."""
    # The ALTER on coord.ci_runs takes ACCESS EXCLUSIVE on a table coord writes
    # continuously. Bound the wait so a blocked apply fails fast.
    op.execute("SET LOCAL lock_timeout = '3s'")

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.ci_job_observations (
            repo              TEXT        NOT NULL,
            job_id            BIGINT      NOT NULL,
            run_id            BIGINT      NOT NULL,
            run_attempt       INTEGER     NOT NULL DEFAULT 1,
            workflow_name     TEXT        NOT NULL,
            job_name          TEXT        NOT NULL,
            head_sha          TEXT,
            head_branch       TEXT,
            runner_name       TEXT,
            runner_labels     TEXT[]      NOT NULL DEFAULT '{}',
            self_hosted       BOOLEAN     NOT NULL,
            conclusion        TEXT,
            started_at        TIMESTAMPTZ,
            completed_at      TIMESTAMPTZ,
            duration_secs     INTEGER,
            step_count        INTEGER,
            failed_step_count INTEGER,
            outcome           TEXT        NOT NULL,
            duration_band     TEXT,
            observed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT ci_job_observations_pkey PRIMARY KEY (repo, job_id)
        )
        """
    )

    # The detector reads a per-host window; hosted jobs never enter it.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_ci_job_obs_runner_completed
            ON coord.ci_job_observations (runner_name, completed_at)
            WHERE self_hosted
        """
    )
    # Paired evidence: the same (repo, head_sha, job_name) attempted on two hosts.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_ci_job_obs_key
            ON coord.ci_job_observations (repo, head_sha, job_name)
        """
    )

    # The comments carry what the names cannot: the owner module, the closed
    # vocabularies that have no CHECK, and what NULL means on each nullable
    # column. psql describe output is where a human meets this schema.
    op.execute(
        """
        COMMENT ON TABLE coord.ci_job_observations IS
            'One row per completed GitHub Actions job, keyed (repo, job_id). Written and retained (30 days) by the coord module ci_job_sampler, which reads each completed run attempt in coord.ci_runs once through the paced GitHub App client and classifies every job with ci_job_outcome. Read by ci_runner_poison (the per-host detector) and ci_runner_probe (the restore canary). Plan 2026-09-14-a-poison-ci-runner-takes-every-job-and-no-detector-sees-it, Phase 1.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.ci_job_observations.job_id IS
            'GitHub job id. Equals coord.pr_check_runs.check_id for an Actions-created check run. A re-run attempt is a new job id.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.ci_job_observations.run_attempt IS
            'Attempt number of the run this job belongs to, from the jobs endpoint read with filter=all. Default 1.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.ci_job_observations.runner_name IS
            'GitHub runner_name of the job. NULL = unknown: the field was absent or null in the wire, which is not evidence of no runner. An empty string is stored as read and classified unknown.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.ci_job_observations.runner_labels IS
            'The runs-on labels of the job as GitHub reports them. The detector derives a host peer set from these: hosts that ran jobs with the same label set in the same repos and window.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.ci_job_observations.self_hosted IS
            'True when runner_labels contains self-hosted. ix_ci_job_obs_runner_completed is partial on it: a hosted job is never a host outcome.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.ci_job_observations.step_count IS
            'Number of steps in the job. NULL when the wire carried no steps field at all; 0 when it carried an empty array. Only an absent steps field makes the outcome unknown.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.ci_job_observations.failed_step_count IS
            'Steps that concluded failure or timed_out. NULL when steps was absent from the wire. Zero failed steps on a failed job is the infra-shaped signal.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.ci_job_observations.outcome IS
            'Classification by ci_job_outcome: pass | content_fail | infra_shaped | neutral | unknown. Text with no CHECK, as coord.notifications.kind is, so a new class is a Rust change rather than a migration. unknown rows never count toward a host share.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.ci_job_observations.duration_band IS
            'For infra_shaped only: fast (under 60 s) | reaper_plateau (590 to 625 s or 890 to 925 s, the GitHub abandoned-job reaper and lost-communication timeout) | mid. NULL for every other outcome. No CHECK.'
        """
    )

    # IF NOT EXISTS is name-blind to type; acceptable because nothing earlier
    # in this chain spells run_attempt on coord.ci_runs.
    op.execute(
        """
        ALTER TABLE coord.ci_runs
            ADD COLUMN IF NOT EXISTS run_attempt INTEGER
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.ci_runs.run_attempt IS
            'GitHub run_attempt of this workflow run, written by the coord module ci_runs_watcher from both of its ingest paths: the workflow_run webhook and the 60 s poll backstop. NULL = written before this column existed, or by a path that does not know the attempt; ci_job_sampler treats NULL as attempt 1. Nullable with no default so the column add rewrites no row.'
        """
    )

    op.execute("SET LOCAL lock_timeout = DEFAULT")


def downgrade() -> None:
    """Drop coord.ci_runs.run_attempt, the two indexes and coord.ci_job_observations."""
    # Dropping the column locks coord.ci_runs the same way adding it did.
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute("ALTER TABLE coord.ci_runs DROP COLUMN IF EXISTS run_attempt")
    op.execute("DROP INDEX IF EXISTS coord.ix_ci_job_obs_key")
    op.execute("DROP INDEX IF EXISTS coord.ix_ci_job_obs_runner_completed")
    op.execute("DROP TABLE IF EXISTS coord.ci_job_observations")
    op.execute("SET LOCAL lock_timeout = DEFAULT")
