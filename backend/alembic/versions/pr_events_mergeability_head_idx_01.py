"""coord.pr_events: index each PR head's mergeability observations by evidence and time.

Adds one index, ``CONCURRENTLY``::

    coord.pr_events (repo, pr_number, (payload->>'head_sha'), (<conflicting>), created_at)
                    WHERE event_kind IN ('ingest', 'hydration')
                      AND payload ? 'head_sha'
                      AND (<conflicting> OR <clearly not conflicting>)
                                                 idx_pr_events_mergeability_head_created

Prerequisite for Phase 3 of plan
``2026-11-04-train-health-conflicting-unproposed-read-times-out``, dossier
``coord-train-read-timeouts``.

What is slow
------------------------------------------------------------------------------
coord's conflict clock asks, for each conflicting PR, when its current conflict
began: the start of the trailing run of conflicting ``ingest`` / ``hydration``
observations at the PR's current head. ``pr_merge/conflicting_now.rs``
(``trailing_onset_by_pr``) answers that by reading every observation of the PR in a
90-day window, because the head and the evidence both live in the JSON payload.
``coord.pr_events`` is append-only, so a PR's rows sit one to a heap page among
every other PR's.

Measured on production 2026-11-04 (finding
``e838e2e6-eb91-4ed1-81d8-4722274ae7aa``, read-only ECS probe, Postgres 16.13), for 8
PRs of ``qontinui/qontinui-coord`` holding 2,028 observations each on average:
24,856 ms and 16,515 buffers, 13,523 of them reads at 1.81 ms, on a volume averaging
about 2,400 of its 3,000 IOPS. An immediate re-run took 148 ms. coord hides that
behind a per-process memo, so a read on a replica whose memo is cold, of pages the
database has evicted, pays it: ``coord_query_train_health`` failed on it for
qontinui-coord, the claude-config, the web and the supervisor repos on 2026-11-03/04.
The same clock sits under ``GET /pr-merge/prs``.

What this index does
------------------------------------------------------------------------------
It lets coord state the same fold as two probes per PR, with no memo: the newest
clearly-not-conflicting observation at this head, then the oldest conflicting one
after it. Measured on a synthetic table of production's cadence, shape and
interleaving (7.2M rows, because the index does not exist on production yet): 840
buffers for 84 PRs, about 10 per PR against production's 2,064, and the same answers
on every PR.

The key is ``(repo, pr_number, head_sha, conflicting, created_at)``, so each probe is
an index-ordered walk of one PR head's rows of one evidence class. The partial
predicate leaves out the kinds this clock never reads and the observations that are
evidence of nothing (GitHub's ``UNKNOWN`` recompute sentinel), because neither can
ever answer a probe.

**The expressions are a contract with coord.** A partial expression index is used
only by a query carrying the same expressions, so these are the expressions of
``CONFLICTING_PAYLOAD_SQL`` and ``NOT_CONFLICTING_EVIDENCE_PAYLOAD_SQL`` in
``pr_merge/conflicting_now.rs``. Changing one side alone leaves coord correct and slow.
Phase 3 also inlines ``event_kind`` as a literal: a bound ``ANY($1)`` proves the
predicate in a custom plan but not in a generic one, and a literal proves it in both.

**``payload ? 'head_sha'`` keeps every other reader off this index, and is why this
revision has no ordering hazard.** coord's delta read today ends in ``WHERE conflicting
OR not_conflicting_evidence``. Without this conjunct the planner pushes that filter down,
where it matches the predicate exactly, so the index becomes usable and looks far
cheaper. But its evidence column sits ahead of ``created_at``, so ``created_at > since``
cannot bound the walk: on the synthetic table, 5,491 buffers for 84 PRs against 672
without the index, on a read under the ``GET /pr-merge/prs`` poll. No existing query
carries this conjunct, and a head equality does not imply it, so the delta read stays
where it is. Phase 3's probes must carry it. It costs nothing: an observation with no
head can answer no probe.

Why not ``idx_pr_events_hydration_head_created``
------------------------------------------------------------------------------
That index (``coord_pr_events_hydration_head_idx``) resolves the head, but it carries
no evidence, so finding the newest clear still visits every row of a head that has
none: the strand's whole length, which is the cost being removed. It is also partial
on ``hydration`` alone, and this clock reads ``ingest`` too. It stays.

Order against coord
------------------------------------------------------------------------------
This revision may land at any time: no running coord build can plan on the index, so
every reader is correct and exactly as fast as it was, whichever deploys first.

**coord's stateless clock must not trust that the index exists,** because that read has
no memo to hide the scan, and ``deploy-web.yml`` does not depend on the migrator, so a
healthy web deploy says nothing about the build. Phase 3 reads ``indisvalid`` itself, and
answers UNKNOWN rather than scanning when the index is missing or invalid.

Building on a large, busy table
------------------------------------------------------------------------------
``CREATE INDEX CONCURRENTLY IF NOT EXISTS`` (``SHARE UPDATE EXCLUSIVE`` only) inside
``autocommit_block()``, so the build takes no lock that blocks coord's writes.
Precedents: ``coord_retention_idx_01``, ``coord_iops_idx_01``.

What it does cost:

- It reads the 4.3 GB heap twice plus an index pass, on a volume already near its
  IOPS cap, so reads are slower for the whole build. Arithmetic puts it between 3 and
  30+ minutes.
- While it runs it holds back vacuum across the database (the xmin horizon) and blocks
  ``VACUUM coord.pr_events`` (``SHARE UPDATE EXCLUSIVE``). A partial expression index
  gets no "safe" concurrent treatment, so other concurrent index builds wait for it too.
- About 0.7 GB on production, going by ``idx_pr_events_hydration_head_created``, whose
  key is near-identical: 687 MB there after two months of inserts. Built fresh on the
  synthetic table this index is 95 bytes an entry. 20 GB was free on 2026-11-04. WAL and
  temp space during the build are of the same order.
- One more index entry per ``hydration`` or ``ingest`` row, under one row a second
  fleet-wide. A dead build that reads ``indisready`` true (killed during its
  validation scan, or the second-migrator case below) keeps costing that until it is
  dropped; one killed during its first heap scan reads false and is not maintained.

No in-migration guards, deliberately, on the ``coord_iops_idx_01`` reasoning: coord's
migration classifier (``pr_merge/migration_classifier.rs``) is fail-closed, and rejects
a read through ``op.get_bind().execute`` and a ``DROP`` on the upgrade path. A killed
concurrent build leaves an INVALID index that ``IF NOT EXISTS`` then skips and reports
as success. So ``indisvalid`` is checked AFTER the deploy instead::

    SELECT c.relname, i.indisvalid
      FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
     WHERE c.relname = 'idx_pr_events_mergeability_head_created';

``false`` means: wait until ``pg_stat_progress_create_index`` is empty, because a live
build also reads ``false``, then run ``DROP INDEX CONCURRENTLY coord.<name>`` and re-run
the statement below by hand.

**A second migrator kills a live build.** It waits on the first's lock, the deadlock
detector usually fires, and the FIRST dies while the second prints ``already exists,
skipping``, exits 0 and closes any open ``migration-failure`` issue, leaving the index
INVALID. Reproduced on Postgres 16.13. ``.github/workflows/migrate.yml``'s concurrency
group covers only its 900 s waiter, which never stops the task, so this needs a build that
outlasts the waiter and a later run: its 03:00 UTC cron, a push touching
``backend/alembic/**``, ``backend/pyproject.toml`` or ``backend/poetry.lock``, or coord's
gate executor or a manual dispatch. Nothing in that workflow or in ``alembic/env.py``
takes an advisory lock, and a blocking one would not help: the session waiting on it holds
a snapshot that the first build's last phase waits for, and the deadlock still fires. So
land this away from 03:00 UTC, and merge no other PR touching those paths until
``pg_stat_progress_create_index`` is empty. Plan
``2026-11-04-train-health-conflicting-unproposed-read-times-out`` dispatches a session
after this lands that reads ``indisvalid`` and owns the repair above.

Expected coord migration-classifier disposition: **AutoSafe**. The upgrade path is one
guarded ``CREATE INDEX CONCURRENTLY IF NOT EXISTS`` inside an autocommit block, and the
SQL is a static literal. ``tests/test_pr_events_mergeability_head_idx_01_migration.py``
pins that shape and asserts both probes plan on the index.

Revision ID: pr_events_mergeability_head_idx_01
Revises: ci_job_res_02
Create Date: 2026-11-04

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "pr_events_mergeability_head_idx_01"
down_revision: str | Sequence[str] | None = "ci_job_res_02"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Build the partial expression index. Additive; no row changes."""
    with op.get_context().autocommit_block():
        # Plain literal, never an f-string: the `alembic-schema-arg-gate`
        # pre-commit hook and coord's migration classifier both read it statically.
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS
                idx_pr_events_mergeability_head_created
            ON coord.pr_events (
                repo,
                pr_number,
                (payload->>'head_sha'),
                (COALESCE(
                    (payload->>'mergeable') = 'false'
                    OR lower(payload->>'merge_state_status') = 'dirty',
                    false)),
                created_at
            )
            WHERE event_kind IN ('ingest', 'hydration')
              AND payload ? 'head_sha'
              AND (
                COALESCE(
                    (payload->>'mergeable') = 'false'
                    OR lower(payload->>'merge_state_status') = 'dirty',
                    false)
                OR COALESCE(
                    (payload->>'mergeable') = 'true'
                    OR (payload->>'merge_state_status' IS NOT NULL
                        AND lower(payload->>'merge_state_status') <> 'unknown'),
                    false)
              )
            """
        )


def downgrade() -> None:
    """Drop the index concurrently. No row changes."""
    with op.get_context().autocommit_block():
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS "
            "coord.idx_pr_events_mergeability_head_created"
        )
