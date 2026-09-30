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

1. Creates ``coord.computers``: one row per physical or virtual machine, keyed
   by coord-minted ``computer_id`` and identified by ``identity_hash`` — the
   lowercase hex HMAC-SHA256 of the raw OS machine id under the fixed key
   ``qontinui-computer-identity-v1``, so no raw machine id is ever stored. The
   CHECK pins the 64-lowercase-hex shape, so a raw id (or an uppercase digest,
   which would silently mint a second row for the same machine) is refused.
   ``kind`` is CHECKed to ``host | wsl_guest | container | vm``;
   ``parent_computer_id`` links a WSL guest to its Windows host and is SET NULL
   when the host row goes.
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
4. Adds ``coord.devices.computer_id`` (FK, SET NULL, indexed): which computer a
   runner install runs on. Written by coord at report time from the device
   that posted the report (``attach_device``).
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
revision writes no rows. A hand-mapped backfill of ``devices.computer_id`` would
publish tenant hostnames in an open-source tree and would have no
``identity_hash`` to key on (nothing reports one until Phase 2). Coord attaches
the column at report time instead. Consumers read NULL as UNKNOWN — never as
zero, never as healthy, and never as "no computer".

Lock posture
============

The two ALTERs on existing tables take a brief ACCESS EXCLUSIVE lock (nullable
columns with no default are a catalogue update, no rewrite); a 3s
``lock_timeout`` makes them fail fast rather than queue in front of every reader
of the hot sample table. The sample-table index is built ``CONCURRENTLY`` inside
``autocommit_block()`` (the posture of ``twin_10_served_bundle_target_columns``),
repairing an INVALID leftover of a failed earlier build. ``coord.devices`` is
small, so its index is built in-transaction.

Every SQL string is a static literal: the coord merge-train migration classifier
extracts literals from each execute call and treats a call with none as dynamic.
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
    """Create the three computer tables and attach devices and samples to them."""
    op.execute("CREATE SCHEMA IF NOT EXISTS coord")

    # 1. The machine itself.
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.computers (
            computer_id           UUID        NOT NULL DEFAULT gen_random_uuid(),
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
            CONSTRAINT uq_computers_identity_hash UNIQUE (identity_hash),
            CONSTRAINT ck_computers_identity_hash
                CHECK (identity_hash ~ '^[0-9a-f]{64}$'),
            CONSTRAINT ck_computers_kind
                CHECK (kind IN ('host', 'wsl_guest', 'container', 'vm')),
            CONSTRAINT fk_computers_parent_computer_id
                FOREIGN KEY (parent_computer_id)
                REFERENCES coord.computers (computer_id) ON DELETE SET NULL
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_computers_parent_computer_id
            ON coord.computers (parent_computer_id)
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
            'One row per physical or virtual machine. identity_hash is the lowercase hex HMAC-SHA256 of the raw OS machine id under the key qontinui-computer-identity-v1; the raw id is never stored. Written by coord POST /coord/computers/report. Plan 2026-09-30-the-fleet-machine-is-not-a-first-class-coord-entity-and-coord-has-no-resource-model.'
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
            'Latest snapshot of each watched service unit per computer. A full snapshot report deletes rows for units it does not list; a delta report upserts only. runner_name joins a unit to the CI runner registrar.'
        """
    )
    op.execute(
        """
        COMMENT ON TABLE coord.computer_events IS
            'Append-only per-computer events. UNIQUE (computer_id, client_event_id) is the dedup key a report retry relies on. 30-day retention enforced by coord.'
        """
    )

    # 4 and 5. Attach existing tables. Fail fast on the lock rather than queue.
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute(
        """
        ALTER TABLE coord.devices
            ADD COLUMN IF NOT EXISTS computer_id UUID
                CONSTRAINT fk_devices_computer_id
                REFERENCES coord.computers (computer_id) ON DELETE SET NULL
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_devices_computer_id
            ON coord.devices (computer_id)
            WHERE computer_id IS NOT NULL
        """
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
            'The computer this sample was measured on, stamped by coord from coord.devices.computer_id of the posting device. NULL = UNKNOWN (device not yet attached). Deliberately no FK: hot append-only table.'
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
    # Hand the next revision in this transaction the lock bound it expects.
    op.execute("SET LOCAL lock_timeout = DEFAULT")

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
    with op.get_context().autocommit_block():
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS "
            "coord.ix_device_resource_samples_computer_sampled"
        )
    op.execute("SET LOCAL lock_timeout = '3s'")
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
    op.execute("DROP INDEX IF EXISTS coord.ix_devices_computer_id")
    # Dropping the column drops fk_devices_computer_id with it.
    op.execute("ALTER TABLE coord.devices DROP COLUMN IF EXISTS computer_id")
    op.execute("SET LOCAL lock_timeout = DEFAULT")
    op.execute("DROP INDEX IF EXISTS coord.ix_computer_events_observed_at")
    op.execute("DROP INDEX IF EXISTS coord.ix_computer_events_computer_observed")
    op.execute("DROP TABLE IF EXISTS coord.computer_events")
    op.execute("DROP INDEX IF EXISTS coord.ix_computer_services_runner_name")
    op.execute("DROP TABLE IF EXISTS coord.computer_services")
    op.execute("DROP INDEX IF EXISTS coord.ix_computers_parent_computer_id")
    op.execute("DROP TABLE IF EXISTS coord.computers")
