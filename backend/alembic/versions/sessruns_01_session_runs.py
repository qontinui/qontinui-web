"""coord.session_runs + coord.session_run_hourly — the durable session run record

Revision ID: sessruns_01_session_runs
Revises: merge_lane_ledger_01
Create Date: 2026-10-26

Phase 2 of plan
``2026-10-23-session-duration-by-work-type-and-per-device-session-load``
(decisions D1 durable run record, D4 three named durations, D5 concurrency
from intervals).

coord authors **zero** DDL (``[policy: alembic-sole-authorship]``), so both
tables land here, in qontinui-web, and must be DEPLOYED before coord ingest,
classifier, backstop and reads (that plan Phase 3) touch them.

The re-point rule
=================

``down_revision`` is this repo single alembic head at authoring time and is
deliberately NOT pinned to it: ``alembic-graph-pr.yml`` serialises alembic PRs,
so a revision that lands ahead of this one re-forks the chain and this line is
re-pointed at the new head. Re-point it; do NOT author an ``alembic merge``
revision and do NOT order it with coord dependency labels.

The gap
=======

``coord.sessions`` is PRESENCE: a row is revived and reaped, one row spans
several runs (shell + claude + placeholder), and it is pruned after 7 days. It
cannot say how long a session of a given kind of work held a slot, nor how
many sessions a machine carried a month ago. ``coord.session_runs`` is the RUN
record: one row per open-to-close interval of one runner lifecycle-store
record, keyed ``(tenant_id, claude_code_session_id, run_seq)``, emitted by the
runner at open and at close, kept 400 days. A record re-opened after a close
(boot resume, handoff adoption) keeps its ``claude_code_session_id`` and gets
``run_seq + 1`` so wall time is never double-counted.

``coord.session_run_hourly`` is the leader-gated hourly rollup (Phase 3) for
windows longer than the 31 days the read computes on demand from the raw
intervals. Also kept 400 days. Retention is enforced by coord, not here.

Column contract — shared with coord Rust code (Phase 3)
=======================================================

``coord.session_runs``

``id UUID PRIMARY KEY DEFAULT gen_random_uuid()``
``tenant_id UUID NOT NULL`` / ``device_id UUID NOT NULL``
    No FK on either, as for every coord ledger: a 400-day record must outlive
    device deletion, and a ledger write must never fail on referential
    bookkeeping.
``claude_code_session_id UUID NOT NULL`` / ``run_seq INTEGER NOT NULL DEFAULT 1``
    CHECK ``run_seq >= 1``. ``UNIQUE (tenant_id, claude_code_session_id,
    run_seq)`` (``uq_session_runs_session_run``) is the ingest upsert key.
``coord_session_id`` / ``spawn_request_id`` / ``gate_id`` / ``agent_id`` UUID NULL
    Joins, none a FK. ``spawn_request_id`` names a ``coord.spawn_requests``
    row when the runner holds it; the session id join to that ledger is
    ``spawn_requests.claude_code_session_id = session_runs.claude_code_session_id::text``.

Facts, all TEXT NULL and all UNCONSTRAINED: ``spawn_origin``, ``spawn_kind``,
``dispatch_source``, ``diagnosis_kind``, ``gate_registered_by``, ``skill``,
``first_command``, ``bind_origin``, ``close_reason``, ``account_label``,
``provider``, ``model``, ``repo``, ``work_unit_slug``. Their vocabularies live
in Rust (coord validates against the schemas contract), so growing one is not
an alembic round-trip and the classifier can re-classify old rows.

Verdict: ``initiator TEXT NOT NULL DEFAULT unknown`` — CHECK ``operator`` |
``coord`` | ``runner_local`` | ``unknown``; ``work_type TEXT NOT NULL DEFAULT
unknown`` — NO CHECK (D2: re-classifiable, vocabulary in Rust);
``classifier_version INTEGER NOT NULL DEFAULT 0`` (0 = never classified).

Timing (runner clock): ``started_at`` NOT NULL, ``first_turn_at``,
``finished_at`` (stamped by coord in the ``session_status`` transition, D4),
``ended_at``, ``last_seen_at``, ``active_seconds`` (CHECK ``>= 0``),
``clock_skew_seconds`` (signed, coord receive time minus runner time).

``end_reason TEXT NULL`` — CHECK NULL or ``exited`` | ``poll_dead`` |
``superseded`` | ``operator_closed`` | ``finished_close`` | ``runner_stopped`` |
``handoff_detached`` | ``inferred_lost`` | ``other``.
``end_source TEXT NULL`` — CHECK NULL or ``observed`` | ``inferred``.
``ck_session_runs_end_consistent``: ``ended_at`` and ``end_reason`` are NULL
together or set together. ``ck_session_runs_ended_after_start``: a run never
ends before it starts.

``history_complete BOOLEAN NOT NULL DEFAULT true`` — false for rows backfilled
from before the record existed (Phase 6).
``created_at`` / ``updated_at`` TIMESTAMPTZ NOT NULL DEFAULT now().

``coord.session_run_hourly``

``(tenant_id, device_id, work_type, hour)`` is the PRIMARY KEY. Counters
``runs_started``, ``peak_concurrent``, ``p95_concurrent`` INTEGER and
``slot_seconds`` BIGINT, each NOT NULL DEFAULT 0 and CHECK ``>= 0``;
``computed_at TIMESTAMPTZ NOT NULL DEFAULT now()``.

Indexes
=======

* ``uq_session_runs_session_run`` — the unique constraint index, the upsert key.
* ``ix_session_runs_tenant_started`` on ``(tenant_id, started_at DESC)`` — the
  list read and the stats window.
* ``ix_session_runs_device_started`` on ``(tenant_id, device_id, started_at)``
  — the per-device concurrency grid (D5).
* ``ix_session_runs_work_type_started`` on ``(tenant_id, work_type,
  started_at)`` — the by-work-type duration stats.
* partial ``ix_session_runs_open`` on ``(tenant_id, device_id) WHERE ended_at
  IS NULL`` — open runs per device, and the backstop scan (D6).
* ``ix_session_run_hourly_tenant_hour`` on ``(tenant_id, hour)`` — the
  fleet-wide long-window read and the retention sweep, which the primary key
  (device before hour) cannot serve.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "sessruns_01_session_runs"
down_revision: str | Sequence[str] | None = "merge_lane_ledger_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Every SQL string below is a STATIC literal. The coord merge-train migration
# classifier extracts string literals from each execute call and rejects a call
# with none as dynamic. Keep these comments free of apostrophes and of the
# op-dot-call spelling: the classifier lexer does not skip Python comments.
# Raw SQL with IF NOT EXISTS throughout, the sibling coord ledger convention,
# which keeps a re-run harmless.


def upgrade() -> None:
    """Create both tables, their indexes, and document them. No rows."""
    op.execute("CREATE SCHEMA IF NOT EXISTS coord")
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.session_runs (
            id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id               UUID NOT NULL,
            device_id               UUID NOT NULL,
            claude_code_session_id  UUID NOT NULL,
            run_seq                 INTEGER NOT NULL DEFAULT 1,
            coord_session_id        UUID NULL,
            spawn_request_id        UUID NULL,
            gate_id                 UUID NULL,
            agent_id                UUID NULL,
            spawn_origin            TEXT NULL,
            spawn_kind              TEXT NULL,
            dispatch_source         TEXT NULL,
            diagnosis_kind          TEXT NULL,
            gate_registered_by      TEXT NULL,
            skill                   TEXT NULL,
            first_command           TEXT NULL,
            bind_origin             TEXT NULL,
            close_reason            TEXT NULL,
            account_label           TEXT NULL,
            provider                TEXT NULL,
            model                   TEXT NULL,
            repo                    TEXT NULL,
            work_unit_slug          TEXT NULL,
            initiator               TEXT NOT NULL DEFAULT 'unknown',
            work_type               TEXT NOT NULL DEFAULT 'unknown',
            classifier_version      INTEGER NOT NULL DEFAULT 0,
            started_at              TIMESTAMPTZ NOT NULL,
            first_turn_at           TIMESTAMPTZ NULL,
            finished_at             TIMESTAMPTZ NULL,
            ended_at                TIMESTAMPTZ NULL,
            last_seen_at            TIMESTAMPTZ NULL,
            active_seconds          INTEGER NULL,
            clock_skew_seconds      INTEGER NULL,
            end_reason              TEXT NULL,
            end_source              TEXT NULL,
            history_complete        BOOLEAN NOT NULL DEFAULT true,
            created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT uq_session_runs_session_run
                UNIQUE (tenant_id, claude_code_session_id, run_seq),
            CONSTRAINT ck_session_runs_run_seq_positive CHECK (run_seq >= 1),
            CONSTRAINT ck_session_runs_active_seconds_nonneg
                CHECK (active_seconds >= 0),
            CONSTRAINT ck_session_runs_initiator
                CHECK (initiator IN ('operator', 'coord', 'runner_local', 'unknown')),
            CONSTRAINT ck_session_runs_end_reason
                CHECK (end_reason IS NULL OR end_reason IN (
                    'exited', 'poll_dead', 'superseded', 'operator_closed',
                    'finished_close', 'runner_stopped', 'handoff_detached',
                    'inferred_lost', 'other'
                )),
            CONSTRAINT ck_session_runs_end_source
                CHECK (end_source IS NULL OR end_source IN ('observed', 'inferred')),
            CONSTRAINT ck_session_runs_end_consistent
                CHECK ((ended_at IS NULL) = (end_reason IS NULL)),
            CONSTRAINT ck_session_runs_ended_after_start
                CHECK (ended_at IS NULL OR ended_at >= started_at)
        )
        """
    )
    # The list read and the stats window, newest first.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_session_runs_tenant_started
            ON coord.session_runs (tenant_id, started_at DESC)
        """
    )
    # The per-device concurrency grid.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_session_runs_device_started
            ON coord.session_runs (tenant_id, device_id, started_at)
        """
    )
    # The by-work-type duration stats.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_session_runs_work_type_started
            ON coord.session_runs (tenant_id, work_type, started_at)
        """
    )
    # Open runs per device, and the backstop scan.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_session_runs_open
            ON coord.session_runs (tenant_id, device_id)
            WHERE ended_at IS NULL
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.session_run_hourly (
            tenant_id        UUID NOT NULL,
            device_id        UUID NOT NULL,
            work_type        TEXT NOT NULL,
            hour             TIMESTAMPTZ NOT NULL,
            runs_started     INTEGER NOT NULL DEFAULT 0,
            slot_seconds     BIGINT NOT NULL DEFAULT 0,
            peak_concurrent  INTEGER NOT NULL DEFAULT 0,
            p95_concurrent   INTEGER NOT NULL DEFAULT 0,
            computed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT session_run_hourly_pkey
                PRIMARY KEY (tenant_id, device_id, work_type, hour),
            CONSTRAINT ck_session_run_hourly_runs_started_nonneg
                CHECK (runs_started >= 0),
            CONSTRAINT ck_session_run_hourly_slot_seconds_nonneg
                CHECK (slot_seconds >= 0),
            CONSTRAINT ck_session_run_hourly_peak_concurrent_nonneg
                CHECK (peak_concurrent >= 0),
            CONSTRAINT ck_session_run_hourly_p95_concurrent_nonneg
                CHECK (p95_concurrent >= 0)
        )
        """
    )
    # The fleet-wide long-window read and the retention sweep.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_session_run_hourly_tenant_hour
            ON coord.session_run_hourly (tenant_id, hour)
        """
    )
    # Document both tables. Each statement is a complete static literal.
    op.execute(
        """
        COMMENT ON TABLE coord.session_runs IS
            'The durable session RUN record: one row per open-to-close interval of one runner lifecycle-store record (one Claude session run), keyed (tenant_id, claude_code_session_id, run_seq), emitted by the runner at open and close, kept 400 days by coord. Distinct from coord.sessions, which is presence (revived, reaped, pruned after 7 days) and cannot answer how long a run held a slot. Plan 2026-10-23-session-duration-by-work-type-and-per-device-session-load (D1).'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.session_runs.device_id IS
            'The device the run held a slot on. Deliberately not a foreign key: a 400-day ledger must outlive device deletion.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.session_runs.run_seq IS
            'Run ordinal within one claude_code_session_id, starting at 1. A record re-opened after a close (boot resume, handoff adoption) keeps the session id and takes the next run_seq, so wall time is never double-counted and a resume is visible.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.session_runs.bind_origin IS
            'The lifecycle-store record origin (authoritative or reconciled). Stats count reconciled runs separately, since a reconciled id may name a foreign session.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.session_runs.initiator IS
            'Who initiated the run: operator, coord, runner_local, or unknown. unknown is a real answer, never a default to read as operator.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.session_runs.work_type IS
            'What work the run does, as classified by coord. No CHECK: the vocabulary lives in Rust and a re-classification rewrites this column. unknown = not classifiable from the recorded facts.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.session_runs.classifier_version IS
            'Version of the coord classifier that wrote initiator and work_type. 0 = never classified.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.session_runs.started_at IS
            'Run open, on the runner clock. wall_seconds = ended_at minus started_at.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.session_runs.finished_at IS
            'When the session declared its work finished, stamped by coord in the session_status transition and cleared by an undo. held_after_finish_seconds = ended_at minus finished_at.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.session_runs.ended_at IS
            'Run close, on the runner clock. NULL = the run is open (or its end is not yet observed or inferred). Set together with end_reason.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.session_runs.active_seconds IS
            'Sum of turn time within the run, which separates work from waiting. NULL = not reported, never zero.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.session_runs.clock_skew_seconds IS
            'Coord receive time minus runner clock at ingest, signed. NULL = not measured.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.session_runs.end_reason IS
            'Why the run ended, mapped from the runner close_reason (raw value kept in close_reason). other = an unmapped close reason. inferred_lost = the coord backstop closed it.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.session_runs.end_source IS
            'observed = the runner reported the end; inferred = the coord backstop inferred it. Duration percentiles exclude inferred rows by default.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.session_runs.history_complete IS
            'false for rows backfilled from before this record existed, whose facts are partial.'
        """
    )
    op.execute(
        """
        COMMENT ON TABLE coord.session_run_hourly IS
            'Hourly rollup of coord.session_runs per (tenant, device, work_type, UTC hour), written by a leader-gated coord worker for windows longer than 31 days and kept 400 days. Windows up to 31 days are computed on read from the raw intervals. Plan 2026-10-23-session-duration-by-work-type-and-per-device-session-load (D5).'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.session_run_hourly.slot_seconds IS
            'Seconds of the hour during which runs of this work_type held a slot on this device, summed over runs.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.session_run_hourly.peak_concurrent IS
            'Most runs of this work_type open at once on this device within the hour.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.session_run_hourly.p95_concurrent IS
            'p95 over the one-minute grid of the hour of runs of this work_type open at once on this device.'
        """
    )


def downgrade() -> None:
    """Drop both tables and their indexes."""
    op.execute("DROP INDEX IF EXISTS coord.ix_session_run_hourly_tenant_hour")
    op.execute("DROP TABLE IF EXISTS coord.session_run_hourly")
    op.execute("DROP INDEX IF EXISTS coord.ix_session_runs_open")
    op.execute("DROP INDEX IF EXISTS coord.ix_session_runs_work_type_started")
    op.execute("DROP INDEX IF EXISTS coord.ix_session_runs_device_started")
    op.execute("DROP INDEX IF EXISTS coord.ix_session_runs_tenant_started")
    # DROP TABLE takes every constraint and the comments with it.
    op.execute("DROP TABLE IF EXISTS coord.session_runs")
