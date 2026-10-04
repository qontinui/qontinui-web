"""coord.ci_pool_observations — durable per-(repo, pool) CI queue and eligibility reading

Revision ID: coord_ci_pool_observations_01
Revises: journey_01_edge_ledger
Create Date: 2026-10-04

Phase 1 of plan ``2026-10-04-ci-dashboard-in-the-dev-ops-console``.

Creates ``coord.ci_pool_observations``: one row per ``(repo, pool)``, holding
the most recent reading coord's leader took of that pool, from two watchers:

* the queue-wait watcher (``qontinui-coord`` ``ci_queue_wait.rs``): queued job
  count, oldest queued age, the starvation threshold and the p90 wait;
* the pool-eligibility pass (``ci_pool_eligibility.rs``): the eligibility
  state and the eligible / unknown / drained runner and registration counts.

## Why a table

Both watchers are leader-gated and keep their state in process memory, so a
read served by a follower replica sees nothing and reports zero. The CI
dashboard (``GET /coord/ci/overview``, Phase 2) reads this table instead, so
every replica serves the same answer and the answer survives a deploy.

``coord.ci_pool_eligibility_baselines`` (``coord_ci_pool_baselines_01``) is
NOT reused: it writes nothing for an UNKNOWN pool and deliberately does not
refresh a retired row, so it cannot carry a failed poll or the queue state.
For a measured pool the two must agree; Phase 2 tests that.

## What writes it

coord, Phase 2 of the same plan. At the end of each queue-wait leader tick and
on each eligibility pass, the leader upserts its readings for each
``(repo, pool)``. A failed poll writes ``poll_ok = false`` and NULL counts,
never zero.

## Column shape

* ``repo`` TEXT NOT NULL, ``owner/name`` LOWERCASED by the writer. CHECK
  ``repo = lower(repo)``: GitHub treats owner/name case-insensitively, so two
  spellings would split one pool into two rows. The CHECK makes a writer that
  skips the lowercasing fail loudly. The reader joins ``coord.tenant_repos``
  case-insensitively, because that table has no such CHECK.
* ``pool`` TEXT NOT NULL, the pool key: the runs-on labels trimmed, lowercased,
  deduplicated, sorted and joined with a comma, rendered by the one shared
  ``pool_key`` function. CHECK ``length(btrim(pool)) > 0``: an empty or
  blank key would be a pool with no labels, which no job can target.
* ``observed_at`` TIMESTAMPTZ NOT NULL, no default: the tick time, set by the
  writer on every upsert. A default would cover INSERT only, and the house has
  no trigger to cover UPDATE.
* ``stale_after_secs`` INTEGER NOT NULL, CHECK ``> 0``. Computed and stored by
  the writer per row, because the queue-wait watcher walks repos from a cursor
  under a call budget, so the revisit interval depends on how many repos are
  armed. Storing it means the reader never guesses the watcher cadence.
* ``poll_ok`` BOOLEAN NOT NULL: false when the poll failed. A failed poll is
  UNKNOWN, never "no queued jobs".
* ``poll_complete`` BOOLEAN NOT NULL: false when the poll succeeded only in
  part (for example, the call budget ran out mid-repo).
* ``queued_jobs``, ``oldest_queued_age_secs``, ``threshold_secs``,
  ``p90_wait_secs`` INTEGER NULL.
* ``eligibility_state`` TEXT NULL, CHECK in ``eligible`` |
  ``no_eligible_runner`` | ``unknown``. NULL means the eligibility pass has not
  observed this pool. The CHECK is deliberate, unlike the unchecked ``outcome``
  of ``coord.ci_job_observations``: the dashboard renders these three states
  and nothing else, so a fourth value must be a schema change the reader
  learns about rather than a string it silently mis-renders.
* ``eligible_runners``, ``eligible_registrations``, ``unknown_registrations``,
  ``eligible_runners_drained`` INTEGER NULL.
* ``eligibility_observed_at`` TIMESTAMPTZ NULL: when the eligibility half was
  last written. The two halves come from two watchers on two cadences, so the
  eligibility half carries its own time rather than borrowing ``observed_at``.

Every count is nullable, and NULL means "not measured". A ``0`` is stored only
when it was measured. That is the whole point of the table: the dashboard
renders NULL as UNKNOWN and ``0`` as a real zero, and a writer that stored a
stand-in zero would make an unreadable pool look idle.

The counts carry no non-negative CHECK. A CHECK failure aborts the upsert, and
``oldest_queued_age_secs`` is a difference of two clocks (GitHub job creation
time against coord tick time) that skew can push below zero; losing the whole
row to a one-second skew would turn a measurement into a gap. Clamping is the
writer job.

## No tenant_id, no required column

No ``tenant_id``: GitHub queue state is a fact about a repo, not a tenant, so
the read scopes through ``coord.tenant_repos`` (as ``coord.ci_job_observations``
does), and per-tenant rows would only duplicate the writes. For the same reason
there is no FK to ``coord.tenants``. No ``required`` column: whether a pool is
on a required path is derived at read time, never persisted as a second source
of truth. No SQLAlchemy model: this table is coord-only.

## Key, and no secondary index

Primary key ``(repo, pool)``: the writer upsert key. The reader scans the
table for a tenant repo set, which is small; a repo prefix scan of the key
serves it. No planned reader filters on a timestamp or on ``poll_ok``.

## Two-repo ordering: this schema half lands and is APPLIED first

alembic in qontinui-web is the SOLE author of ``coord.*`` schema; the
``qontinui-coord`` binary authors zero ``coord.*`` DDL. The coord writer and
reader (Phase 2) degrade on a missing table, and land after this revision is
applied in production.

## Head choice

``down_revision`` is ``journey_01_edge_ledger``, the single head of
``origin/main`` at ``471efbe95`` when this revision was written
(``scripts/ci/count_alembic_heads.py`` reported ``HEAD_COUNT=1``). If main has
moved before it lands, re-point ``down_revision``, the ``Revises:`` header and
``_PARENT_REVISION_ID`` in the migration test at the new single head. Do not
add an ``alembic merge``: this repo keeps strict single-head discipline.

## Merge-train classifier disposition

coord's migration classifier (``qontinui-coord``
``crates/coord/src/pr_merge/migration_classifier.rs``) is expected to classify
this revision Reject: ``COMMENT ON`` is not a form it recognises, and it scans
``downgrade()`` too, where it rejects the ``DROP TABLE``. Every SQL string is a
static literal, so it is not rejected for being dynamic. The landed precedents
``coord_ci_pool_baselines_01`` and ``coord_ci_job_observations_01`` classify
Reject the same way.

## Safety

``CREATE TABLE IF NOT EXISTS``, and every ``COMMENT ON`` is re-runnable, so a
partial apply re-runs cleanly. No existing table is touched and there is no
FK, so the apply takes no lock on any table coord writes. ``downgrade()`` is
``DROP TABLE IF EXISTS``, and the comments go with the table. Both directions
are pure SQL execution with no bind or inspection, so they work under
``alembic ... --sql`` offline mode.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_ci_pool_observations_01"
down_revision: str | Sequence[str] | None = "journey_01_edge_ledger"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Every SQL string below is a STATIC literal. The coord merge-train migration
# classifier extracts string literals from each execute call and rejects a call
# with none as dynamic. Keep these comments free of apostrophes and of the
# op-dot-call spelling: the classifier lexer does not skip Python comments.


def upgrade() -> None:
    """Create coord.ci_pool_observations and document it in the catalogue."""
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.ci_pool_observations (
            repo                      TEXT NOT NULL,
            pool                      TEXT NOT NULL,
            observed_at               TIMESTAMPTZ NOT NULL,
            stale_after_secs          INTEGER NOT NULL,
            poll_ok                   BOOLEAN NOT NULL,
            poll_complete             BOOLEAN NOT NULL,
            queued_jobs               INTEGER,
            oldest_queued_age_secs    INTEGER,
            threshold_secs            INTEGER,
            p90_wait_secs             INTEGER,
            eligibility_state         TEXT,
            eligible_runners          INTEGER,
            eligible_registrations    INTEGER,
            unknown_registrations     INTEGER,
            eligible_runners_drained  INTEGER,
            eligibility_observed_at   TIMESTAMPTZ,
            CONSTRAINT ci_pool_observations_pkey
                PRIMARY KEY (repo, pool),
            CONSTRAINT ci_pool_observations_repo_lowercase_check
                CHECK (repo = lower(repo)),
            CONSTRAINT ci_pool_observations_pool_nonblank_check
                CHECK (length(btrim(pool)) > 0),
            CONSTRAINT ci_pool_observations_stale_after_positive_check
                CHECK (stale_after_secs > 0),
            CONSTRAINT ci_pool_observations_eligibility_state_check
                CHECK (eligibility_state IN ('eligible', 'no_eligible_runner', 'unknown'))
        )
        """
    )

    # The comments carry what the names cannot: NULL means not measured, the
    # pool key format, and that the writer owns every timestamp. psql describe
    # output is where a human meets this schema; the module docstring ships
    # nowhere they will see it.
    op.execute(
        """
        COMMENT ON TABLE coord.ci_pool_observations IS
            'Latest per (repo, pool) CI queue and eligibility reading, written by the coord leader at the end of each queue-wait tick and eligibility pass, and read by GET /coord/ci/overview so every replica serves the same answer. Every count is NULL when not measured; a zero is stored only when measured. No tenant_id: reads scope through coord.tenant_repos.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.ci_pool_observations.repo IS
            'GitHub repository as owner/name, lowercased by the writer; the repo_lowercase CHECK rejects an unnormalised write. Readers join coord.tenant_repos case-insensitively.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.ci_pool_observations.pool IS
            'Pool key: the runs-on labels trimmed, lowercased, deduplicated, sorted and joined with a comma, rendered by the one shared pool_key function.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.ci_pool_observations.observed_at IS
            'Tick time of the most recent write. No default: the writer sets it on every upsert.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.ci_pool_observations.stale_after_secs IS
            'Age past which this row is stale, computed by the writer from the watcher cadence and the armed repo count, so the reader never guesses it.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.ci_pool_observations.poll_ok IS
            'False when the poll failed. A failed poll is UNKNOWN, never no queued jobs, and its counts are NULL.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.ci_pool_observations.poll_complete IS
            'False when the poll succeeded only in part, for example when the call budget ran out mid-repo.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.ci_pool_observations.queued_jobs IS
            'Jobs queued for this pool at observed_at. NULL when not measured.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.ci_pool_observations.oldest_queued_age_secs IS
            'Age of the oldest queued job at observed_at. NULL when not measured or when nothing is queued.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.ci_pool_observations.threshold_secs IS
            'Queue-wait threshold past which the watcher raises ci_job_queue_stalled. NULL when not measured.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.ci_pool_observations.p90_wait_secs IS
            'p90 queue wait over the watcher window. NULL when not measured.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.ci_pool_observations.eligibility_state IS
            'eligible, no_eligible_runner or unknown, from the pool-eligibility pass. NULL when that pass has not observed this pool.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.ci_pool_observations.eligible_runners IS
            'Online runners whose labels satisfy the pool, repo-registered runners only. NULL when not measured.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.ci_pool_observations.eligible_registrations IS
            'Registered runners whose labels satisfy the pool, online or not. NULL when not measured.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.ci_pool_observations.unknown_registrations IS
            'Registrations whose eligibility could not be resolved. NULL when not measured.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.ci_pool_observations.eligible_runners_drained IS
            'Eligible runners on a drained device, reported beside the count rather than subtracted from it. NULL when not measured.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.ci_pool_observations.eligibility_observed_at IS
            'When the eligibility half was last written. The two halves come from two watchers on two cadences. NULL when never written.'
        """
    )


def downgrade() -> None:
    """Drop coord.ci_pool_observations. Its comments and constraints go with it."""
    op.execute("DROP TABLE IF EXISTS coord.ci_pool_observations")
