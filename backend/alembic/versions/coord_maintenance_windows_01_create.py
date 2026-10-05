"""coord.machine_ci_hosts + coord.maintenance_windows — the machine/CI-host join and the maintenance-window ledger

Revision ID: coord_maintenance_windows_01
Revises: findings_keyset_01
Create Date: 2026-09-28

Phase 1 of plan
``2026-09-28-machine-maintenance-pause-ci-and-drain-in-one-place``.

Two tables, both additive, both coord-only:

1. ``coord.machine_ci_hosts`` — the DECLARED join between a workstation's
   coord device and the bare GitHub self-hosted runner name(s) that run on
   it (plan D2). Never inferred from names: a wrong guess pauses the wrong
   box. Written by the setup script, the operator page and the MCP twin
   through coord's ``/coord/fleet/machines/{device_id}/ci-hosts`` routes.
2. ``coord.maintenance_windows`` — one row per maintenance window: the
   levers it holds (``agent_work``, ``ci``), the per-label outcome of the CI
   delabel fan-out so the restore puts back exactly what was removed, the
   pool-health verdict recorded at open, and the window lifecycle. Read by
   coord's expiry/restore arm (Phase 3) and written by the window routes
   (Phase 4).

## Column shape of coord.machine_ci_hosts

* ``tenant_id`` UUID NOT NULL, ``device_id`` UUID NOT NULL — together a
  FOREIGN KEY to ``coord.tenant_devices (tenant_id, device_id)`` ON DELETE
  CASCADE. The composite FK is the whole point: a host can be linked only
  to a device BOUND to that tenant, and unbinding the device (a DELETE of
  its ``tenant_devices`` row) or deleting the device drops its links with it
  rather than leaving a join to a machine the tenant no longer has. Reaping
  is an UPDATE of ``coord.devices.reaped_at`` and does NOT drop them;
  readers filter reaped devices themselves.
* ``ci_host`` TEXT NOT NULL — the BARE GitHub runner name, what
  ``POST /coord/fleet/drain-host`` takes, never a synthetic
  ``gh-runner-*@repo`` hostname. CHECK non-blank.
* ``created_by`` TEXT NOT NULL — the actor that declared the link.
* ``created_at`` TIMESTAMPTZ NOT NULL DEFAULT now().

PRIMARY KEY ``(tenant_id, device_id, ci_host)``; UNIQUE
``machine_ci_hosts_tenant_ci_host_key (tenant_id, ci_host)`` — a host
belongs to one machine per tenant. That UNIQUE is what the link route maps
to ``409 ci_host_linked_elsewhere``.

## Column shape of coord.maintenance_windows

* ``id`` UUID PRIMARY KEY DEFAULT gen_random_uuid().
* ``tenant_id`` UUID NOT NULL.
* ``machine_device_id`` UUID NULL — the workstation coord device.
* ``ci_host`` TEXT NULL — the bare GitHub runner name. CHECK
  ``maintenance_windows_target_present``: at least one of the two is set (a
  CI host with no linked machine can be paused on its own). CHECK
  ``maintenance_windows_ci_host_nonblank`` when set.
* ``levers`` JSONB NOT NULL DEFAULT '{}' — per-lever state keyed by lever
  name (``agent_work``, ``ci``). CHECK it is a JSON object.
* ``until`` TIMESTAMPTZ NOT NULL — required, like a drain. CHECK
  ``until > opened_at``.
* ``reason`` TEXT NOT NULL — CHECK non-blank.
* ``opened_by`` TEXT NOT NULL; ``opened_at`` TIMESTAMPTZ NOT NULL DEFAULT
  now().
* ``closed_by`` TEXT NULL; ``closed_at`` TIMESTAMPTZ NULL.
* ``ci_paused_at`` TIMESTAMPTZ NULL — when the ci lever last became held,
  the post-pause-idle anchor of the readiness verdict.
* ``ci_label_outcomes`` JSONB NOT NULL DEFAULT '[]' — one element per
  ``(label, repo)`` the fan-out touched, with its outcome. CHECK it is a
  JSON array.
* ``pool_health`` JSONB NULL — ``classify_pool_health`` verdict at open.
* ``state`` TEXT NOT NULL DEFAULT 'open' — CHECK ``open | closed |
  expired``.

Lifecycle CHECK ``maintenance_windows_open_has_no_close``: an ``open`` row
carries neither ``closed_at`` nor ``closed_by``. CHECK
``maintenance_windows_closed_has_closed_at``: a ``closed`` row carries
``closed_at``. ``expired`` is deliberately unconstrained on the close
columns: the expiry arm, not an actor, ends it, and whether it stamps the
moment it observed the expiry is the writer's choice.

Unlike ``coord.ci_runner_quarantines``, ``state`` DOES carry a CHECK: the
set is the three lifecycle states the unique partial indexes are written
against, and a fourth value would silently escape the one-open-window rule.
The per-lever vocabulary lives inside ``levers`` and ``ci_label_outcomes``
and is unconstrained, closed by the Rust enums that write it.

## Indexes

* ``ux_maintenance_windows_open_machine`` — UNIQUE partial on
  ``(tenant_id, machine_device_id) WHERE machine_device_id IS NOT NULL AND
  state = 'open'``: at most one open window per machine.
* ``ux_maintenance_windows_open_ci_host`` — UNIQUE partial on
  ``(tenant_id, ci_host) WHERE ci_host IS NOT NULL AND state = 'open'``: at
  most one open window per CI host. The two are what the open route maps to
  ``409 window_already_open``, enforced by the database so two concurrent
  opens cannot both win. Both predicates are plain comparisons with no
  non-IMMUTABLE function.
* ``idx_maintenance_windows_open_until`` on ``(until) WHERE state =
  'open'`` — the expiry/restore arm scan for open windows past ``until``.
* ``idx_maintenance_windows_tenant_opened`` on ``(tenant_id, opened_at
  DESC)`` — the window list route (``include_closed``, newest first).

The database cannot see the machine/host join across the two tables: a
machine-only window and a host-only window on one of that machine's linked
hosts do not collide in either unique index, so the Phase 4 open route must
fold a machine's linked hosts from ``coord.machine_ci_hosts`` into its
window-conflict check.

## Why maintenance_windows takes no FK

``tenant_id`` and ``machine_device_id`` are plain columns, the
``coord_ci_runner_quarantines_01`` choice: a window is the audit record of
what coord did to a real GitHub runner's labels, and the restore arm must be
able to read it after the device is unbound from the tenant or deleted. A
cascade would erase the only
record of a label still off at GitHub. ``machine_ci_hosts`` is configuration,
not audit, so it takes the composite FK above. No SQLAlchemy model for
either: coord-only tables stay out of the ORM graph, and web is their schema
author, never a reader.

## Two-repo ordering: this schema half lands and is APPLIED first

alembic in qontinui-web is the SOLE author of ``coord.*`` schema; the
``qontinui-coord`` binary authors zero ``coord.*`` DDL and boot-gates on each
table through ``state::require_table``. The coord phases that read and write
these tables (3 and 4) land after this revision is applied in production.

## Head choice

``down_revision`` is ``findings_keyset_01``, the single head
of ``origin/main`` at ``fd5250c29`` when this was last re-pointed. If main has moved
before this lands, re-point it at the new single head. Do not add an
``alembic merge``: this repo keeps strict single-head discipline.

## Merge-train classifier disposition

coord's migration classifier is expected to classify this revision Reject: it
rejects a non-concurrent ``CREATE UNIQUE INDEX``, and it scans ``downgrade()`` too, where it rejects every
``DROP``. Every SQL string is a static literal, so it is not rejected for
being dynamic. The landed precedent ``coord_ci_runner_quarantines_01``
classifies Reject the same way.

## Safety

``CREATE TABLE IF NOT EXISTS``, ``CREATE [UNIQUE] INDEX IF NOT EXISTS`` and
re-runnable ``COMMENT ON``, so a partial apply re-runs cleanly. Both tables
are new and empty, so a non-concurrent index build holds no lock anyone
waits on. No existing table is altered; the composite FK takes a SHARE ROW
EXCLUSIVE lock on ``coord.tenant_devices`` for the instant of the CREATE.
``downgrade()`` drops the indexes and both tables, all ``IF EXISTS``; the
comments go with them. Both directions are pure SQL execution with no bind or
inspection, so they work under ``alembic ... --sql`` offline mode.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_maintenance_windows_01"
down_revision: str | Sequence[str] | None = "findings_keyset_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Every SQL string below is a STATIC literal. The coord merge-train migration
# classifier extracts string literals from each execute call and rejects a call
# with none as dynamic. Keep these comments free of apostrophes and of the
# op-dot-call spelling: the classifier lexer does not skip Python comments.


def upgrade() -> None:
    """Create coord.machine_ci_hosts and coord.maintenance_windows, document both."""
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.machine_ci_hosts (
            tenant_id   UUID        NOT NULL,
            device_id   UUID        NOT NULL,
            ci_host     TEXT        NOT NULL,
            created_by  TEXT        NOT NULL,
            created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT machine_ci_hosts_pkey
                PRIMARY KEY (tenant_id, device_id, ci_host),
            CONSTRAINT machine_ci_hosts_tenant_ci_host_key
                UNIQUE (tenant_id, ci_host),
            CONSTRAINT machine_ci_hosts_tenant_device_fkey
                FOREIGN KEY (tenant_id, device_id)
                REFERENCES coord.tenant_devices (tenant_id, device_id)
                ON DELETE CASCADE,
            CONSTRAINT machine_ci_hosts_ci_host_nonblank
                CHECK (btrim(ci_host) <> '')
        )
        """
    )

    op.execute(
        """
        COMMENT ON TABLE coord.machine_ci_hosts IS
            'Declared join between a workstation coord device and the bare GitHub self-hosted runner names that run on it, never inferred from names. Written through the coord routes /coord/fleet/machines/{device_id}/ci-hosts; read by the maintenance-window routes and the Phase 3 expiry arm. One machine per host per tenant (machine_ci_hosts_tenant_ci_host_key). Plan 2026-09-28-machine-maintenance-pause-ci-and-drain-in-one-place, Phase 1.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.machine_ci_hosts.ci_host IS
            'The BARE GitHub runner name, what POST /coord/fleet/drain-host takes. Never a synthetic gh-runner-*@repo hostname.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.machine_ci_hosts.device_id IS
            'The workstation coord device (coord.devices), not a ci_runner row. With tenant_id a FK to coord.tenant_devices ON DELETE CASCADE: unbinding the device (DELETE of its tenant_devices row) or deleting the device drops its links. Reaping is an UPDATE of coord.devices.reaped_at and does NOT; readers filter reaped devices themselves.'
        """
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.maintenance_windows (
            id                 UUID        NOT NULL DEFAULT gen_random_uuid(),
            tenant_id          UUID        NOT NULL,
            machine_device_id  UUID,
            ci_host            TEXT,
            levers             JSONB       NOT NULL DEFAULT '{}',
            until              TIMESTAMPTZ NOT NULL,
            reason             TEXT        NOT NULL,
            opened_by          TEXT        NOT NULL,
            opened_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
            closed_by          TEXT,
            closed_at          TIMESTAMPTZ,
            ci_paused_at       TIMESTAMPTZ,
            ci_label_outcomes  JSONB       NOT NULL DEFAULT '[]',
            pool_health        JSONB,
            state              TEXT        NOT NULL DEFAULT 'open',
            CONSTRAINT maintenance_windows_pkey PRIMARY KEY (id),
            CONSTRAINT maintenance_windows_target_present
                CHECK (machine_device_id IS NOT NULL OR ci_host IS NOT NULL),
            CONSTRAINT maintenance_windows_ci_host_nonblank
                CHECK (ci_host IS NULL OR btrim(ci_host) <> ''),
            CONSTRAINT maintenance_windows_state_check
                CHECK (state IN ('open', 'closed', 'expired')),
            CONSTRAINT maintenance_windows_reason_nonblank
                CHECK (btrim(reason) <> ''),
            CONSTRAINT maintenance_windows_until_after_open
                CHECK (until > opened_at),
            CONSTRAINT maintenance_windows_levers_object
                CHECK (jsonb_typeof(levers) = 'object'),
            CONSTRAINT maintenance_windows_ci_label_outcomes_array
                CHECK (jsonb_typeof(ci_label_outcomes) = 'array'),
            CONSTRAINT maintenance_windows_open_has_no_close
                CHECK (state <> 'open' OR (closed_at IS NULL AND closed_by IS NULL)),
            CONSTRAINT maintenance_windows_closed_has_closed_at
                CHECK (state <> 'closed' OR closed_at IS NOT NULL)
        )
        """
    )

    # At most one OPEN window per machine and per CI host, enforced by the
    # database so two concurrent opens cannot both win.
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS ux_maintenance_windows_open_machine
            ON coord.maintenance_windows (tenant_id, machine_device_id)
            WHERE machine_device_id IS NOT NULL AND state = 'open'
        """
    )
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS ux_maintenance_windows_open_ci_host
            ON coord.maintenance_windows (tenant_id, ci_host)
            WHERE ci_host IS NOT NULL AND state = 'open'
        """
    )
    # The expiry and restore arm scan over open windows.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_maintenance_windows_open_until
            ON coord.maintenance_windows (until)
            WHERE state = 'open'
        """
    )
    # The window list route, newest first.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_maintenance_windows_tenant_opened
            ON coord.maintenance_windows (tenant_id, opened_at DESC)
        """
    )

    op.execute(
        """
        COMMENT ON TABLE coord.maintenance_windows IS
            'One row per machine maintenance window: the levers it holds (agent_work, ci), the per-label outcome of the CI delabel fan-out, the pool-health verdict at open, and the lifecycle. Written by the coord maintenance-window routes, read by the expiry and restore arm hosted beside fleet_drain resolve_expired_drain_alerts. At most one open window per machine and per CI host (ux_maintenance_windows_open_machine, ux_maintenance_windows_open_ci_host). Plan 2026-09-28-machine-maintenance-pause-ci-and-drain-in-one-place, Phase 1.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.maintenance_windows.levers IS
            'JSON object keyed by lever name (agent_work, ci), each value the lever state the coord route wrote: held, state, detail. The per-lever vocabulary is closed by the Rust enums that write it, not by a CHECK.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.maintenance_windows.ci_label_outcomes IS
            'JSON array, one element per (label, repo) the CI delabel fan-out touched: label, repo, outcome (removed | skipped_not_drawable | failed | restored | restore_failed), detail. The restore puts back exactly what this records as removed, never a hardcoded label.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.maintenance_windows.ci_paused_at IS
            'When the ci lever last became held. The post-pause-idle anchor of the readiness verdict. NULL = the ci lever has never been held on this window.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.maintenance_windows.pool_health IS
            'classify_pool_health verdict recorded at open: verdict (host_specific | pool_wide | indeterminate) and detail. NULL = not recorded (no ci lever at open).'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.maintenance_windows.state IS
            'open | closed | expired. CHECKed, because the one-open-window unique indexes are written against open. An open row carries no closed_at or closed_by; a closed row carries closed_at. An expired or closed window may still owe a label restore: the restore arm reads ci_label_outcomes, not state alone.'
        """
    )


def downgrade() -> None:
    """Drop the maintenance-window indexes and both tables. Their comments go with them."""
    op.execute("DROP INDEX IF EXISTS coord.idx_maintenance_windows_tenant_opened")
    op.execute("DROP INDEX IF EXISTS coord.idx_maintenance_windows_open_until")
    op.execute("DROP INDEX IF EXISTS coord.ux_maintenance_windows_open_ci_host")
    op.execute("DROP INDEX IF EXISTS coord.ux_maintenance_windows_open_machine")
    op.execute("DROP TABLE IF EXISTS coord.maintenance_windows")
    op.execute("DROP TABLE IF EXISTS coord.machine_ci_hosts")
