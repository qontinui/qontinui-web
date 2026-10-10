"""coord.run_outcomes: the durable store behind the run_outcome anchor's metric arm

Revision ID: run_outcomes_01
Revises: devcred_01_credential_deny_and_bound_pair_codes
Create Date: 2026-10-10

Plan ``2026-10-09-spec-front-end-of-the-software-factory`` Phase 2, step 2.

## What it is for

coord's anchor vocabulary (``qontinui-coord`` ``crates/coord/src/anchor_observer.rs``)
gains a behavioural ``run_outcome`` type with two arms. The CONCLUSION arm
(``this workflow ran on this ref and concluded X``) needs no new store: it reads
``coord.ci_runs``. The METRIC arm asserts a measured number::

    {"type":"run_outcome","source":"…","subject":"…","task":"…",
     "metric":"…","at_least":<n>,"min_cases":<n>}

and resolves against the LATEST row of this table for
``(tenant_id, source, subject, task)`` within ONE lane (see "Lanes" below) —
latest by the RUN's own completion
time (``run_completed_at``), never by when coord happened to write the row, so a
late or retried write cannot reorder history. An optional ``ref`` on the anchor
narrows the lookup to rows of that git sha: confirmed when the named metric is at
least ``at_least`` AND ``executed_case_count`` is at least ``min_cases``,
contradicted when either bound is missed, unknown when no row exists. The
``min_cases`` bound is what stops a green run that executed nothing from
confirming a claim (served policy ``a-green-run-must-prove-it-ran``).

## The writer

coord's existing CI result door, ``POST /coord/ci/dispatches/:dispatch_id/result``
(``ci_dispatch::post_result``), accepts an optional metric payload and INSERTs
here under the same principal, assignee and tenant checks it already applies.
Attribution comes from coord's own ``coord.ci_dispatches`` row, never from the
body: ``tenant_id``, ``repo``, ``ref`` (the dispatch's head sha),
``dispatch_id``, ``run_completed_at`` (the dispatch's ``completed_at``) and
``check_name`` (the dispatch's lane). The body contributes only ``source``,
``subject``, ``task``, ``metrics`` and ``executed_case_count``.

## Lanes

A CI dispatch runs on one of two lanes, named by its ``check_name``: the
authoritative ``qontinui-ci-node`` or the shadow ``qontinui-ci-node/shadow``.
coord records outcomes from BOTH (today every dispatch is created on the shadow
lane, so a shadow-only writer is the live path) and stores the lane in
``check_name``; a dispatch row whose lane cannot be read is recorded as shadow,
the same default coord's result door applies everywhere else. The resolver
PREFERS the authoritative lane: when any authoritative row exists for the
lookup, the latest of those decides; only when none does is the latest shadow
row read. The two lanes never interleave into one "latest", so a newer shadow
run can never displace an authoritative one.

## Columns

* ``id`` UUID PK DEFAULT ``gen_random_uuid()``.
* ``tenant_id`` UUID NOT NULL: the tenant whose dispatch produced the run. The
  resolver reads a tenant's own rows only.
* ``source`` / ``subject`` / ``task`` TEXT NOT NULL, never blank: the harness
  that measured, the thing measured, and the evaluation set.
* ``ref`` TEXT NULL: the git sha the run executed against, from the dispatch
  row. NULL when the dispatch carried none.
* ``repo`` TEXT NULL: the dispatch's repository, provenance only.
* ``dispatch_id`` UUID NULL: the ``coord.ci_dispatches`` row that carried the
  POST. NULL leaves room for a future writer that is not a dispatch.
* ``metrics`` JSONB NOT NULL: an object of metric name to number. CHECKed to be
  an object; coord validates names and finiteness before writing.
* ``executed_case_count`` BIGINT NOT NULL, CHECKed non-negative.
* ``run_completed_at`` TIMESTAMPTZ NOT NULL: when the run completed, copied from
  the dispatch row's ``completed_at``. The ordering key for "latest".
* ``check_name`` TEXT NOT NULL, never blank: the dispatch lane
  (``qontinui-ci-node`` or ``qontinui-ci-node/shadow``) the run was recorded
  from. Part of the lookup key, so the lanes never interleave.
* ``recorded_at`` TIMESTAMPTZ NOT NULL DEFAULT ``now()``.

## Indexes

* ``idx_run_outcomes_latest`` on ``(tenant_id, source, subject, task,
  check_name, run_completed_at DESC, id DESC)``: the resolver's query is
  ``WHERE tenant_id, source, subject, task, check_name [AND ref] ORDER BY
  run_completed_at DESC, id DESC LIMIT 1``, run once per lane in preference
  order, each served as one index probe (the optional ``ref`` is a filter on the
  walk).
* ``idx_run_outcomes_one_per_dispatch`` UNIQUE on ``(dispatch_id, source,
  subject, task)`` WHERE ``dispatch_id IS NOT NULL``: one outcome per task per
  dispatch, so a retried result POST can never double-count a run. coord writes
  with ``ON CONFLICT DO NOTHING`` against it.

No FK to ``coord.ci_dispatches``: an outcome is a record of what was measured,
and it must outlive the dispatch ledger's retention.

No SQLAlchemy model: the table is coord-only.

## Two-repo ordering: this schema half lands and is APPLIED first

alembic in qontinui-web is the SOLE author of ``coord.*`` schema; the
``qontinui-coord`` binary authors zero ``coord.*`` DDL. The coord writer and
resolver land after this revision is applied in production, and degrade on
SQLSTATE 42P01 (no table) and 42703 (a missing column) alike until then: the
writer answers ``table_absent`` and the resolver reads unknown, never a verdict.
A database that applied the PRE-amendment shape of this revision (before
``check_name`` was added) has the table but not that column, so it reads
``table_absent`` / unknown until the column exists. No shared database has
applied that earlier shape: this revision has never been on any main, so only
local throwaway databases can carry it.

## Head choice

``down_revision`` is ``devcred_01_credential_deny_and_bound_pair_codes``, the single
head of ``origin/main`` at ``eb54e0bb9`` (``alembic heads`` printed exactly that one head). If main has moved before it lands, re-point
``down_revision``, the ``Revises:`` header and ``_PARENT_REVISION_ID`` in the
migration test at the new single head. Do not add an ``alembic merge``.

## Safety

``CREATE TABLE IF NOT EXISTS`` and ``CREATE INDEX IF NOT EXISTS`` on one new,
empty table, and every ``COMMENT ON`` is re-runnable, so a partial apply re-runs
cleanly. No existing table is touched and there is no FK. ``downgrade()`` is
``DROP TABLE IF EXISTS``; the indexes, constraints and comments go with it. Both
directions are pure static SQL, so they work under ``alembic ... --sql``.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "run_outcomes_01"
down_revision: str | Sequence[str] | None = "devcred_01_credential_deny_and_bound_pair_codes"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Every SQL string below is a STATIC literal. The coord merge-train migration
# classifier extracts string literals from each execute call and rejects a call
# with none as dynamic.


def upgrade() -> None:
    """Create coord.run_outcomes, its two indexes, and document it."""
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.run_outcomes (
            id                   UUID NOT NULL DEFAULT gen_random_uuid(),
            tenant_id            UUID NOT NULL,
            source               TEXT NOT NULL,
            subject              TEXT NOT NULL,
            task                 TEXT NOT NULL,
            ref                  TEXT,
            repo                 TEXT,
            dispatch_id          UUID,
            metrics              JSONB NOT NULL,
            executed_case_count  BIGINT NOT NULL,
            run_completed_at     TIMESTAMPTZ NOT NULL,
            check_name           TEXT NOT NULL,
            recorded_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT run_outcomes_pkey
                PRIMARY KEY (id),
            CONSTRAINT run_outcomes_source_nonblank_check
                CHECK (length(btrim(source)) > 0),
            CONSTRAINT run_outcomes_subject_nonblank_check
                CHECK (length(btrim(subject)) > 0),
            CONSTRAINT run_outcomes_task_nonblank_check
                CHECK (length(btrim(task)) > 0),
            CONSTRAINT run_outcomes_check_name_nonblank_check
                CHECK (length(btrim(check_name)) > 0),
            CONSTRAINT run_outcomes_metrics_object_check
                CHECK (jsonb_typeof(metrics) = 'object'),
            CONSTRAINT run_outcomes_executed_case_count_nonnegative_check
                CHECK (executed_case_count >= 0)
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_run_outcomes_latest
            ON coord.run_outcomes (tenant_id, source, subject, task, check_name, run_completed_at DESC, id DESC)
        """
    )
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS idx_run_outcomes_one_per_dispatch
            ON coord.run_outcomes (dispatch_id, source, subject, task)
            WHERE dispatch_id IS NOT NULL
        """
    )

    op.execute(
        """
        COMMENT ON TABLE coord.run_outcomes IS
            'Measured evaluation-run outcomes: the store behind the metric arm of coord''s run_outcome anchor. The anchor resolves against the latest row, by run_completed_at, for (tenant_id, source, subject, task) and optionally ref, within one lane (check_name): the authoritative lane when it has any row, else the shadow lane. It is confirmed when the named metric is at least at_least and executed_case_count is at least min_cases, contradicted when either is missed, unknown when there is no row. Written by coord''s CI result door (POST /coord/ci/dispatches/{dispatch_id}/result) with attribution taken from the dispatch row, never from the request body.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.run_outcomes.id IS
            'Row id. Breaks a run_completed_at tie when picking the latest row.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.run_outcomes.tenant_id IS
            'Tenant whose dispatch produced the run, copied from coord.ci_dispatches.tenant_id. The resolver reads only the citing tenant''s rows.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.run_outcomes.source IS
            'The harness that measured, for example an evaluation CLI name. Never blank.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.run_outcomes.subject IS
            'The thing measured, for example a system variant. Never blank.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.run_outcomes.task IS
            'The evaluation set or task. Never blank.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.run_outcomes.ref IS
            'Git sha the run executed against, copied from the dispatch row''s head_sha. An anchor naming a ref matches it exactly. NULL when the dispatch carried none.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.run_outcomes.repo IS
            'Repository of the dispatch that produced the run, copied from the dispatch row. Provenance only; not part of the lookup key.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.run_outcomes.dispatch_id IS
            'coord.ci_dispatches row that carried the result POST. Deliberately not a foreign key: an outcome outlives the dispatch ledger. At most one row per (dispatch_id, source, subject, task).'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.run_outcomes.metrics IS
            'JSON object of metric name to finite number, validated by coord before writing. The name executed_cases is reserved: an anchor naming it reads executed_case_count instead.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.run_outcomes.executed_case_count IS
            'How many evaluation cases the run actually executed. A run that executed fewer than an anchor''s min_cases contradicts it, whatever its metrics say.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.run_outcomes.run_completed_at IS
            'When the run completed: the dispatch row''s completed_at. The ordering key for the latest-run lookup, so a late or retried write can never become the latest.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.run_outcomes.check_name IS
            'Dispatch lane the run was recorded from, copied from coord.ci_dispatches.check_name: qontinui-ci-node (authoritative) or qontinui-ci-node/shadow. The resolver prefers authoritative rows and reads shadow rows only when no authoritative row exists; the lanes never interleave into one latest.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.run_outcomes.recorded_at IS
            'When coord recorded the outcome. Provenance only; never the ordering key.'
        """
    )


def downgrade() -> None:
    """Drop coord.run_outcomes; its indexes, constraints and comments go with it."""
    op.execute("DROP TABLE IF EXISTS coord.run_outcomes")
