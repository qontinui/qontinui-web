"""coord.computers — the fleet machine as a first-class coord entity

Revision ID: coord_computers_01
Revises: coordinput_01_operator_inputs
Create Date: 2026-09-30

Phase 1 (schema) of plan
``2026-09-30-the-fleet-machine-is-not-a-first-class-coord-entity-and-coord-has-no-resource-model``.

coord authors **zero** DDL (served policy ``production-and-cost``
``alembic-sole-authorship``), so these tables land here, in qontinui-web, and
must be applied in production BEFORE the coord PR that reads or writes them
(``POST /coord/computers/report``, ``GET /coord/computers``) leaves draft.
``down_revision`` is this repo's LOCAL single alembic head at authoring time and
is not pinned: if another revision lands first, ``alembic-heads-pr`` fails this
PR with the token to re-point at. Re-point it; do not author a merge revision.

The gap
=======

Before this revision coord had no row for a MACHINE. ``coord.devices`` is one
row per runner install (per credential), so one physical host running a primary
runner, two named runners, a supervisor and a WSL guest is five unrelated rows,
and ``coord.device_resource_samples`` measures LANES of those devices. Nothing
joined "the OOM killer fired on this box" to "these GitHub runners and these
agent sessions live on this box", so a GitHub Actions runner that was OOM-killed
and never restarted was invisible to every coord surface for hours (plan §1).

Identifier: ``computer``, never ``machine`` — ``machine_id`` already means a
``coord.devices.device_id`` in five coord tables.

What this migration does
========================

1. Creates ``coord.computers``: one row per machine PER TENANT (contract
   amendment A1), keyed by coord-minted ``computer_id`` and identified within
   its tenant by ``identity_hash`` — the lowercase hex HMAC-SHA256 of the raw OS
   machine id under the fixed key ``qontinui-computer-identity-v1``, so no raw
   machine id is ever stored. The CHECK pins the 64-lowercase-hex shape, so a
   raw id (or an uppercase digest, which would silently mint a second row for
   the same machine) is refused. ``kind`` is CHECKed to
   ``host | wsl_guest | container | vm``.

   Tenant scoping is enforced by the SCHEMA, not only by coord. The HMAC key
   is public, so a globally unique ``identity_hash`` would make one row shared
   by every tenant with a device on that machine: a cross-tenant read of its
   services, events and access details, and a cross-tenant overwrite. So
   ``tenant_id`` is NOT NULL (FK to ``coord.tenants``, cascading like
   ``coord.tenant_devices``), uniqueness is ``(tenant_id, identity_hash)`` —
   the same box seen by two tenants is two rows — and
   ``UNIQUE (tenant_id, computer_id)`` is the target of every composite FK
   below. ``parent_computer_id`` links a WSL guest to its Windows host through
   ``(tenant_id, parent_computer_id)``, so a parent in another tenant is
   refused, and deleting the host sets only ``parent_computer_id`` to NULL
   (the column-list ``ON DELETE SET NULL (col)`` form, PostgreSQL 15+;
   production is RDS PostgreSQL 16.13 per ``docs/architecture/database-schema.md``).
2. Creates ``coord.computer_services``: the LATEST snapshot of each watched
   service unit (GitHub Actions runner services, the runner itself, other
   watched units), PK ``(computer_id, unit)``, cascading with the computer.
   ``runner_name`` is the GitHub runner name read from the unit ``.runner``
   file, and is what joins a service to a CI-runner registrar row.
3. Creates ``coord.computer_events``: an APPEND-ONLY event log
   (``oom_kill``, ``service_failed``, ``service_recovered``, ``reboot``,
   ``telemetry_gap``, ``identity_conflict``), cascading with the computer.
   ``UNIQUE (computer_id, client_event_id)`` is the dedup contract a report
   retry relies on: the reporter mints a stable ``client_event_id`` per event
   and coord inserts ``ON CONFLICT DO NOTHING``. Retention (30 days) is enforced
   by coord, served by ``ix_computer_events_observed_at``.
4. Adds ``coord.tenant_devices.computer_id``: which computer a runner install
   runs on, recorded on the tenant BINDING row rather than on
   ``coord.devices`` (a device row is shared across tenants; a computer row is
   not). The FK is composite, ``(tenant_id, computer_id)`` to
   ``coord.computers (tenant_id, computer_id)``, so a binding can only point
   at a computer of its own tenant; deleting the computer sets only
   ``computer_id`` to NULL. Written by coord at report time from the device
   that posted the report (``attach_device``). Partially indexed.
5. Adds to ``coord.device_resource_samples``: ``computer_id`` (NO FK — a hot
   append-only table whose best-effort insert must never fail on referential
   bookkeeping; indexed partially and CONCURRENTLY), ``load_5m`` / ``load_15m``
   (``REAL``, the type of the existing ``load_1m``), twelve PSI averages
   (``REAL``, percent 0-100, from ``/proc/pressure``), ``oom_kill_total``
   (``/proc/vmstat`` ``oom_kill``, a monotonic counter since boot), ``boot_id``
   (which boot the counter belongs to — a counter drop across a boot change is
   a reset, not negative OOMs), and ``measured`` (per-axis
   ``measured | not_supported | unavailable``).

No backfill — NULL is UNKNOWN
=============================

Every new column on an existing table is nullable with no default, and this
revision writes no rows. A hand-mapped backfill of ``tenant_devices.computer_id`` would
publish tenant hostnames in an open-source tree and would have no
``identity_hash`` to key on (nothing reports one until Phase 2). Coord attaches
the column at report time instead. Consumers read NULL as UNKNOWN — never as
zero, never as healthy, and never as "no computer".

Lock posture
============

The two ALTERs on existing tables take a brief ACCESS EXCLUSIVE lock (nullable
columns with no default are a catalogue update, no rewrite). ``SET LOCAL
lock_timeout = '3s'`` is the FIRST statement of both ``upgrade()`` and
``downgrade()`` and is never reset inside them, so every lock this revision
requests fails fast rather than queueing in front of the readers of the hot
sample table:

* upgrade: ``CREATE TABLE coord.computers ... REFERENCES coord.tenants`` takes
  SHARE ROW EXCLUSIVE on ``coord.tenants`` (it blocks tenant writes, not reads)
  for the rest of the transaction;
* downgrade: ``DROP TABLE coord.computers`` removes its FK triggers from
  ``coord.tenants`` and so takes ACCESS EXCLUSIVE on ``coord.tenants`` while
  ``coord.tenant_devices`` and ``coord.device_resource_samples`` are held.
  Without the bound that request would wait unbounded, with both tables held.

``lock_timeout`` is per lock request, not per statement, so the worst case for
a reader queued on ``coord.tenant_devices`` is a sum of per-request bounds:

* upgrade: about 2 x 3s. The two-table ``LOCK TABLE`` below is two requests:
  up to 3s while the migration waits for ``coord.tenant_devices`` itself, then
  up to 3s holding it while it waits for ``coord.device_resource_samples``.
  Every later request in the transaction is on a table this revision just
  created, which nothing else can hold.
* downgrade: about (2 + 4) x 3s. After the same two requests it makes four
  more while still holding both tables, each bounded by 3s: on
  ``coord.computer_events``, ``coord.computer_services`` and
  ``coord.computers`` (their index, FK and table drops) and on
  ``coord.tenants``. Those extra waits happen only when coord readers of the
  new tables, or of ``coord.tenants``, are in flight.

That is kept at the house 3s (as in
``twin_10_served_bundle_target_columns``) rather than lowered: a lower bound
buys a shorter worst case on a small binding table at the price of more
spurious lock-timeout failures on a busy sample table, and a failed attempt is
simply retried. In a multi-revision downgrade run the 3s bound also covers the
revisions downgraded after this one in the same transaction, which then fail
fast rather than hang.

The sample-table index is built ``CONCURRENTLY`` inside
``autocommit_block()`` (the posture of ``twin_10_served_bundle_target_columns``),
repairing an INVALID leftover of a failed earlier build. ``coord.tenant_devices``
is one row per binding, so its index is built in-transaction.
``coord.devices`` is not touched at all.

Lock order. Before touching either existing table, both ``upgrade()`` and
``downgrade()`` run ONE statement, ``LOCK TABLE coord.tenant_devices,
coord.device_resource_samples IN ACCESS EXCLUSIVE MODE``, which takes the two
locks in the order coord readers take them. The placement and CI-dispatch
reads are single statements of the shape ``FROM coord.devices d JOIN
coord.tenant_devices td ... LEFT JOIN LATERAL (... FROM
coord.device_resource_samples ...)`` — qontinui-coord
``crates/coord/src/agent_placement.rs`` (``candidate_sql``) and
``crates/coord/src/ci_dispatch.rs`` (``select_ci_node_sql`` with
``newest_sample_pressure_lateral_sql``) — and PostgreSQL locks a statement
relations in range-table order: devices, then tenant_devices, then samples. A
migration that took samples before tenant_devices could deadlock against such
a reader (review of an earlier draft in qontinui-web#1598 found that shape).
``coord.devices`` is deliberately NOT locked: this revision
does not alter it, and a reader that holds it only waits on tables this
revision already holds, which is a wait, not a cycle. With both locks held up
front, the ALTERs that follow may run in any order.

``CREATE INDEX CONCURRENTLY`` waits for every transaction that could still see
the table to finish (a virtualxid wait), so a long-running transaction elsewhere
can make this step wait with it. That is a stalled migration, not an outage:
the concurrent build takes no lock that blocks readers or writers of the sample
table while it waits, and a killed build leaves an INVALID index the retry
repairs.

Merge-train classification: this revision does not take the coord merge-train
migration classifier fast path: its non-concurrent ``CREATE INDEX`` statements
(on the new tables and on ``coord.tenant_devices``) and the up-front ``LOCK TABLE``
take the escalate path, the same as ``coordinput_01_operator_inputs``. Every
SQL string is still a static literal, so the classifier can read each
statement.
"""

