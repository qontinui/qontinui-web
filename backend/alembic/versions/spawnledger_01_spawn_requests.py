"""coord.spawn_requests + coord.spawn_request_events — the spawn ledger

Revision ID: spawnledger_01_spawn_requests
Revises: coord_computers_01
Create Date: 2026-10-21

Phase 1 of plan
``2026-10-21-spawns-outrank-ci-and-builds-in-fleet-capacity-arbitration``
(decision D4 — "a spawn ledger, not a reconstruction").

coord authors **zero** DDL (``[policy: alembic-sole-authorship]``), so both
tables land here, in qontinui-web, and must be DEPLOYED before coord's ledger
writers and its ``GET /coord/spawns`` reads (that plan's Phase 2) touch them.
Those reads answer ``{"available": false, "reason": "schema_missing"}`` while the
tables are absent, never a 500 and never an empty list.

The re-point rule
=================

``down_revision`` is this repo's single alembic head at authoring time and is
deliberately NOT pinned to it: ``alembic-graph-pr.yml`` serialises alembic PRs,
so a revision that lands ahead of this one re-forks the chain and this line is
re-pointed at the new head. Re-point it; do NOT author an ``alembic merge``
revision and do NOT order it with coord dependency labels.

The gap
=======

A spawn coord decides to make — a gate continuation, a unit continuation, an
autofix dispatch — has no record of its own life. Plan
``2026-10-01-runner-spawn-bursts-are-unregulated-coord-must-admit-spawns-per-machine``'s
``coord.spawn_admission_ledger`` (``spawnadm_01``) records PERMITS: a grant, a
refusal, a runner's cumulative counter. It cannot answer "how long did this
spawn wait, where was it placed, how many times was it deferred, did it ever
start, and did the session it started finish its work", because nothing ties
one request to its placements, its deferrals and its outcome. Reconstructing
that from logs and the admission ledger is the guesswork D4 rejects. These two
tables are the record:

* ``coord.spawn_requests`` — ONE row per spawn, mutated in place as the spawn
  moves through its states. ``lease_id`` links it to the admission ledger's
  grant when one was served; it is deliberately not a foreign key (an admission
  log row may be retention-swept first, and a ledger write must never fail on
  referential bookkeeping).
* ``coord.spawn_request_events`` — APPEND-ONLY, one row per transition
  (requested, placed, dispatched, deferred, refused, rerouted, consumed,
  spawned, spawn_failed, expired, cancelled, outcome), which is what the
  Spawns page's per-spawn timeline reads.

Retention (requests 400 days, events 90 days) is enforced by coord, not by this
migration.

Column contract — shared with coord's Rust code (Phase 2)
=========================================================

``coord.spawn_requests``

``id UUID PRIMARY KEY DEFAULT gen_random_uuid()`` / ``tenant_id UUID NOT NULL``
    No tenant FK, as for every coord ledger. ``UNIQUE (id, tenant_id)``
    (``uq_spawn_requests_id_tenant``) is redundant as a key — ``id`` alone is
    one — and exists only as the target of the events' composite FK below.

``class TEXT NOT NULL`` — CHECK ``autofix`` | ``continuation`` | ``local`` | ``attended``
    coord's ``AdmissionClass`` (qontinui-coord#2761, ``spawn_admission.rs``) —
    the same set ``coord.spawn_admission_ledger.class`` carries.

``origin TEXT NOT NULL`` — CHECK the runner's ``SpawnOrigin::as_wire()`` set
    coord's mirror of it (qontinui-coord#2761, ``device_admission.rs``
    ``SpawnOrigin``): ``gate_continuation``, ``unit_continuation``,
    ``coord_dispatch``, ``looping_agent``, ``steward``, ``respawn``,
    ``scheduler``, ``orchestration``, ``boot_resume``, ``operator_terminal``,
    ``operator_chat``, ``unknown``. Unlike the admission ledger's free-text
    ``origin``, this one is constrained: a spawn row is the unit the Spawns page
    groups by, so an unrecognised origin must be ``unknown``, not a new bucket.
    The admission ledger's coord-side origins (``continuation_push``) are
    admission doors, not spawn origins, and are refused here. A runner variant
    added later is a qontinui-web revision that widens this CHECK, DEPLOYED
    BEFORE the coord change that emits the new origin; until it is deployed,
    coord writes ``unknown`` for any origin this CHECK does not list.

``source_ref TEXT NULL``
    The gate id, agent id or unit id the spawn was requested for. The partial
    unique index makes one row per ``(tenant_id, class, source_ref)`` — a
    re-requested continuation for the same gate updates its row rather than
    minting a second one. NULL (no addressable source) is never deduplicated.

``requested_at`` / ``first_dispatched_at`` / ``spawned_at`` / ``updated_at``
    ``requested_at`` is the first moment coord tried to place the spawn, so
    ``spawned_at - requested_at`` is the spawn's whole wait.

``pinned_device_id`` / ``preferred_device_id`` / ``current_device_id`` / ``spawned_device_id``
    ``pinned_device_id`` holds HARD pins only (``target_instance_name``,
    ``machine_bound``); ``preferred_device_id`` is a ``target_device_id``
    preference, which the plan's D3 releases when that machine has no capacity.

``lease_id UUID NULL``
    The ``coord.spawn_admission_ledger`` grant id, when one was served.

``placement_basis TEXT NULL`` — CHECK ``admitted`` | ``unknown_capacity_runner_guard``
| ``pinned`` | ``preference_released`` | ``attended``
    Why the spawn went where it went. NULL until it is placed.

``state TEXT NOT NULL DEFAULT 'queued'`` — CHECK ``queued`` | ``dispatched`` |
``deferred`` | ``spawned`` | ``failed`` | ``expired`` | ``cancelled`` | ``superseded``
    The first three are open (the partial index below); the rest are terminal.

``attempts INTEGER NOT NULL DEFAULT 0`` / ``deferrals INTEGER NOT NULL DEFAULT 0``
    CHECK ``>= 0`` each (``ck_spawn_requests_attempts_nonneg``,
    ``ck_spawn_requests_deferrals_nonneg``): coord only ever increments them.

``claude_code_session_id TEXT NULL`` / ``claude_account TEXT NULL``

``session_outcome TEXT NULL`` — CHECK ``working`` | ``finished`` | ``closed_unfinished`` | ``unknown``
``session_outcome_at TIMESTAMPTZ NULL``
    What the started session did with its work. NULL until there is a session.

``terminal_reason TEXT NULL``
    Free text: the reason vocabulary is grown from data.

``history_complete BOOLEAN NOT NULL DEFAULT true``
    false for rows backfilled from before the ledger existed, whose events
    timeline is partial. The stats read counts them separately rather than
    reading their missing events as "nothing happened".

``coord.spawn_request_events``

``id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY``
``request_id UUID NOT NULL`` / ``tenant_id UUID NOT NULL``
    ``FOREIGN KEY (request_id, tenant_id) REFERENCES coord.spawn_requests (id,
    tenant_id) ON DELETE CASCADE`` (``fk_spawn_request_events_request``). The
    one FK: an event has no meaning without its request, the retention sweep
    deleting a request takes its timeline with it, and because the key is
    composite an event can only ever carry its own request's tenant — a
    tenant-scoped timeline read can never surface another tenant's event.
``at TIMESTAMPTZ NOT NULL DEFAULT now()``
``kind TEXT NOT NULL`` — CHECK the twelve transitions listed above.
``device_id UUID NULL`` / ``reason TEXT NULL`` / ``detail JSONB NOT NULL DEFAULT '{}'``

Indexes
=======

* unique partial ``uq_spawn_requests_source`` on
  ``(tenant_id, class, source_ref) WHERE source_ref IS NOT NULL`` — the
  one-row-per-source upsert key.
* ``ix_spawn_requests_tenant_requested`` on ``(tenant_id, requested_at DESC)``
  — the Spawns page list and the stats window.
* partial ``ix_spawn_requests_open_state`` on ``(state) WHERE state IN
  ('queued', 'dispatched', 'deferred')`` — the arbiter's hot scan of open spawns.
* ``ix_spawn_requests_device`` on ``(tenant_id, spawned_device_id,
  requested_at)`` — the per-device breakdown.
* ``ix_spawn_request_events_request_at`` on ``(request_id, at)`` — one spawn's
  timeline, in order (and the supporting index for the cascade's lookup by
  ``request_id``).
* ``uq_spawn_requests_id_tenant`` — the unique constraint's own index, the
  composite FK's target.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "spawnledger_01_spawn_requests"
down_revision: str | Sequence[str] | None = "coord_computers_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create both ledger tables + their indexes. No rows."""
    # Raw ``op.execute`` with IF NOT EXISTS throughout — the convention the
    # sibling coord ledger tables use, and what keeps a re-run harmless.
    op.execute("CREATE SCHEMA IF NOT EXISTS coord")
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.spawn_requests (
            id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id               UUID NOT NULL,
            class                   TEXT NOT NULL,
            origin                  TEXT NOT NULL,
            source_ref              TEXT NULL,
            requested_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
            first_dispatched_at     TIMESTAMPTZ NULL,
            spawned_at              TIMESTAMPTZ NULL,
            updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
            pinned_device_id        UUID NULL,
            preferred_device_id     UUID NULL,
            current_device_id       UUID NULL,
            spawned_device_id       UUID NULL,
            lease_id                UUID NULL,
            placement_basis         TEXT NULL,
            state                   TEXT NOT NULL DEFAULT 'queued',
            attempts                INTEGER NOT NULL DEFAULT 0,
            deferrals               INTEGER NOT NULL DEFAULT 0,
            claude_code_session_id  TEXT NULL,
            claude_account          TEXT NULL,
            session_outcome         TEXT NULL,
            session_outcome_at      TIMESTAMPTZ NULL,
            terminal_reason         TEXT NULL,
            history_complete        BOOLEAN NOT NULL DEFAULT true,
            CONSTRAINT uq_spawn_requests_id_tenant UNIQUE (id, tenant_id),
            CONSTRAINT ck_spawn_requests_attempts_nonneg CHECK (attempts >= 0),
            CONSTRAINT ck_spawn_requests_deferrals_nonneg CHECK (deferrals >= 0),
            CONSTRAINT ck_spawn_requests_class
                CHECK (class IN ('autofix', 'continuation', 'local', 'attended')),
            CONSTRAINT ck_spawn_requests_origin
                CHECK (origin IN (
                    'gate_continuation', 'unit_continuation', 'coord_dispatch',
                    'looping_agent', 'steward', 'respawn', 'scheduler',
                    'orchestration', 'boot_resume', 'operator_terminal',
                    'operator_chat', 'unknown'
                )),
            CONSTRAINT ck_spawn_requests_placement_basis
                CHECK (placement_basis IN (
                    'admitted', 'unknown_capacity_runner_guard', 'pinned',
                    'preference_released', 'attended'
                )),
            CONSTRAINT ck_spawn_requests_state
                CHECK (state IN (
                    'queued', 'dispatched', 'deferred', 'spawned', 'failed',
                    'expired', 'cancelled', 'superseded'
                )),
            CONSTRAINT ck_spawn_requests_session_outcome
                CHECK (session_outcome IN (
                    'working', 'finished', 'closed_unfinished', 'unknown'
                ))
        )
        """
    )
    # One row per addressable source: the upsert key. NULL sources are
    # never deduplicated.
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_spawn_requests_source
            ON coord.spawn_requests (tenant_id, class, source_ref)
            WHERE source_ref IS NOT NULL
        """
    )
    # Tenant list + stats window, newest first.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_spawn_requests_tenant_requested
            ON coord.spawn_requests (tenant_id, requested_at DESC)
        """
    )
    # The arbiter's hot scan: open spawns only.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_spawn_requests_open_state
            ON coord.spawn_requests (state)
            WHERE state IN ('queued', 'dispatched', 'deferred')
        """
    )
    # Per-device breakdown.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_spawn_requests_device
            ON coord.spawn_requests (tenant_id, spawned_device_id, requested_at)
        """
    )
    # The FK is composite, so an event can only carry its own request's tenant.
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.spawn_request_events (
            id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
            request_id  UUID NOT NULL,
            tenant_id   UUID NOT NULL,
            at          TIMESTAMPTZ NOT NULL DEFAULT now(),
            kind        TEXT NOT NULL,
            device_id   UUID NULL,
            reason      TEXT NULL,
            detail      JSONB NOT NULL DEFAULT '{}'::jsonb,
            CONSTRAINT fk_spawn_request_events_request
                FOREIGN KEY (request_id, tenant_id)
                REFERENCES coord.spawn_requests (id, tenant_id)
                ON DELETE CASCADE,
            CONSTRAINT ck_spawn_request_events_kind
                CHECK (kind IN (
                    'requested', 'placed', 'dispatched', 'deferred', 'refused',
                    'rerouted', 'consumed', 'spawned', 'spawn_failed',
                    'expired', 'cancelled', 'outcome'
                ))
        )
        """
    )
    # One spawn's timeline in order; also backs the cascade's lookup.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_spawn_request_events_request_at
            ON coord.spawn_request_events (request_id, at)
        """
    )


def downgrade() -> None:
    """Drop both tables + their indexes, events first (it holds the FK)."""
    op.execute("DROP INDEX IF EXISTS coord.ix_spawn_request_events_request_at")
    op.execute("DROP TABLE IF EXISTS coord.spawn_request_events")
    op.execute("DROP INDEX IF EXISTS coord.ix_spawn_requests_device")
    op.execute("DROP INDEX IF EXISTS coord.ix_spawn_requests_open_state")
    op.execute("DROP INDEX IF EXISTS coord.ix_spawn_requests_tenant_requested")
    op.execute("DROP INDEX IF EXISTS coord.uq_spawn_requests_source")
    # DROP TABLE takes every CHECK constraint with it.
    op.execute("DROP TABLE IF EXISTS coord.spawn_requests")
