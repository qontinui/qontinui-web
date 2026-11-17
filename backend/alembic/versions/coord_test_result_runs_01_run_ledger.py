"""coord.test_result_runs — one row per harness run of one CI job or shard.

Phase 2 (web migration) of plan
``2026-11-07-per-test-results-carry-run-kind-attempts-flakes-and-durations``.
Creates one new, empty table and three indexes::

    coord.test_result_runs (id, repo, job, shard, shard_count, ci_run_id,
                            ci_run_attempt, ref_name, ref_class, run_kind,
                            harness, max_attempts, head_sha, tested_sha,
                            base_sha, executed_count, parsed_count,
                            skipped_count, exceptions_count, units_expected,
                            units_reported, persisted_rows, exceptions,
                            exceptions_truncated, slowest, total_test_seconds,
                            inclusion_probability, gating_outcome, tenant_id,
                            first_reported_at, last_reported_at)
        uq_test_result_runs_identity
            UNIQUE (repo, ci_run_id, ci_run_attempt, job, shard)
        idx_test_result_runs_repo_last     (repo, last_reported_at DESC)
        idx_test_result_runs_repo_tested   (repo, tested_sha)
        idx_test_result_runs_last_reported (last_reported_at)

Why this table exists
=====================

The selective-CI theory's assessment protocol (qontinui-research
``theory/test-selection-assessment.md``, its Stage 0) needs labels: the
per-test outcome of a full run, first attempt as the label of record, beside
the run's own count of what it executed. ``coord.test_results`` cannot carry
that. It holds no executed count, it stores a pass-on-retry as ``pass``
(coord's ``parse_junit_xml`` classifies by substring and a ``<flakyFailure>``
matches none), and writing per-test rows for every candidate and DB-lane run
would add tens of gigabytes to a database already near its autoscale ceiling.
So each run gets ONE row here: its identity, its tags, its counts, the tests
that did not pass on the first attempt ("exceptions") and its slowest tests.
Per-test rows stay where they are already written or cheap. A test that
executed in a ``complete`` run and has no exception passed.

Column authority
================

Identity — the natural key, ``uq_test_result_runs_identity``:

* ``repo text NOT NULL`` — spelled as ``coord.test_results.repo``.
* ``job text NOT NULL`` — the job key plus any matrix leg.
* ``shard text NOT NULL DEFAULT ''`` — the shard label, ``''`` for an unsharded
  job (NOT NULL so the UNIQUE constraint treats an unsharded run as one key).
* ``shard_count smallint NOT NULL DEFAULT 1``, ``>= 1`` — how many shards the
  job's run is split into; the coverage read wants a complete report from each.
* ``ci_run_id bigint NOT NULL`` / ``ci_run_attempt integer NOT NULL``
  (``>= 1``) — GitHub's run id and re-run attempt. A harness's own retry count
  is not this; it is ``attempts`` on an exception.

Tags:

* ``ref_name text`` — the ref the run tested.
* ``ref_class text NOT NULL`` — ``pr_merge_ref`` | ``candidate`` |
  ``main_push`` | ``schedule`` | ``dispatch`` | ``other``.
* ``run_kind text NOT NULL`` — ``full`` | ``selected`` | ``audit`` |
  ``backstop`` | ``mutant`` | ``replicate``. coord's writer refuses per-test
  rows from ``selected``, ``mutant`` and ``replicate`` runs; ``replicate`` is
  the isolated re-run of a red's failing tests.
* ``harness text NOT NULL`` — ``nextest`` | ``libtest`` | ``spec_ci`` |
  ``guard_roster`` | ``other``.
* ``max_attempts smallint``, ``>= 1`` — the harness's attempt budget per test.
* ``head_sha`` / ``tested_sha`` / ``base_sha text`` — the PR head, the commit
  actually tested (a merge ref or candidate tip), and its base.

Counts — every one ``>= 0`` and NULL when the producer could not read it, which
coord's completeness verdict reads as ``unknown``, never as zero:

* ``executed_count`` — the harness's own declared count of tests it set out to
  run (nextest's Summary "N tests run"; the sum of libtest's ``running N tests``
  headers; a Spec CI corpus glob).
* ``parsed_count`` — the results the report holds, counted the same way.
* ``skipped_count`` — skipped testcases IN THE REPORT, never a Summary figure.
* ``exceptions_count`` — the producer's true count of exception testcases, even
  when it capped the list it sent.
* ``units_expected`` / ``units_reported`` — test processes launched, and those
  that reported a result line. A unit that never starts declares no tests, so
  only this pair can see it.
* ``persisted_rows bigint NOT NULL DEFAULT 0`` — per-test rows this run wrote to
  ``coord.test_results``, accumulated chunk by chunk by coord's per-test door.

Payload:

* ``exceptions jsonb NOT NULL DEFAULT '[]'`` — a JSON array, one entry per test
  that did not pass on its first attempt: ``test_id``, ``outcome`` (the
  harness's final verdict), ``first_attempt_outcome``, ``attempts``,
  ``duration_seconds`` and an optional per-test ``inclusion_probability``.
* ``exceptions_truncated boolean NOT NULL DEFAULT false`` — the producer capped
  the list.
* ``slowest jsonb NOT NULL DEFAULT '[]'`` — a JSON array of the run's slowest
  tests as ``{test_id, duration_seconds}``.
* ``total_test_seconds double precision`` — the sum of the tests' durations.

Verdict inputs:

* ``inclusion_probability double precision``, in ``(0, 1]`` — the run's
  inclusion probability; 1.0 for a full run.
* ``gating_outcome text`` — ``success`` | ``failure`` | ``cancelled`` |
  ``skipped``: the verdict-bearing step's own outcome.

Bookkeeping:

* ``tenant_id uuid`` — never taken from a request body. It stays NULL while
  coord's report door authenticates with the shared ingest bearer, which
  carries no tenant.
* ``first_reported_at`` / ``last_reported_at timestamptz NOT NULL DEFAULT
  now()`` — the first and latest write to the row (a report, or a chunk of the
  run's per-test rows).

Both JSON payload columns carry a ``jsonb_typeof(...) = 'array'`` CHECK, so a
reader can iterate them without a type test.

Indexes
=======

* ``(repo, last_reported_at DESC)`` — the per-repo run list, newest first.
* ``(repo, tested_sha)`` — a run looked up by the commit it tested.
* ``(last_reported_at)`` — the age index coord's retention sweep rides. The
  ledger keeps 90 days (``COORD_TEST_RESULT_RUNS_RETENTION_DAYS``), roughly
  90-180k rows. The sweep's batch subquery binds no ``repo``, so without this
  index it would seq-scan the whole heap every five minutes, a cost that grows
  with every repository onboarded.

All three are built ``CONCURRENTLY`` in ``autocommit_block()`` though the table
is new and empty. coord's migration classifier, the gate that lets a migration
PR auto-land, cannot see that a table is empty and rejects a non-concurrent
``CREATE INDEX``. It also rejects ``op.get_bind()`` reads, so there is no
``indisvalid`` check (the same shape ``coord_test_result_heads_01`` shipped).

Idempotency / authorship posture
================================

* ``CREATE TABLE IF NOT EXISTS`` / ``CREATE INDEX CONCURRENTLY IF NOT EXISTS``,
  and a symmetric ``downgrade()`` that drops the indexes and then the table.
* **alembic is the SOLE author of the ``coord.*`` schema** (served policy
  ``production-and-cost`` ``alembic-sole-authorship``). coord only INSERTs,
  UPDATEs, SELECTs and prune-DELETEs this table, and its readers wait for this
  revision's production apply.
* No backfill: the table fills from the next CI run after coord's report door
  deploys.

Chaining
========

``down_revision = "outbound_budget_windows_01"`` -- ``main``'s single alembic
head, measured 2026-11-07 with ``scripts/ci/count_alembic_heads.py``
(``HEAD_COUNT=1``) at ``origin/main`` ``a2d0b69db``. A re-point is three
coupled edits: ``down_revision``, the ``Revises:`` line below, and
``_PARENT_REVISION_ID`` in ``tests/test_coord_test_result_runs_01_migration.py``.

Revision ID: coord_test_result_runs_01
Revises: outbound_budget_windows_01
Create Date: 2026-11-07

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_test_result_runs_01"
down_revision: str | None = "outbound_budget_windows_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create ``coord.test_result_runs`` and its three indexes. Idempotent."""
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.test_result_runs (
            id                    uuid             PRIMARY KEY DEFAULT gen_random_uuid(),
            -- identity (the natural key, uq_test_result_runs_identity)
            repo                  text             NOT NULL,
            job                   text             NOT NULL,
            shard                 text             NOT NULL DEFAULT '',
            shard_count           smallint         NOT NULL DEFAULT 1
                                                   CHECK (shard_count >= 1),
            ci_run_id             bigint           NOT NULL,
            ci_run_attempt        integer          NOT NULL
                                                   CHECK (ci_run_attempt >= 1),
            -- tags
            ref_name              text,
            ref_class             text             NOT NULL,
            run_kind              text             NOT NULL,
            harness               text             NOT NULL,
            max_attempts          smallint         CHECK (max_attempts >= 1),
            head_sha              text,
            tested_sha            text,
            base_sha              text,
            -- counts: NULL = the producer could not read it (coord: unknown)
            executed_count        integer          CHECK (executed_count >= 0),
            parsed_count          integer          CHECK (parsed_count >= 0),
            skipped_count         integer          CHECK (skipped_count >= 0),
            exceptions_count      integer          CHECK (exceptions_count >= 0),
            units_expected        integer          CHECK (units_expected >= 0),
            units_reported        integer          CHECK (units_reported >= 0),
            persisted_rows        bigint           NOT NULL DEFAULT 0
                                                   CHECK (persisted_rows >= 0),
            -- payload
            exceptions            jsonb            NOT NULL DEFAULT '[]'::jsonb,
            exceptions_truncated  boolean          NOT NULL DEFAULT false,
            slowest               jsonb            NOT NULL DEFAULT '[]'::jsonb,
            total_test_seconds    double precision,
            -- verdict inputs
            inclusion_probability double precision
                CHECK (inclusion_probability > 0 AND inclusion_probability <= 1),
            gating_outcome        text,
            -- bookkeeping; tenant_id is never taken from a request body
            tenant_id             uuid,
            first_reported_at     timestamptz      NOT NULL DEFAULT now(),
            last_reported_at      timestamptz      NOT NULL DEFAULT now(),
            CONSTRAINT ck_test_result_runs_ref_class CHECK (ref_class IN
                ('pr_merge_ref', 'candidate', 'main_push', 'schedule',
                 'dispatch', 'other')),
            CONSTRAINT ck_test_result_runs_run_kind CHECK (run_kind IN
                ('full', 'selected', 'audit', 'backstop', 'mutant',
                 'replicate')),
            CONSTRAINT ck_test_result_runs_harness CHECK (harness IN
                ('nextest', 'libtest', 'spec_ci', 'guard_roster', 'other')),
            CONSTRAINT ck_test_result_runs_gating_outcome CHECK (gating_outcome IN
                ('success', 'failure', 'cancelled', 'skipped')),
            CONSTRAINT ck_test_result_runs_exceptions_array
                CHECK (jsonb_typeof(exceptions) = 'array'),
            CONSTRAINT ck_test_result_runs_slowest_array
                CHECK (jsonb_typeof(slowest) = 'array'),
            -- The ON CONFLICT target of both coord doors (report and per-test).
            CONSTRAINT uq_test_result_runs_identity
                UNIQUE (repo, ci_run_id, ci_run_attempt, job, shard)
        )
        """
    )
    # CONCURRENTLY although the table is new and empty: coord's migration
    # classifier (the auto-land gate) cannot see emptiness and rejects any
    # non-concurrent CREATE INDEX as a write lock, and on an empty table the
    # concurrent builds are instant. No indisvalid read -- the classifier
    # rejects op.get_bind() reads too (cf. coord_test_result_heads_01).
    with op.get_context().autocommit_block():
        # The per-repo run list, newest first.
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_test_result_runs_repo_last
                ON coord.test_result_runs (repo, last_reported_at DESC)
            """
        )
        # A run looked up by the commit it tested.
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_test_result_runs_repo_tested
                ON coord.test_result_runs (repo, tested_sha)
            """
        )
        # The age index the retention sweep rides (its subquery binds no repo).
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_test_result_runs_last_reported
                ON coord.test_result_runs (last_reported_at)
            """
        )


def downgrade() -> None:
    """Drop ``coord.test_result_runs`` and its indexes."""
    op.execute("DROP INDEX IF EXISTS coord.idx_test_result_runs_last_reported")
    op.execute("DROP INDEX IF EXISTS coord.idx_test_result_runs_repo_tested")
    op.execute("DROP INDEX IF EXISTS coord.idx_test_result_runs_repo_last")
    op.execute("DROP TABLE IF EXISTS coord.test_result_runs")
