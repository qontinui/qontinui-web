"""coord.overlord_passes + coord.overlord_pass_rows — the session-flow pass ledger

Revision ID: overlord_03_passes
Revises: journey_03_explorations_stop_unsettled
Create Date: 2026-10-24

Phase 1 of plan
``2026-10-23-the-overlord-keeps-no-record-of-session-flow-so-its-development-runs-on-anecdote``.

coord authors **zero** DDL (``[policy: alembic-sole-authorship]``), so both
tables land here, in qontinui-web.

Ordering
========

This revision must be APPLIED (merged and migrated) before the coord PR whose
``POST /coord/overlord/passes``, ``GET /coord/overlord/passes[/{pass_id}]`` and
``GET /coord/overlord/flow`` routes read and write these tables merges. Until it
is applied, coord answers those routes with a typed ``schema_migration_pending``
503 (its readiness map, plus ``42P01`` / ``42703`` at query time) rather than a
500. The coord PR's ``schema.manifest`` bump to this revision is gated on this
revision being the migrator head.

The re-point rule
=================

``down_revision`` is this repo's LOCAL single alembic head at authoring time,
and is deliberately NOT pinned to it: ``alembic-graph-pr.yml`` serialises
alembic PRs by construction, so every revision that lands ahead of this one
re-forks the chain and this line is re-pointed at the new head. Re-point it; do
NOT author an ``alembic merge`` revision (this revision has not landed, so
re-pointing leaves nothing behind, while a merge revision is permanent
bookkeeping), and do NOT hand-order it with coord dependency labels — the graph
gate owns this ordering, not coord.

The gap
=======

The overlord's triage loop (``/triage-sessions`` and the close, nudge, limit,
name and layout steps it drives) screens every runner terminal, assigns each a
verdict and sometimes acts on it. None of that is kept: each pass prints a
report and forgets it. So the questions its own development turns on — how long
does a stopped session take to close, does a nudge produce progress, which
sessions sit unchanged pass after pass, how much of a pass is UNKNOWN, and did
any of that move when a script changed — are answered from anecdote.

``coord.overlord_interventions`` does not answer them either. It records one
JUDGMENT per stop (the ``/next-move`` classifier); it has no row for a terminal
the triage screen looked at and left alone, and no notion of a pass, so a
session's absence from a later pass — the most common way a session ends — is
unrepresentable there. These two tables are the per-pass record: one row per
pass, one row per terminal screened in it.

``coord.overlord_passes`` — one row per ``/triage-sessions`` run
================================================================

``pass_id UUID PRIMARY KEY``
    Minted by the CLIENT (triage) before it writes, and the idempotency key: a
    replay of the same ``pass_id`` in the same tenant writes nothing and coord
    answers with the stored pass; the same ``pass_id`` under another tenant is a
    409 that names nothing about that tenant. No ``DEFAULT``: a server-minted id
    could not make a retry idempotent.

``tenant_id UUID NOT NULL``
    From the caller's verified JWT, never the request body. No FK to
    ``coord.tenants``, matching ``coord.overlord_interventions``: an observation
    log must never fail an insert for referential bookkeeping.

``device_id UUID NULL``
    The device the writing JWT names. From the JWT, never the body; NULL for a
    non-device token. With ``runner_port`` it identifies the RUNNER a pass
    screened, which is the scope every flow metric is computed in.

``runner_port INTEGER NOT NULL`` — CHECK ``1..65535``
    The runner the pass screened (``9876`` for a primary, a temp runner's port
    otherwise).

``runner_build TEXT NULL``
    The runner's ``gitSha`` from ``/health`` as the pass ran. NULL means "not
    read", never "no build".

``scope TEXT NOT NULL`` — CHECK ``full`` | ``filtered``
    ``--only`` / ``--tab`` make a pass ``filtered``. Only a ``full`` pass may
    count a session's ABSENCE as its close, because a filtered pass leaves
    sessions out by construction.

``filter JSONB NOT NULL DEFAULT '{}'``
    The filter as given, ``{"only": [...], "tab": [...]}``; ``{}`` on a full pass.

``mode TEXT NOT NULL`` — CHECK ``report`` | ``act``
    Whether the pass was allowed to act (``--act``) or only reported.

``skipped_steps TEXT[] NOT NULL DEFAULT '{}'`` — CHECK each item ``^[a-z][a-z_]*$``
    The triage steps the pass did not run (``layout``, ``name``, ...). The
    item format is checked, not the vocabulary: the step set is the triage
    script's to grow. The CHECK is exact per item — it refuses a NULL item, an
    empty item and an item carrying the ``,`` delimiter, not only a joined
    string that fails the pattern.

``started_at TIMESTAMPTZ NOT NULL`` / ``ended_at TIMESTAMPTZ NULL``
    Caller-supplied: when the pass ran, not when coord heard about it. CHECK
    ``ended_at IS NULL OR ended_at >= started_at``; NULL ``ended_at`` means the
    end was not recorded.

``recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()``
    When coord wrote the row. Server-stamped.

``exit_code SMALLINT NULL``
    The triage run's exit code. NULL means "unknown at write time", never 0.

``step_counts JSONB NOT NULL DEFAULT '{}'``
    Per step, ``{"close": {"candidates": n, "acted": n, "failed": n}, ...}``. A
    free-form object coord size-bounds; it summarises, the rows are the record.

``verdict_histogram JSONB NOT NULL DEFAULT '{}'``
    ``{"STOPPED": 3, "BUSY": 9, ...}`` as the pass computed it — the per-pass
    series the flow route serves without re-reading every row.

``overlord_versions JSONB NOT NULL DEFAULT '{}'``
    The git blob sha of each overlord script and brief the pass ran
    (``triage-sessions.py``, ``nudge-stopped-sessions.py``,
    ``close-finished-sessions.py``, ``runner-layout.py``, ``next-move.md``) and
    ``runner_git_sha`` — what ``group_by=overlord_version`` groups on, so a
    metric can be compared before and after a script change.

``row_count INTEGER NOT NULL`` — CHECK ``>= 0``
    The number of ``coord.overlord_pass_rows`` written with this pass, in the
    same transaction. The triage read-back compares it to what it sent; the
    retention rule below deletes rows and keeps this count, so after pruning it
    records what the pass screened, not what is still stored.

``coord.overlord_pass_rows`` — one row per terminal per pass
============================================================

``pass_id UUID NOT NULL``
    The pass the row belongs to. ``FOREIGN KEY (pass_id, tenant_id) REFERENCES
    coord.overlord_passes (pass_id, tenant_id) ON DELETE CASCADE``: rows never
    outlive their pass, and a row can only carry its own pass's tenant.

``terminal_id TEXT NOT NULL``
    The runner terminal id. ``PRIMARY KEY (pass_id, terminal_id)``: a pass
    screens a terminal once, and the triage merge that folds several steps'
    rows for one terminal into one row is what makes that true.

``tenant_id UUID NOT NULL``
    The same tenant as the pass, copied by coord in the same INSERT
    transaction, and ENFORCED here by the composite foreign key above (target:
    ``uq_overlord_passes_pass_tenant``), so a coord bug can never file a row
    under another tenant. Denormalised so every read can be tenant-first without
    a join.

``observed_at TIMESTAMPTZ NOT NULL``
    When this terminal was screened. Triage defaults it to the pass's
    ``started_at``. The retention rule ages rows by it.

``claude_session_id UUID NULL``
    The Claude Code session in the terminal. **NULL means "not proven", never
    "no session"** — the same reading as
    ``coord.overlord_interventions.claude_code_session_id``. The flow route's
    session key falls back to ``terminal:<terminal_id>`` when it is NULL.

``session_name TEXT NULL`` / ``tab TEXT NULL`` / ``account TEXT NULL``
    The tab or session title as shown, the Terminal-page tab, and the Claude
    account the session runs under. Display and grouping only; NULL = not read.

``screen_verdict TEXT NULL`` — CHECK ``^[A-Z][A-Z-]*$`` when present
    The raw screen verdict, before the nudge judge refines it. NULL when the
    row came from a step with no screen of its own.

``verdict TEXT NOT NULL`` — CHECK ``^[A-Z][A-Z-]*$``
    The verdict the pass settled on (``STOPPED``, ``BUSY``, ``FINISHED``,
    ``EXITED-FINISHED``, ``LIMITED``, ``HELD``, ``STUCK``, ``CONTRADICTED``,
    ``UNKNOWN``, ``ACTIVE``, ``REVIVED``, ``FOOTER-FINISHED``, ...).

``reason_codes TEXT[] NOT NULL DEFAULT '{}'`` — CHECK each item ``^[a-z][a-z0-9_.]*$``
    Why: ``<family>.<snake>`` codes (``stopped.progress_since_nudge``,
    ``unknown.pid_absent``, ...) emitted at the verdict's return site, never
    parsed from prose. The CHECK is exact per item, like ``skipped_steps``.

``state_since_ms BIGINT NULL``
    Epoch milliseconds the session has been in this state since, when the
    screen knows it. NULL = not known.

``progress_since_nudge BOOLEAN NULL``
    Whether a work-class tool call followed the last nudge (the triage
    signal the nudge -> progress rate reads). **NULL means "not measured"**,
    which the flow route reports as ``unmeasured_progress``, never as
    ``false``.

``action TEXT NOT NULL DEFAULT 'none'`` — CHECK ``none`` | ``close`` |
``limit_handoff`` | ``name`` | ``nudge`` | ``layout``
    What the pass did to this terminal; when two steps acted on it, the LAST.

``action_outcome TEXT NULL`` — CHECK ``done`` | ``sent_unconfirmed`` |
``skipped`` | ``failed`` | ``unknown``
    How the action went. ``sent_unconfirmed`` is a nudge delivered with no
    observed effect yet. ``ck_overlord_pass_rows_outcome_iff_action`` pins
    ``(action = 'none') = (action_outcome IS NULL)``: a row that did nothing
    has no outcome, and a row that acted always says how it went.

``detail JSONB NOT NULL DEFAULT '{}'``
    Typed extras (``reset_at_ms``, ``pid``, ...). Never prose-only; size-bounded
    by coord.

Why ``verdict`` and ``reason_codes`` are format-checked, not vocabulary-checked
===============================================================================

``overlord_01_interventions``' own rule decides this: a vocabulary that is the
plan's normative taxonomy is CHECK-constrained, and one that grows from data is
left open. Here the closed sets are the plan's own — ``scope``, ``mode``,
``action`` and ``action_outcome`` — and they ARE constrained. ``verdict``,
``screen_verdict``, ``reason_codes`` and ``skipped_steps`` are the triage
scripts' words, and they grow with every triage-script PR (one adds ``STUCK``
and ``CONTRADICTED``, the close screen has ``ACTIVE``, ``REVIVED``,
``FOOTER-FINISHED``, ``FOOTER-ONLY``). A closed CHECK would make each of those
PRs a schema migration, and a value the CHECK lacked would fail the whole pass
write and lose the pass. So they carry a FORMAT CHECK only — enough to keep a
prose sentence or a lower-cased verdict out of a column every metric groups
on — and coord validates the same formats first, so a bad value is a 422 naming
the field rather than a constraint violation.

The per-item array CHECKs use no subquery (a CHECK cannot hold one): the array
is joined with ``,`` (a NULL item joined as the empty string, which the pattern
refuses), the joined string must match the item pattern repeated, and the
number of pieces it splits back into must equal the array's cardinality, which
is what refuses an item containing ``,``. An empty array passes.

Retention lives in coord
========================

Rows are aged out after 180 days by ``observed_at``; passes are kept, and
``row_count`` keeps saying what each pass screened. Alembic DDL cannot run a
retention rule, so the pruner is coord's (Phase 2 of the plan): a leader-only
supervised task deleting ``coord.overlord_pass_rows`` in bounded batches,
tolerant of this revision not being applied yet.

Indexes
=======

Every READ index is tenant-first, because every read is tenant-scoped. Two
indexes are not read paths and say so below: the pruner's ``observed_at`` index
and the composite-foreign-key target.

* ``uq_overlord_passes_pass_tenant (pass_id, tenant_id)`` — exists only as the
  unique target the rows table's ``(pass_id, tenant_id)`` foreign key needs; no
  read uses it. It is a second unique index beside the ``pass_id`` primary key,
  a small write cost that the tenant binding requires.

* ``ix_overlord_passes_tenant_started (tenant_id, started_at DESC)`` — the pass
  list and the flow window, newest first.
* ``ix_overlord_passes_tenant_runner (tenant_id, device_id, runner_port,
  started_at DESC)`` — one runner's passes, which is the scope every flow
  metric is computed in.
* ``ix_overlord_pass_rows_tenant_session (tenant_id, claude_session_id,
  observed_at)`` — one session's rows across passes.
* ``ix_overlord_pass_rows_observed (observed_at)`` — the one index that is NOT
  tenant-first, deliberately: coord's retention pruner deletes rows older than
  180 days across every tenant in bounded batches, and without it each batch
  would scan the whole table.
* No separate ``(pass_id)`` index on the rows: the primary key
  ``(pass_id, terminal_id)`` leads with ``pass_id``, so it already serves "every
  row of one pass" and the ``ON DELETE CASCADE`` lookup. A second index would
  only cost writes.
* ``ix_overlord_interventions_tenant_ccsession (tenant_id,
  claude_code_session_id)`` on ``coord.overlord_interventions`` — the flow
  route's join from a pass row's ``claude_session_id`` to the interventions
  that session received. That table's existing session index is
  ``(tenant_id, session_id)``, the coord session, which this join does not use.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "overlord_03_passes"
down_revision: str | Sequence[str] | None = "journey_03_explorations_stop_unsettled"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create both ledger tables, their indexes, and the interventions join index."""
    # Raw ``op.execute`` with IF NOT EXISTS throughout — the convention the
    # sibling coord observation tables use, and what keeps a re-run harmless.
    op.execute("CREATE SCHEMA IF NOT EXISTS coord")
    op.execute(
        r"""
        CREATE TABLE IF NOT EXISTS coord.overlord_passes (
            pass_id            UUID PRIMARY KEY,
            tenant_id          UUID NOT NULL,
            device_id          UUID NULL,
            runner_port        INTEGER NOT NULL,
            runner_build       TEXT NULL,
            scope              TEXT NOT NULL,
            filter             JSONB NOT NULL DEFAULT '{}'::jsonb,
            mode               TEXT NOT NULL,
            skipped_steps      TEXT[] NOT NULL DEFAULT '{}'::text[],
            started_at         TIMESTAMPTZ NOT NULL,
            ended_at           TIMESTAMPTZ NULL,
            recorded_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
            exit_code          SMALLINT NULL,
            step_counts        JSONB NOT NULL DEFAULT '{}'::jsonb,
            verdict_histogram  JSONB NOT NULL DEFAULT '{}'::jsonb,
            overlord_versions  JSONB NOT NULL DEFAULT '{}'::jsonb,
            row_count          INTEGER NOT NULL,
            -- The target of the rows table's (pass_id, tenant_id) foreign key.
            CONSTRAINT uq_overlord_passes_pass_tenant UNIQUE (pass_id, tenant_id),
            CONSTRAINT ck_overlord_passes_runner_port
                CHECK (runner_port BETWEEN 1 AND 65535),
            CONSTRAINT ck_overlord_passes_scope
                CHECK (scope IN ('full', 'filtered')),
            CONSTRAINT ck_overlord_passes_mode
                CHECK (mode IN ('report', 'act')),
            CONSTRAINT ck_overlord_passes_skipped_steps
                CHECK (cardinality(skipped_steps) = 0
                       OR (array_ndims(skipped_steps) = 1
                           AND array_to_string(skipped_steps, ',', '')
                               ~ '^[a-z][a-z_]*(,[a-z][a-z_]*)*$'
                           AND cardinality(regexp_split_to_array(
                                   array_to_string(skipped_steps, ',', ''), ','))
                               = cardinality(skipped_steps))),
            CONSTRAINT ck_overlord_passes_ended_after_started
                CHECK (ended_at IS NULL OR ended_at >= started_at),
            CONSTRAINT ck_overlord_passes_row_count
                CHECK (row_count >= 0)
        )
        """
    )
    # The pass list and the flow window, newest first.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_overlord_passes_tenant_started
            ON coord.overlord_passes (tenant_id, started_at DESC)
        """
    )
    # One runner's passes — the scope every flow metric is computed in.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_overlord_passes_tenant_runner
            ON coord.overlord_passes
               (tenant_id, device_id, runner_port, started_at DESC)
        """
    )

    op.execute(
        r"""
        CREATE TABLE IF NOT EXISTS coord.overlord_pass_rows (
            pass_id               UUID NOT NULL,
            terminal_id           TEXT NOT NULL,
            tenant_id             UUID NOT NULL,
            observed_at           TIMESTAMPTZ NOT NULL,
            claude_session_id     UUID NULL,
            session_name          TEXT NULL,
            tab                   TEXT NULL,
            account               TEXT NULL,
            screen_verdict        TEXT NULL,
            verdict               TEXT NOT NULL,
            reason_codes          TEXT[] NOT NULL DEFAULT '{}'::text[],
            state_since_ms        BIGINT NULL,
            progress_since_nudge  BOOLEAN NULL,
            action                TEXT NOT NULL DEFAULT 'none',
            action_outcome        TEXT NULL,
            detail                JSONB NOT NULL DEFAULT '{}'::jsonb,
            CONSTRAINT pk_overlord_pass_rows PRIMARY KEY (pass_id, terminal_id),
            -- The row's tenant is its pass's tenant, enforced by the schema
            -- rather than only by coord's write boundary.
            CONSTRAINT fk_overlord_pass_rows_pass
                FOREIGN KEY (pass_id, tenant_id)
                REFERENCES coord.overlord_passes (pass_id, tenant_id)
                ON DELETE CASCADE,
            CONSTRAINT ck_overlord_pass_rows_screen_verdict
                CHECK (screen_verdict IS NULL
                       OR screen_verdict ~ '^[A-Z][A-Z-]*$'),
            CONSTRAINT ck_overlord_pass_rows_verdict
                CHECK (verdict ~ '^[A-Z][A-Z-]*$'),
            CONSTRAINT ck_overlord_pass_rows_reason_codes
                CHECK (cardinality(reason_codes) = 0
                       OR (array_ndims(reason_codes) = 1
                           AND array_to_string(reason_codes, ',', '')
                               ~ '^[a-z][a-z0-9_.]*(,[a-z][a-z0-9_.]*)*$'
                           AND cardinality(regexp_split_to_array(
                                   array_to_string(reason_codes, ',', ''), ','))
                               = cardinality(reason_codes))),
            CONSTRAINT ck_overlord_pass_rows_action
                CHECK (action IN ('none', 'close', 'limit_handoff', 'name',
                                  'nudge', 'layout')),
            CONSTRAINT ck_overlord_pass_rows_action_outcome
                CHECK (action_outcome IS NULL
                       OR action_outcome IN ('done', 'sent_unconfirmed',
                                             'skipped', 'failed', 'unknown')),
            CONSTRAINT ck_overlord_pass_rows_outcome_iff_action
                CHECK ((action = 'none') = (action_outcome IS NULL))
        )
        """
    )
    # One session's rows across passes. A NULL session simply does not match,
    # which is correct — an unproven session answers for no session. No
    # separate (pass_id) index: the primary key already leads with it.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_overlord_pass_rows_tenant_session
            ON coord.overlord_pass_rows
               (tenant_id, claude_session_id, observed_at)
        """
    )

    # The retention pruner's cross-tenant age scan (see the docstring).
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_overlord_pass_rows_observed
            ON coord.overlord_pass_rows (observed_at)
        """
    )

    # The flow route's join from a pass row's Claude session to the
    # interventions that session received.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_overlord_interventions_tenant_ccsession
            ON coord.overlord_interventions (tenant_id, claude_code_session_id)
        """
    )


def downgrade() -> None:
    """Drop both ledger tables and the join index. Any recorded rows go with them."""
    op.execute("DROP INDEX IF EXISTS coord.ix_overlord_interventions_tenant_ccsession")
    op.execute("DROP INDEX IF EXISTS coord.ix_overlord_pass_rows_observed")
    op.execute("DROP INDEX IF EXISTS coord.ix_overlord_pass_rows_tenant_session")
    # DROP TABLE takes the primary key, the FK and every CHECK with it. The rows
    # table goes first: it references the passes table.
    op.execute("DROP TABLE IF EXISTS coord.overlord_pass_rows")
    op.execute("DROP INDEX IF EXISTS coord.ix_overlord_passes_tenant_runner")
    op.execute("DROP INDEX IF EXISTS coord.ix_overlord_passes_tenant_started")
    op.execute("DROP TABLE IF EXISTS coord.overlord_passes")
