"""coord.leader_worker_runs: the durable run log behind coord's leader-gated worker schedule

Revision ID: leader_worker_runs_01
Revises: plan_library_10_model_routes
Create Date: 2026-10-14

Phase 2 of plan
``2026-10-03-coord-table-retention-sweep-cannot-converge-under-restarts-and-its-batch-cap``
(revision 2026-10-14), which addresses claim ``r03-leader-jobs-survive-churn`` of
``domain_spec/coord-review-2026-10`` (architecture review recommendation R03).

## What it is for

coord runs about a hundred leader-gated background workers through one loop,
``qontinui-coord`` ``crates/coord/src/worker_ledger.rs``
``run_ticking_with_decision``. That loop builds a fresh tokio interval per
process, spends its immediate first tick before the replica holds the leader
lease, and nothing re-ticks it on promotion. With about twelve leader changes a
day, a worker whose interval is longer than a leader term almost never runs: on
2026-10-14 the three 6-hourly retention pruners and five daily workers all read
``no_leader_tick``, and retention ran 14 of 56 designed sweeps in 14 days.

The fix the plan designs for coord (its Phase 3, which is NOT on coord's
``main`` as this revision is written) will record each run of a worker whose
interval is at least 15 minutes in THIS table, and will run overdue work as
soon as a replica wins the lease instead of on a boot-anchored interval tick.
The last run then survives restarts, deploys and leader changes because it
lives here rather than in process memory. The table is also SQL-countable,
which is what the claim's probe needs (``sql_count retention_sweeps_24h >= 4``).

## The writer and the reader, as the plan designs them

Everything in this section is the plan's design for the coord side (decisions
D3 to D6), written ahead of the code. Only coord will touch this table, and
only for workers on the "durable" cadence.

* At body start coord INSERTs a row (``started_at`` defaults to the database
  clock) and keeps its ``id``. At body end it UPDATEs that row with
  ``finished_at = now()``, ``outcome`` and the codes. If the start INSERT
  failed, the body still runs and coord INSERTs the complete row at the end
  instead (D5).
* coord's graceful-shutdown tail closes this replica's unfinished rows with
  ``outcome = 'cancelled'`` before it yields the lease (D6). A ``cancelled``
  row is finished: it is not a run in flight, it is not a completed attempt,
  and it never counts toward the backoff for a body that keeps dying.
* A row whose ``finished_at`` is still NULL is a run in flight, or one that was
  cut off by a crash (a panic, an OOM kill, or a deploy whose shutdown could
  not record it). coord never counts an unfinished row as a completed run.
* On promotion, and on a few bounded re-checks, coord reads one worker's rows
  in ONE round trip that returns three things: the window read (the newest
  rows for the name, ``ORDER BY started_at DESC, id DESC LIMIT 8``), the
  newest scheduled attempt through its own ``LIMIT 1`` (``run_kind =
  'scheduled' AND finished_at IS NOT NULL AND outcome IN ('ok', 'idle',
  'error')``), and the database ``now()``. Every due-ness comparison then uses
  the database clock, so replica skew cannot misplace a run. The attempt read
  is separate so that a chain of continuation or cancelled rows longer than
  the window cannot hide the schedule's anchor.

## Columns

* ``id`` BIGINT identity PK: the row coord's start INSERT returns and its
  finish UPDATE targets. A single-column key, so coord's batched retention prune
  can page over it.
* ``name`` TEXT NOT NULL, never blank: the worker's stable ledger key
  (``WorkerSpec::name``, e.g. ``main.table_retention_pruner``).
* ``interval_secs`` INTEGER NOT NULL, positive: the worker's declared cadence
  when it ran. Provenance and analysis only; coord's schedule reads the cadence
  from the code, never from here.
* ``run_kind`` TEXT NOT NULL: ``scheduled`` (a run on the worker's cadence) or
  ``continuation`` (a follow-up run a capped body asked for). Free text, not a
  CHECKed enum, so a new kind needs no DDL.
* ``holder_id`` UUID NOT NULL: the replica that ran it, which IS its leader
  holder id: the same value as ``coord.leader_lease.holder_id`` and
  ``coord.replica_presence.replica_id`` (both UUID) and as
  ``coord.worker_heartbeats.replica_id``, which stores it as text
  (``holder_id::text`` joins it).
* ``fenced_token`` BIGINT NULL: the lease term the run started under. NULL when
  it could not be read.
* ``started_at`` TIMESTAMPTZ NOT NULL DEFAULT ``now()``: when the body started,
  on the database clock.
* ``finished_at`` TIMESTAMPTZ NULL: when the body returned. NULL = in flight or
  interrupted.
* ``outcome`` TEXT NULL: ``ok``, ``idle`` or ``error`` once a body returned
  (the worker ledger's outcome tokens for a returned body), or ``cancelled``
  when coord's graceful-shutdown tail closed a run it was about to kill.
  Present exactly when ``finished_at`` is. Free text for the same reason as
  ``run_kind``.
* ``decision_code`` / ``detail_code`` TEXT NULL: the body's low-cardinality
  decision and error codes, as the worker ledger records them.
* ``more_pending`` BOOLEAN NOT NULL DEFAULT false: the body reported work left
  over (for example a retention sweep that stopped at its batch cap).
* ``continuation`` TEXT NULL, at most 4096 characters: the opaque token coord
  hands back to the body on the continuation run (for the retention pruner, the
  sweeps that capped). Bounded so a runaway token cannot bloat the table.

## Constraints

* ``leader_worker_runs_name_nonblank_check``: ``length(btrim(name)) > 0``.
* ``leader_worker_runs_interval_positive_check``: ``interval_secs > 0``.
* ``leader_worker_runs_finished_after_started_check``: a finish never precedes
  its start.
* ``leader_worker_runs_outcome_iff_finished_check``: ``outcome`` is present
  exactly when ``finished_at`` is, so a reader can never meet a finished run
  with no outcome, or an outcome on a run still in flight.
* ``leader_worker_runs_continuation_length_check``: ``continuation`` is NULL or
  at most 4096 characters.

## Indexes

* ``idx_leader_worker_runs_name_started`` on ``(name, started_at DESC, id
  DESC)``: the window read (``WHERE name = $1 ORDER BY started_at DESC, id DESC
  LIMIT 8``) and the scheduled-attempt read (the same order, ``LIMIT 1``, with
  the attempt filter) are each one ordered probe of it. The same prefix serves
  the per-worker 24 h count behind ``retention_sweeps_24h``.
* ``idx_leader_worker_runs_started`` on ``(started_at)``: the age column coord's
  table-retention sweep prunes by (registered coord-side in the plan's Phase 4,
  30-day window).

No FK: ``holder_id`` is a per-boot replica identity that no table keeps a row
for once the replica is gone, a run record must outlive that churn, and a FK to
``coord.leader_lease`` would lock the lease row on every start. No SQLAlchemy
model: the table is coord-only.

## Volume

Only workers whose interval is at least 900 s will write rows, two statements
per run: at most 96 runs a day per worker. The live roster on 2026-10-14 had
about 29 such workers, about 1,170 runs a day, so under 2,000 rows a day. coord
reads a worker's rows once per leadership term plus bounded re-checks.

## Two-repo ordering: this schema half lands and is APPLIED first

alembic in qontinui-web is the SOLE author of ``coord.*`` schema (served policy
``production-and-cost`` ``alembic-sole-authorship``); the ``qontinui-coord``
binary authors zero ``coord.*`` DDL. The coord writer and reader (the plan's
Phase 3) are to land after this revision is applied in production. The plan's
D5 also has them degrade if it is not: coord is to ask its schema-readiness
probe whether this table is present before sending any statement, to treat
SQLSTATE 42P01 and 42703 the same way, and then to fall back to its in-process
record. The plan keeps the table off coord's critical boot list, so its absence
is not to stop coord from booting.

## Head choice

``down_revision`` is ``plan_library_10_model_routes``, which was the single
head of ``origin/main`` at ``dc1c5e696`` when this revision was last re-pointed
(``scripts/ci/count_alembic_heads.py`` read ``HEAD_COUNT=1``). If main has
moved before this lands, re-point ``down_revision``, the ``Revises:`` header
and ``_PARENT_REVISION_ID`` in ``tests/test_leader_worker_runs_01_migration.py``
at the new single head. Do not add an ``alembic merge``.

## Safety

``CREATE TABLE IF NOT EXISTS`` and ``CREATE INDEX IF NOT EXISTS`` on one new,
empty table, created and indexed in the same transaction, and every ``COMMENT
ON`` is re-runnable, so a partial apply re-runs cleanly. No existing table is
touched and there is no FK. ``downgrade()`` is ``DROP TABLE IF EXISTS``; the
indexes, constraints and comments go with it. Both directions are pure static
SQL, so they work under ``alembic ... --sql``.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "leader_worker_runs_01"
down_revision: str | Sequence[str] | None = "plan_library_10_model_routes"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Every SQL string below is a STATIC literal: the coord merge-train migration
# classifier extracts string literals from each execute call and rejects a call
# with none as dynamic. Every object is named `coord.`-qualified. The
# `alembic-schema-arg-gate` pre-commit hook checks that for CREATE/ALTER/DROP
# TABLE, REFERENCES, INDEX ... ON and DROP INDEX only (not COMMENT ON), and only
# in pre-commit; tests/test_leader_worker_runs_01_migration.py checks every
# TABLE, COLUMN-comment and INDEX target, COMMENT ON included.


def upgrade() -> None:
    """Create coord.leader_worker_runs, its two indexes, and document it."""
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.leader_worker_runs (
            id             BIGINT GENERATED ALWAYS AS IDENTITY,
            name           TEXT NOT NULL,
            interval_secs  INTEGER NOT NULL,
            run_kind       TEXT NOT NULL,
            holder_id      UUID NOT NULL,
            fenced_token   BIGINT,
            started_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
            finished_at    TIMESTAMPTZ,
            outcome        TEXT,
            decision_code  TEXT,
            detail_code    TEXT,
            more_pending   BOOLEAN NOT NULL DEFAULT false,
            continuation   TEXT,
            CONSTRAINT leader_worker_runs_pkey
                PRIMARY KEY (id),
            CONSTRAINT leader_worker_runs_name_nonblank_check
                CHECK (length(btrim(name)) > 0),
            CONSTRAINT leader_worker_runs_interval_positive_check
                CHECK (interval_secs > 0),
            CONSTRAINT leader_worker_runs_finished_after_started_check
                CHECK (finished_at IS NULL OR finished_at >= started_at),
            CONSTRAINT leader_worker_runs_outcome_iff_finished_check
                CHECK ((finished_at IS NULL) = (outcome IS NULL)),
            CONSTRAINT leader_worker_runs_continuation_length_check
                CHECK (continuation IS NULL OR length(continuation) <= 4096)
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_leader_worker_runs_name_started
            ON coord.leader_worker_runs (name, started_at DESC, id DESC)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_leader_worker_runs_started
            ON coord.leader_worker_runs (started_at)
        """
    )

    op.execute(
        """
        COMMENT ON TABLE coord.leader_worker_runs IS
            'Durable run log of coord''s leader-gated workers on the durable cadence (interval >= 900 s). coord INSERTs a row when a worker body starts and UPDATEs it with finished_at and outcome when the body returns, so the last run survives restarts and leader changes and a new leader runs overdue work on promotion. A row with finished_at NULL is in flight or was cut off by a crash, and is never counted as a completed run; a row coord''s graceful shutdown closed reads outcome cancelled. Written and read only by qontinui-coord (worker_ledger cadence); pruned by coord table retention.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.leader_worker_runs.id IS
            'Row id: what the start INSERT returns and the finish UPDATE targets. Breaks a started_at tie in the window read.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.leader_worker_runs.name IS
            'The worker''s stable ledger key (WorkerSpec::name, e.g. main.table_retention_pruner). Never blank.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.leader_worker_runs.interval_secs IS
            'The worker''s declared cadence in seconds when it ran. Provenance only: coord''s schedule reads the cadence from code, never from this column.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.leader_worker_runs.run_kind IS
            'scheduled (a run on the worker''s cadence) or continuation (a follow-up a capped body asked for). Free text so a new kind needs no DDL.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.leader_worker_runs.holder_id IS
            'Replica that ran the body: its leader holder id. The same value as coord.leader_lease.holder_id and coord.replica_presence.replica_id; coord.worker_heartbeats.replica_id stores it as text (holder_id::text joins it).'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.leader_worker_runs.fenced_token IS
            'Lease term (coord.leader_lease.fenced_token) the run started under. NULL when it could not be read.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.leader_worker_runs.started_at IS
            'When the body started, on the database clock. The ordering key of the window read and of the scheduled-attempt read.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.leader_worker_runs.finished_at IS
            'When the body returned (or when coord''s graceful shutdown cancelled it), on the database clock. NULL means the run is in flight or was cut off by a crash (a panic, an OOM kill, a deploy whose shutdown could not record it), never a completed run.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.leader_worker_runs.outcome IS
            'ok, idle or error once the body returned, as the worker ledger records a returned body; cancelled when coord''s graceful shutdown closed a run it was about to kill (not an attempt, never counted as a body that keeps dying). Present exactly when finished_at is.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.leader_worker_runs.decision_code IS
            'The body''s low-cardinality decision code, as recorded in coord.worker_heartbeats.last_decision_code.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.leader_worker_runs.detail_code IS
            'The body''s error detail code on an error outcome, as recorded in coord.worker_heartbeats.last_detail_code.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.leader_worker_runs.more_pending IS
            'The body reported work left over (for example a retention sweep that stopped at its batch cap), so coord may schedule a continuation run.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.leader_worker_runs.continuation IS
            'Opaque token handed back to the body on its continuation run (for the retention pruner, the sweeps that capped). At most 4096 characters.'
        """
    )


def downgrade() -> None:
    """Drop coord.leader_worker_runs; its indexes, constraints and comments go with it."""
    op.execute("DROP TABLE IF EXISTS coord.leader_worker_runs")