from collections.abc import Sequence

from alembic import op
from sqlalchemy import text

# revision identifiers, used by Alembic.
revision: str = "coord_computers_01"
down_revision = "coordinput_01_operator_inputs"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Keep these comments free of apostrophes and of the op-dot-call spelling: the
# coord migration classifier lexer does not skip Python comments.


def _index_is_invalid(index_name: str) -> bool:
    """True when ``coord.<index_name>`` exists and is INVALID (a failed build)."""
    return bool(
        op.get_bind()
        .execute(
            text(
                """
                SELECT NOT i.indisvalid
                  FROM pg_index i
                  JOIN pg_class c ON c.oid = i.indexrelid
                  JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE n.nspname = 'coord' AND c.relname = :idx
                """
            ),
            {"idx": index_name},
        )
        .scalar()
    )


def upgrade() -> None:
    """Create the three computer tables; attach tenant bindings and samples to them."""
    # First statement: every lock this revision takes is bounded, including the
    # SHARE ROW EXCLUSIVE lock the computers FK takes on coord.tenants below.
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute("CREATE SCHEMA IF NOT EXISTS coord")

    # 1. The machine itself.
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.computers (
            computer_id           UUID        NOT NULL DEFAULT gen_random_uuid(),
            tenant_id             UUID        NOT NULL,
            identity_hash         TEXT        NOT NULL,
            kind                  TEXT        NOT NULL,
            parent_computer_id    UUID,
            hostname              TEXT,
            os                    TEXT,
            os_version            TEXT,
            kernel                TEXT,
            arch                  TEXT,
            cpu_cores             INTEGER,
            memory_total_bytes    BIGINT,
            swap_total_bytes      BIGINT,
            disk_total_bytes      BIGINT,
            gpus                  JSONB,
            boot_id               TEXT,
            booted_at             TIMESTAMPTZ,
            access                JSONB,
            identity_conflict_at  TIMESTAMPTZ,
            first_seen_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
            last_report_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT computers_pkey PRIMARY KEY (computer_id),
            CONSTRAINT uq_computers_tenant_identity_hash
                UNIQUE (tenant_id, identity_hash),
            CONSTRAINT uq_computers_tenant_computer UNIQUE (tenant_id, computer_id),
            CONSTRAINT ck_computers_identity_hash
                CHECK (identity_hash ~ '^[0-9a-f]{64}$'),
            CONSTRAINT ck_computers_kind
                CHECK (kind IN ('host', 'wsl_guest', 'container', 'vm')),
            CONSTRAINT fk_computers_tenant_id
                FOREIGN KEY (tenant_id)
                REFERENCES coord.tenants (tenant_id) ON DELETE CASCADE,
            CONSTRAINT fk_computers_parent_computer_id
                FOREIGN KEY (tenant_id, parent_computer_id)
                REFERENCES coord.computers (tenant_id, computer_id)
                ON DELETE SET NULL (parent_computer_id)
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_computers_parent_computer_id
            ON coord.computers (tenant_id, parent_computer_id)
            WHERE parent_computer_id IS NOT NULL
        """
    )

    # 2. Latest snapshot of each watched service unit.
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.computer_services (
            computer_id       UUID        NOT NULL,
            unit              TEXT        NOT NULL,
            kind              TEXT        NOT NULL,
            active_state      TEXT,
            sub_state         TEXT,
            result            TEXT,
            restart_policy    TEXT,
            oom_policy        TEXT,
            memory_max        BIGINT,
            memory_peak       BIGINT,
            n_restarts        INTEGER,
            state_changed_at  TIMESTAMPTZ,
            reported_state_changed_at TIMESTAMPTZ,
            observed_at       TIMESTAMPTZ NOT NULL,
            runner_name       TEXT,
            repo              TEXT,
            CONSTRAINT computer_services_pkey PRIMARY KEY (computer_id, unit),
            CONSTRAINT ck_computer_services_kind
                CHECK (kind IN ('gh_actions_runner', 'qontinui_runner', 'other_watched')),
            CONSTRAINT fk_computer_services_computer_id
                FOREIGN KEY (computer_id)
                REFERENCES coord.computers (computer_id) ON DELETE CASCADE
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_computer_services_runner_name
            ON coord.computer_services (runner_name)
            WHERE runner_name IS NOT NULL
        """
    )

    # 3. Append-only event log.
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.computer_events (
            event_id         UUID        NOT NULL DEFAULT gen_random_uuid(),
            computer_id      UUID        NOT NULL,
            client_event_id  TEXT        NOT NULL,
            kind             TEXT        NOT NULL,
            observed_at      TIMESTAMPTZ NOT NULL,
            detail           JSONB       NOT NULL DEFAULT '{}'::jsonb,
            recorded_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT computer_events_pkey PRIMARY KEY (event_id),
            CONSTRAINT uq_computer_events_client_event
                UNIQUE (computer_id, client_event_id),
            CONSTRAINT ck_computer_events_kind
                CHECK (kind IN ('oom_kill', 'service_failed', 'service_recovered',
                                'reboot', 'telemetry_gap', 'identity_conflict')),
            CONSTRAINT fk_computer_events_computer_id
                FOREIGN KEY (computer_id)
                REFERENCES coord.computers (computer_id) ON DELETE CASCADE
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_computer_events_computer_observed
            ON coord.computer_events (computer_id, observed_at DESC)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_computer_events_observed_at
            ON coord.computer_events (observed_at)
        """
    )

    op.execute(
        """
        COMMENT ON TABLE coord.computers IS
            'One row per machine PER TENANT: the same box seen by two tenants is two rows, each fed only by that tenant reporters. identity_hash is the lowercase hex HMAC-SHA256 of the raw OS machine id under the key qontinui-computer-identity-v1; the raw id is never stored. Written by coord POST /coord/computers/report. Plan 2026-09-30-the-fleet-machine-is-not-a-first-class-coord-entity-and-coord-has-no-resource-model.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.computers.identity_conflict_at IS
            'Set when two live reporters share identity_hash with different boot_id (a cloned image). NULL = no conflict observed. Coord never merges the two silently.'
        """
    )
    op.execute(
        """
        COMMENT ON TABLE coord.computer_services IS
            'Latest snapshot of each watched service unit per computer. For each kind a report declares complete, coord deletes that kind''s rows the report does not list; other kinds are a delta (upsert only). runner_name joins a unit to the CI runner registrar.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.computer_services.reported_state_changed_at IS
            'The state_changed_at exactly as the reporter sent it, before coord clamped a future value to now(). A same-state report carrying the same raw value is the same transition, so state_changed_at (coord''s clock) is kept and dwell keeps growing on a fast-clock box.'
        """
    )
    op.execute(
        """
        COMMENT ON TABLE coord.computer_events IS
            'Append-only per-computer events. UNIQUE (computer_id, client_event_id) is the dedup key a report retry relies on. 30-day retention enforced by coord.'
        """
    )

    # 4 and 5. Attach existing tables, under the lock_timeout set at the top.
    # Take both locks in ONE statement in the coord reader order
    # (tenant_devices then samples) so no reader join can deadlock against the
    # ALTERs below.
    op.execute(
        "LOCK TABLE coord.tenant_devices, coord.device_resource_samples "
        "IN ACCESS EXCLUSIVE MODE"
    )
    op.execute(
        """
        ALTER TABLE coord.device_resource_samples
            ADD COLUMN IF NOT EXISTS computer_id UUID,
            ADD COLUMN IF NOT EXISTS load_5m REAL,
            ADD COLUMN IF NOT EXISTS load_15m REAL,
            ADD COLUMN IF NOT EXISTS psi_memory_some_avg10 REAL,
            ADD COLUMN IF NOT EXISTS psi_memory_some_avg60 REAL,
            ADD COLUMN IF NOT EXISTS psi_memory_full_avg10 REAL,
            ADD COLUMN IF NOT EXISTS psi_memory_full_avg60 REAL,
            ADD COLUMN IF NOT EXISTS psi_cpu_some_avg10 REAL,
            ADD COLUMN IF NOT EXISTS psi_cpu_some_avg60 REAL,
            ADD COLUMN IF NOT EXISTS psi_cpu_full_avg10 REAL,
            ADD COLUMN IF NOT EXISTS psi_cpu_full_avg60 REAL,
            ADD COLUMN IF NOT EXISTS psi_io_some_avg10 REAL,
            ADD COLUMN IF NOT EXISTS psi_io_some_avg60 REAL,
            ADD COLUMN IF NOT EXISTS psi_io_full_avg10 REAL,
            ADD COLUMN IF NOT EXISTS psi_io_full_avg60 REAL,
            ADD COLUMN IF NOT EXISTS oom_kill_total BIGINT,
            ADD COLUMN IF NOT EXISTS boot_id TEXT,
            ADD COLUMN IF NOT EXISTS measured JSONB
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.device_resource_samples.computer_id IS
            'The computer this sample was measured on, stamped by coord from coord.tenant_devices.computer_id of the (sample tenant, posting device) binding. NULL = UNKNOWN (device not yet attached). Deliberately no FK: hot append-only table.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.device_resource_samples.oom_kill_total IS
            'The /proc/vmstat oom_kill counter, monotonic since boot_id began. A drop across a boot_id change is a reset, not a negative count. NULL = UNKNOWN, never 0.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.device_resource_samples.measured IS
            'Per-axis provenance: axis name (load_1m, load_5m, load_15m, psi_memory, psi_cpu, psi_io, oom_kill_total, boot_id) to measured, not_supported or unavailable. NULL = the publisher predates the field; every axis is then UNKNOWN.'
        """
    )
    op.execute(
        """
        ALTER TABLE coord.tenant_devices
            ADD COLUMN IF NOT EXISTS computer_id UUID
        """
    )
    # ADD CONSTRAINT has no IF NOT EXISTS; guard it so a retry after a failed
    # concurrent index build (the DDL above already committed) re-runs cleanly.
    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint
                 WHERE conname = 'fk_tenant_devices_computer'
                   AND conrelid = 'coord.tenant_devices'::regclass
            ) THEN
                ALTER TABLE coord.tenant_devices
                    ADD CONSTRAINT fk_tenant_devices_computer
                    FOREIGN KEY (tenant_id, computer_id)
                    REFERENCES coord.computers (tenant_id, computer_id)
                    ON DELETE SET NULL (computer_id);
            END IF;
        END
        $$
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_tenant_devices_computer_id
            ON coord.tenant_devices (computer_id)
            WHERE computer_id IS NOT NULL
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.tenant_devices.computer_id IS
            'The computer this runner install runs on, within this binding tenant, attached by coord at report time from the posting device. The composite FK keeps it inside the tenant. NULL = UNKNOWN (not yet reported), never no computer.'
        """
    )

    # The sample-table index, CONCURRENTLY: autocommit_block commits the ALTERs
    # above first, so their lock is gone before the build scans the table.
    with op.get_context().autocommit_block():
        if _index_is_invalid("ix_device_resource_samples_computer_sampled"):
            op.execute(
                "DROP INDEX CONCURRENTLY IF EXISTS "
                "coord.ix_device_resource_samples_computer_sampled"
            )
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS
                ix_device_resource_samples_computer_sampled
            ON coord.device_resource_samples (computer_id, sampled_at DESC)
            WHERE computer_id IS NOT NULL
            """
        )


def downgrade() -> None:
    """Exact reverse of upgrade. Data lost: every computer, service, event, and
    every sample attribution and new sample axis; none can be rebuilt."""
    op.execute("SET LOCAL lock_timeout = '3s'")
    # Both locks first, in the coord reader order (tenant_devices then samples).
    op.execute(
        "LOCK TABLE coord.tenant_devices, coord.device_resource_samples "
        "IN ACCESS EXCLUSIVE MODE"
    )
    # Plain, in-transaction: the column drop below would take the index with it
    # anyway, and a concurrent drop would commit on its own and wait unbounded.
    op.execute("DROP INDEX IF EXISTS coord.ix_device_resource_samples_computer_sampled")
    op.execute(
        """
        ALTER TABLE coord.device_resource_samples
            DROP COLUMN IF EXISTS measured,
            DROP COLUMN IF EXISTS boot_id,
            DROP COLUMN IF EXISTS oom_kill_total,
            DROP COLUMN IF EXISTS psi_io_full_avg60,
            DROP COLUMN IF EXISTS psi_io_full_avg10,
            DROP COLUMN IF EXISTS psi_io_some_avg60,
            DROP COLUMN IF EXISTS psi_io_some_avg10,
            DROP COLUMN IF EXISTS psi_cpu_full_avg60,
            DROP COLUMN IF EXISTS psi_cpu_full_avg10,
            DROP COLUMN IF EXISTS psi_cpu_some_avg60,
            DROP COLUMN IF EXISTS psi_cpu_some_avg10,
            DROP COLUMN IF EXISTS psi_memory_full_avg60,
            DROP COLUMN IF EXISTS psi_memory_full_avg10,
            DROP COLUMN IF EXISTS psi_memory_some_avg60,
            DROP COLUMN IF EXISTS psi_memory_some_avg10,
            DROP COLUMN IF EXISTS load_15m,
            DROP COLUMN IF EXISTS load_5m,
            DROP COLUMN IF EXISTS computer_id
        """
    )
    op.execute("DROP INDEX IF EXISTS coord.ix_tenant_devices_computer_id")
    # Dropping the column drops fk_tenant_devices_computer with it.
    op.execute("ALTER TABLE coord.tenant_devices DROP COLUMN IF EXISTS computer_id")
    # No reset of lock_timeout: dropping coord.computers below removes its FK
    # triggers from coord.tenants and so takes ACCESS EXCLUSIVE on coord.tenants
    # while tenant_devices and samples are still held. That lock must stay
    # bounded too.
    op.execute("DROP INDEX IF EXISTS coord.ix_computer_events_observed_at")
    op.execute("DROP INDEX IF EXISTS coord.ix_computer_events_computer_observed")
    op.execute("DROP TABLE IF EXISTS coord.computer_events")
    op.execute("DROP INDEX IF EXISTS coord.ix_computer_services_runner_name")
    op.execute("DROP TABLE IF EXISTS coord.computer_services")
    op.execute("DROP INDEX IF EXISTS coord.ix_computers_parent_computer_id")
    op.execute("DROP TABLE IF EXISTS coord.computers")
