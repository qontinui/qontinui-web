"""coord.maintenance_agent_requests — the scheduled-maintenance agent queue

Phases 2 and 3 (the qontinui-web half, which lands FIRST) of plan
``2026-06-08-coord-scheduled-maintenance-subsystem``. Creates one new, empty
table, its comment, its verdict-dedupe unique, its pending-queue index and
its two foreign-key indexes in ONE transaction::

    coord.maintenance_agent_requests (id, tenant_id, kind, task_id, run_id,
        target_device_id, candidate_key, repo_path, question, prompt,
        min_confidence, state, claimed_by_device, claimed_at, verdict,
        confidence, rationale, result, error, requested_by, created_at,
        answered_at, expires_at)
        ux_maintenance_agent_requests_verdict_dedupe
            UNIQUE (task_id, md5(candidate_key), md5(question))
            WHERE kind = 'verdict'
        idx_maintenance_agent_requests_pending
            (target_device_id, tenant_id) WHERE state = 'pending'
        idx_maintenance_agent_requests_task_id  (task_id)
        idx_maintenance_agent_requests_run_id   (run_id)

One queue, two kinds
====================

Both later phases need the same thing from a runner: coord composes a prompt,
a runner of the right tenant (or the one named device) claims it, runs it
through its local agent verbatim, and posts back a structured answer. So ONE
table carries both, discriminated by ``kind``:

* ``kind = 'verdict'`` — Phase 2, the semantic predicate. The scheduler tick
  enqueues one request per (task, candidate, question) for a candidate that
  already passed the deterministic predicates and the safety floor.
  ``target_device_id`` is the candidate's device, ``candidate_key`` is
  ``<repo_path>|<branch>|<head_sha>`` (so a moved head is a NEW candidate and
  never reuses an old verdict), ``repo_path`` is the checkout the runner reads
  read-only. The answer lands in ``verdict`` / ``confidence`` / ``rationale``.
  A semantic predicate can only narrow: the safety floor still re-checks at
  emit.
* ``kind = 'compile'`` — Phase 3, natural-language task compile. The operator
  posts a description; ``question`` holds it, ``target_device_id`` is NULL (any
  device of the tenant may claim it), and the answer lands in ``result`` (the
  proposed task definition, which the operator approves by posting it to the
  task API) and ``rationale``.

``error`` records a runner that could not answer either kind.

Shape
=====

* ``kind`` is closed to ``verdict`` / ``compile``; ``state`` to ``pending`` /
  ``claimed`` / ``answered`` / ``failed`` / ``expired`` (default
  ``pending``); ``verdict`` to ``yes`` / ``no`` / ``unknown``; ``confidence``
  and ``min_confidence`` to ``[0, 1]`` (or NULL).
* ``ck_maintenance_agent_requests_verdict_fields``: a ``verdict`` request must
  carry ``task_id``, ``candidate_key``, ``target_device_id`` and
  ``repo_path`` (without them the dedupe unique cannot hold, since NULLs never
  collide, and no runner could be targeted). A ``compile`` request may leave
  all four NULL.
* ``tenant_id`` is ``uuid NOT NULL`` deliberately, while
  ``coord.maintenance_tasks.tenant_id`` is nullable text. That places a
  requirement on the companion coord change: it casts the task's text tenant
  to uuid and never enqueues for a task with a NULL or non-uuid tenant.
* ``ck_maintenance_agent_requests_state_fields`` keeps a row consistent with
  its state: ``claimed`` and ``answered`` carry ``claimed_by_device`` and
  ``claimed_at``; ``answered`` also carries ``answered_at`` and the answer
  field of its kind (``verdict`` for a verdict request, ``result`` for a
  compile request); ``failed`` carries ``error``. ``pending`` and ``expired``
  rows are unconstrained.
* ``task_id`` references ``coord.maintenance_tasks`` ON DELETE CASCADE: a
  deleted task takes ALL its requests with it, pending ones and its answered
  verdict history alike; ``run_id`` references
  ``coord.maintenance_runs`` ON DELETE SET NULL (the run ledger is history, a
  pruned run row must not delete an answered verdict). Both are nullable: a
  compile request has no task yet.
* The verdict dedupe keys on ``md5(candidate_key)`` and ``md5(question)``
  rather than the raw text, so a question or candidate key of any length fits
  the btree index row (a raw-text key fails past btree's 2704-byte row limit).
  It is PARTIAL and keyed on expressions, so a coord enqueue naming it as its
  arbiter must spell it exactly: ``ON CONFLICT (task_id, md5(candidate_key),
  md5(question)) WHERE kind = 'verdict'``.
* The pending index serves the claim read: pending rows for a device, or for
  no device within a tenant. It is partial, so answered history never bloats
  it. The two foreign-key indexes keep a task or run delete (CASCADE / SET
  NULL) from scanning the queue.

Indexes and lock posture
========================

All four indexes are built in the SAME transaction as the table — a plain
``CREATE [UNIQUE] INDEX IF NOT EXISTS``, never ``CONCURRENTLY`` — on a table
this transaction created, so the build is on an empty table and holds no lock
any reader waits on. coord's migration classifier admits each such build as a
new-table claim, which the merge engine discharges by proving this repo's trunk
has never named the table (``pr_merge::migration_new_table_proof``); the bare
table name appeared nowhere in this repo at authoring time.

The companion coord PR that reads and writes this table must land AFTER this
one, because alembic is the sole author of the ``coord.*`` schema and the
table must exist before its consumer deploys (served policy
``production-and-cost`` ``alembic-sole-authorship``).

The two foreign keys take ``SHARE ROW EXCLUSIVE`` on ``coord.maintenance_tasks``
and ``coord.maintenance_runs`` for the instant of the ``CREATE TABLE``. That
conflicts with the scheduler tick writing those tables, so the wait is bounded
with ``SET LOCAL lock_timeout = '3s'`` (as ``journey_03`` / ``journey_04`` do):
a busy writer fails the migration loudly instead of queueing the tick behind
it. No existing table is altered. ``downgrade()`` is bounded the same way.

Idempotency / authorship posture
================================

* ``CREATE TABLE IF NOT EXISTS`` / ``CREATE [UNIQUE] INDEX IF NOT EXISTS`` /
  re-runnable ``COMMENT ON``; a re-run (or a partial prior apply) is a no-op.
* ``downgrade()`` drops the four indexes, then the table, all ``IF EXISTS``.
  It drops no table this revision did not create.
* alembic is the SOLE author of the ``coord.*`` schema (served policy
  ``production-and-cost`` ``alembic-sole-authorship``). coord only INSERTs,
  UPDATEs and SELECTs this table.
* Privileges for the ``coord_tenant`` roles come from ``coordrls_01``'s
  ``ALTER DEFAULT PRIVILEGES``. No backfill: this revision writes no rows.
* Every SQL string is a static literal inline at its call, with no ``:word``
  sequence and no ``%``.

Chaining
========

``down_revision`` is this repo's single alembic head at authoring time and is
deliberately NOT pinned: ``alembic-graph-pr.yml`` serialises alembic PRs, so a
revision that lands ahead of this one re-forks the chain and this line is
re-pointed at the new head. A re-point is three coupled edits:
``down_revision``, the ``Revises:`` line below, and ``_PARENT_REVISION_ID`` in
``tests/test_coord_maint_agent_req_01_migration.py``. Never author an
``alembic merge`` revision for it.

Revision ID: coord_maint_agent_req_01
Revises: coord_policy_outcome_counts_02
Create Date: 2026-11-21

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_maint_agent_req_01"
down_revision: str | None = "coord_policy_outcome_counts_02"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Every SQL string below is a STATIC literal. The coord merge-train migration
# classifier extracts string literals from each execute call and rejects a call
# with none as dynamic.


def upgrade() -> None:
    """Create the table, its comment, the dedupe unique and the queue index."""
    # The two foreign keys lock the existing task and run tables briefly.
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.maintenance_agent_requests (
            id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id         uuid        NOT NULL,
            kind              text        NOT NULL,
            task_id           uuid        NULL,
            run_id            uuid        NULL,
            target_device_id  uuid        NULL,
            candidate_key     text        NULL,
            repo_path         text        NULL,
            question          text        NOT NULL,
            prompt            text        NOT NULL,
            min_confidence    real        NULL,
            state             text        NOT NULL DEFAULT 'pending',
            claimed_by_device uuid        NULL,
            claimed_at        timestamptz NULL,
            verdict           text        NULL,
            confidence        real        NULL,
            rationale         text        NULL,
            result            jsonb       NULL,
            error             text        NULL,
            requested_by      text        NOT NULL,
            created_at        timestamptz NOT NULL DEFAULT now(),
            answered_at       timestamptz NULL,
            expires_at        timestamptz NOT NULL,
            CONSTRAINT ck_maintenance_agent_requests_kind
                CHECK (kind IN ('verdict', 'compile')),
            CONSTRAINT ck_maintenance_agent_requests_state
                CHECK (state IN ('pending', 'claimed', 'answered', 'failed', 'expired')),
            CONSTRAINT ck_maintenance_agent_requests_verdict
                CHECK (verdict IN ('yes', 'no', 'unknown')),
            CONSTRAINT ck_maintenance_agent_requests_confidence
                CHECK (confidence IS NULL
                       OR (confidence >= 0 AND confidence <= 1)),
            CONSTRAINT ck_maintenance_agent_requests_min_confidence
                CHECK (min_confidence IS NULL
                       OR (min_confidence >= 0 AND min_confidence <= 1)),
            CONSTRAINT ck_maintenance_agent_requests_verdict_fields
                CHECK (kind <> 'verdict'
                       OR (task_id IS NOT NULL
                           AND candidate_key IS NOT NULL
                           AND target_device_id IS NOT NULL
                           AND repo_path IS NOT NULL)),
            CONSTRAINT ck_maintenance_agent_requests_state_fields
                CHECK ((state NOT IN ('claimed', 'answered')
                        OR (claimed_by_device IS NOT NULL
                            AND claimed_at IS NOT NULL))
                       AND (state <> 'answered'
                            OR (answered_at IS NOT NULL
                                AND ((kind = 'verdict' AND verdict IS NOT NULL)
                                     OR (kind = 'compile'
                                         AND result IS NOT NULL))))
                       AND (state <> 'failed' OR error IS NOT NULL)),
            CONSTRAINT fk_maintenance_agent_requests_task
                FOREIGN KEY (task_id) REFERENCES coord.maintenance_tasks (id)
                ON DELETE CASCADE,
            CONSTRAINT fk_maintenance_agent_requests_run
                FOREIGN KEY (run_id) REFERENCES coord.maintenance_runs (id)
                ON DELETE SET NULL
        )
        """
    )
    op.execute(
        """
        COMMENT ON TABLE coord.maintenance_agent_requests IS
            'Scheduled-maintenance agent queue (plan '
            '2026-06-08-coord-scheduled-maintenance-subsystem Phases 2-3). '
            'kind=verdict: a semantic-predicate question about one candidate; '
            'kind=compile: a natural-language task description to compile into '
            'a proposed task definition. coord composes prompt, a runner claims '
            'the row and runs it verbatim, and posts the answer back.'
        """
    )
    # One verdict request per task, candidate and question. Keyed on md5 of the
    # two text columns so any length fits the btree row. Partial and keyed on
    # expressions, so an upsert arbiter must restate both the md5 expressions
    # and WHERE kind = verdict.
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS ux_maintenance_agent_requests_verdict_dedupe
            ON coord.maintenance_agent_requests
                (task_id, md5(candidate_key), md5(question))
            WHERE kind = 'verdict'
        """
    )
    # The claim read: pending requests for a device, or for no device.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_maintenance_agent_requests_pending
            ON coord.maintenance_agent_requests (target_device_id, tenant_id)
            WHERE state = 'pending'
        """
    )
    # The foreign-key columns, so a task or run delete does not scan the queue.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_maintenance_agent_requests_task_id
            ON coord.maintenance_agent_requests (task_id)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_maintenance_agent_requests_run_id
            ON coord.maintenance_agent_requests (run_id)
        """
    )
    op.execute("SET LOCAL lock_timeout = DEFAULT")


def downgrade() -> None:
    """Drop the four indexes, then the table."""
    # Dropping the table locks the task and run tables through its foreign keys.
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute("DROP INDEX IF EXISTS coord.idx_maintenance_agent_requests_run_id")
    op.execute("DROP INDEX IF EXISTS coord.idx_maintenance_agent_requests_task_id")
    op.execute("DROP INDEX IF EXISTS coord.idx_maintenance_agent_requests_pending")
    op.execute(
        "DROP INDEX IF EXISTS coord.ux_maintenance_agent_requests_verdict_dedupe"
    )
    op.execute("DROP TABLE IF EXISTS coord.maintenance_agent_requests")
    op.execute("SET LOCAL lock_timeout = DEFAULT")
