"""coord.ci_job_queue_waits - per-job CI queue wait derived from workflow_job deliveries

Revision ID: coord_ci_job_queue_waits_01
Revises: coord_webhook_deliveries_01
Create Date: 2026-11-22

Phase 1 of plan
``2026-11-22-deliveries-become-durable-github-intake-redelivery-sweep-and-jetstream-authority``
(design decision D6). Additive: one new table.

## What writes it

``qontinui-coord`` ``ci_job_queue_wait_ingest`` (Phase 5), from the
``workflow_job`` webhook ``in_progress`` action: queue wait is
``started_at - created_at``. One row per ``(repo, job_id, run_attempt)``,
UPSERTed. Read by the CI queue-wait claim and count queries. While no row has
ever been written (the App is not subscribed to ``workflow_job``) the reader
reports UNKNOWN, never zero.

## Retention

Not yet pruned by this revision. The writing coord phase owns a retention
decision (30 days, matching ``coord.ci_job_observations``) and names it in its
PR; the table is small (one row per job).

## Column notes

* ``pool_key`` TEXT NOT NULL - the runner-label pool the job queued for.
* ``self_hosted`` BOOLEAN NOT NULL - labels contain ``self-hosted``.
* ``queue_wait_ms`` BIGINT NOT NULL - ``job_started_at - job_created_at``.
* ``runner_name`` / ``delivery_guid`` - NULL means unknown.

Primary key ``(repo, job_id, run_attempt)``. Index
``ix_ci_job_queue_waits_pool_started`` on ``(pool_key, job_started_at)``.

## No FK, no ORM model

No FK to ``coord.webhook_deliveries``: that table is retained 7 days and
``delivery_guid`` here is provenance only. No SQLAlchemy model.

## Two-repo ordering

alembic in qontinui-web is the SOLE author of ``coord.*`` schema; this lands
and is applied before the coord PR that writes the table.

## Head choice

Chains off ``coord_webhook_deliveries_01`` (same PR). Do not add an
``alembic merge``.

## Safety

``CREATE ... IF NOT EXISTS``, re-runnable ``COMMENT ON``; no existing table is
touched. ``downgrade()`` drops the index then the table, ``IF EXISTS``. Static
SQL, valid under ``alembic --sql``.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_ci_job_queue_waits_01"
down_revision: str | Sequence[str] | None = "coord_webhook_deliveries_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Every SQL string below is a STATIC literal (coord merge-train classifier).


def upgrade() -> None:
    """Create coord.ci_job_queue_waits, its index and comments."""
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.ci_job_queue_waits (
            repo            TEXT        NOT NULL,
            job_id          BIGINT      NOT NULL,
            run_id          BIGINT      NOT NULL,
            run_attempt     INTEGER     NOT NULL DEFAULT 1,
            workflow_name   TEXT,
            job_name        TEXT,
            runner_labels   TEXT[]      NOT NULL DEFAULT '{}',
            pool_key        TEXT        NOT NULL,
            self_hosted     BOOLEAN     NOT NULL,
            job_created_at  TIMESTAMPTZ NOT NULL,
            job_started_at  TIMESTAMPTZ NOT NULL,
            queue_wait_ms   BIGINT      NOT NULL,
            runner_name     TEXT,
            delivery_guid   TEXT,
            observed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT ci_job_queue_waits_pkey PRIMARY KEY (repo, job_id, run_attempt)
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_ci_job_queue_waits_pool_started
            ON coord.ci_job_queue_waits (pool_key, job_started_at)
        """
    )
    op.execute(
        """
        COMMENT ON TABLE coord.ci_job_queue_waits IS
            'One row per GitHub Actions job attempt, keyed (repo, job_id, run_attempt): queue wait = job_started_at - job_created_at, taken from the workflow_job in_progress delivery. Written by the coord module ci_job_queue_wait_ingest. Zero rows ever means the App is not subscribed to workflow_job: readers report UNKNOWN, not zero. Plan 2026-11-22-deliveries-become-durable-github-intake-redelivery-sweep-and-jetstream-authority, Phase 1.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.ci_job_queue_waits.pool_key IS
            'The runner-label pool the job queued for, derived from runner_labels by coord.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.ci_job_queue_waits.queue_wait_ms IS
            'job_started_at minus job_created_at in milliseconds, from the in_progress workflow_job action.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.ci_job_queue_waits.delivery_guid IS
            'X-GitHub-Delivery of the delivery this row was derived from. Provenance only, no FK: deliveries are retained 7 days. NULL = unknown.'
        """
    )


def downgrade() -> None:
    """Drop the index and coord.ci_job_queue_waits."""
    op.execute("DROP INDEX IF EXISTS coord.ix_ci_job_queue_waits_pool_started")
    op.execute("DROP TABLE IF EXISTS coord.ci_job_queue_waits")
