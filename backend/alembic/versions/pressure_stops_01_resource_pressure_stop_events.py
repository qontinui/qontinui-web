"""coord.resource_pressure_stop_events — one durable row per guard refusal or deferral

Phase 1 (the qontinui-web half, which lands and applies FIRST) of plan
``2026-11-24-pressure-stops-record-box-stats-in-coord``. Creates one new, empty
table, its comment and two indexes beside its keys, all in ONE transaction::

    coord.resource_pressure_stop_events
        (event_id, tenant_id, device_id, client_event_id, observed_at,
         recorded_at, stop_kind, lane, guard_lane, severity, what_class,
         observed, limit_value, reason, session_count_terminal,
         session_count_live_claude, active_ci_runners, ci_jobs_queued,
         calibration, fleet_calibration, suppressed_count, dropped_before,
         box_stats)
        ix_resource_pressure_stop_events_tenant_device_observed
            (tenant_id, device_id, observed_at DESC)
        ix_resource_pressure_stop_events_observed_at
            (observed_at)

Every name, type and default is the one the plan's Phase 1 fixes. Two things
depart from the plan text on purpose: the unique key is widened from the plan's
``(device_id, client_event_id)`` to ``(tenant_id, device_id, client_event_id)``
(see "Column authority" below), and the ``observed_at`` retention index is
added. The coord half (``resource_pressure_stops.rs``) and the runner emitter
are built against this table, so a shape change here is a contract change
there.

Why this table exists
=====================

``coord.device_resource_samples`` is a ~30 s gauge stream; a refusal between two
samples is invisible, and the runner's critical refusal of an operator spawn
reaches only a dialog and the runner log. This is the durable record of "this
spawn or launch was refused or deferred at this instant, at this reading, with
this load". "Stopped" means an admission refusal or deferral before a child
exists; the runner has no site that kills a running process for pressure.

Column authority
================

* ``lane`` is the METRIC class (``memory_free_commit`` | ``thread_pressure``);
  ``guard_lane`` is the POOL that refused (``host`` | ``wsl`` | ``threads``,
  ``GateObservation.lane``). Host and WSL are separate memory pools, so
  collapsing ``guard_lane`` into the metric would erase which pool ran out.
* ``session_count_terminal``, ``session_count_live_claude``,
  ``active_ci_runners`` and ``ci_jobs_queued`` are nullable on purpose: NULL
  means UNKNOWN (the reading failed or was stale), never zero. They carry no
  non-negative CHECK because coord's ingest drops a negative to NULL before
  the write; the table only ever sees NULL or a real count.
* ``calibration`` is always present (the runner's effective ceilings, floors,
  baselines and dial snapshot); ``fleet_calibration`` is NULL until the
  fleet-calibration plan's collector exists.
* ``suppressed_count`` / ``dropped_before`` make coalescing and queue overflow
  visible rather than silent.
* ``tenant_id`` and ``device_id`` carry no foreign key, like
  ``coord.device_resource_samples``: coord takes the tenant from the
  authenticated principal and a device row may be retired before its history.
* ``UNIQUE (tenant_id, device_id, client_event_id)`` is the idempotency key
  (``ON CONFLICT DO NOTHING``). The tenant is part of the key because a device
  may be bound to more than one tenant: keyed on the device alone, a retry of
  the same event under a second tenant's credential was answered ``duplicate``
  with no row stored for that tenant.

Retention
=========

None here. coord's leader-gated pruner deletes rows older than
``COORD_RESOURCE_PRESSURE_STOP_RETENTION_DAYS`` (default 90), next to the
``device_resource_samples`` prune. The composite index serves the per-device
read; the ``observed_at`` index serves the prune's range delete.

Lock posture
============

The table is new and invisible to every other session until this transaction
commits; it has no foreign key, so no lock is taken on any existing table.

Idempotency / authorship posture
================================

* ``CREATE TABLE IF NOT EXISTS`` / ``COMMENT ON`` / ``CREATE INDEX IF NOT
  EXISTS``, all in one transaction (a plain ``CREATE INDEX``, never
  ``CONCURRENTLY``, which coord's migration classifier admits as a new-table
  claim); a symmetric ``downgrade()`` drops both indexes and then the table.
* **alembic is the SOLE author of the ``coord.*`` schema** (served policy
  ``production-and-cost`` ``alembic-sole-authorship``). This revision must be
  APPLIED in production before the coord PR that reads or writes the table
  deploys; coord's read degrades on a missing relation.
* ``coord_tenant`` / ``coord_tenant_preflight`` get their privileges from
  ``coordrls_01``'s ``ALTER DEFAULT PRIVILEGES``.
* Every SQL string is a static literal and carries no ``%`` and no ``:name``
  bind parameter (the ``'{}'::jsonb`` casts are ``::``, which SQLAlchemy's
  ``text()`` does not treat as a parameter).

Chaining
========

``down_revision = "cfgyaml02_config_yaml_read_sha"`` — the single alembic head
at authoring (``alembic heads`` printed exactly one line). A re-point is three
coupled edits: ``down_revision``, the ``Revises:`` line below, and
``_PARENT_REVISION_ID`` in
``tests/test_pressure_stops_01_resource_pressure_stop_events_migration.py``.

Hand-authored; ``alembic revision --autogenerate`` was not run.

Revision ID: pressure_stops_01_resource_pressure_stop_events
Revises: cfgyaml02_config_yaml_read_sha
Create Date: 2026-11-24

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "pressure_stops_01_resource_pressure_stop_events"
down_revision: str | None = "cfgyaml02_config_yaml_read_sha"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create the table, its comment and its two indexes in ONE transaction."""
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.resource_pressure_stop_events (
            event_id                   uuid         NOT NULL DEFAULT gen_random_uuid(),
            tenant_id                  uuid         NOT NULL,
            device_id                  uuid         NOT NULL,
            client_event_id            text         NOT NULL,
            observed_at                timestamptz  NOT NULL,
            recorded_at                timestamptz  NOT NULL DEFAULT now(),
            stop_kind                  text         NOT NULL,
            -- the metric class that refused
            lane                       text         NOT NULL,
            -- the pool that refused (GateObservation.lane)
            guard_lane                 text         NOT NULL,
            severity                   text         NOT NULL,
            what_class                 text         NOT NULL,
            observed                   bigint,
            limit_value                bigint,
            reason                     text,
            -- NULL = UNKNOWN, never zero
            session_count_terminal     integer,
            session_count_live_claude  integer,
            active_ci_runners          integer,
            ci_jobs_queued             integer,
            calibration                jsonb        NOT NULL DEFAULT '{}'::jsonb,
            -- NULL until the fleet-calibration collector exists
            fleet_calibration          jsonb,
            suppressed_count           integer      NOT NULL DEFAULT 0,
            dropped_before             integer      NOT NULL DEFAULT 0,
            box_stats                  jsonb        NOT NULL DEFAULT '{}'::jsonb,
            CONSTRAINT resource_pressure_stop_events_pkey PRIMARY KEY (event_id),
            CONSTRAINT uq_resource_pressure_stop_events_client_event
                UNIQUE (tenant_id, device_id, client_event_id),
            CONSTRAINT ck_resource_pressure_stop_events_stop_kind
                CHECK (stop_kind IN ('refused_spawn', 'deferred_launch',
                                     'deferred_continuation', 'deferred_ci_job')),
            CONSTRAINT ck_resource_pressure_stop_events_lane
                CHECK (lane IN ('memory_free_commit', 'thread_pressure')),
            CONSTRAINT ck_resource_pressure_stop_events_guard_lane
                CHECK (guard_lane IN ('host', 'wsl', 'threads')),
            CONSTRAINT ck_resource_pressure_stop_events_severity
                CHECK (severity IN ('warn', 'critical'))
        )
        """
    )
    op.execute(
        """
        COMMENT ON TABLE coord.resource_pressure_stop_events IS
            'One row per runner resource-guard refusal or deferral (plan '
            '2026-11-24-pressure-stops-record-box-stats-in-coord). Written by coord '
            'POST /coord/devices/<device_id>/resource-stop, tenant taken from the '
            'authenticated principal; alembic authors the DDL. lane is the metric '
            'class, guard_lane the pool that refused. Nullable counts are UNKNOWN, '
            'never zero. Idempotent on (tenant_id, device_id, client_event_id).'
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_resource_pressure_stop_events_tenant_device_observed
            ON coord.resource_pressure_stop_events (tenant_id, device_id, observed_at DESC)
        """
    )
    # The 90-day retention prune deletes on observed_at alone, which the
    # composite index above cannot serve (its leading columns are tenant and
    # device).
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_resource_pressure_stop_events_observed_at
            ON coord.resource_pressure_stop_events (observed_at)
        """
    )


def downgrade() -> None:
    """Drop both indexes, then the table. The recorded events do not return."""
    op.execute(
        "DROP INDEX IF EXISTS coord.ix_resource_pressure_stop_events_observed_at"
    )
    op.execute(
        "DROP INDEX IF EXISTS coord.ix_resource_pressure_stop_events_tenant_device_observed"
    )
    op.execute("DROP TABLE IF EXISTS coord.resource_pressure_stop_events")
