"""unify coord.machines + auth.runners into coord.devices

Revision ID: ud01_unify_devices_registry
Revises: rp02_merge_heads
Create Date: 2026-05-18

Phase 1 of plan ``D:/qontinui-root/plans/2026-05-18-unified-devices-registry.md``.

Consolidates two parallel device registries into a single unified table
``coord.devices``:

1. ``coord.machines``  — coord-side fleet liveness + capacity registry.
2. ``auth.runners``    — web-side user-paired runner registry (enriched
   over time with WS-session, derived_status, ui_error, recent_crash,
   restate, os/os_version, last_heartbeat, capabilities columns).

The two registries serve overlapping concerns: both identify a runner
host, both store hostname/os, both gate on liveness. Keeping them
separate forces an N-times-rewrite penalty on every fleet feature
(boundary doc + StrategyClient + dual-FK joins). This migration replaces
both with a single ``coord.devices`` keyed by ``device_id``, carrying
``capability_*`` flags so a device can play multiple roles
(coord-scheduled target AND user-paired runner).

Schema rationale
================

* ``device_id UUID PRIMARY KEY`` — replaces ``coord.machines.machine_id``
  and ``auth.runners.id``. When the two registries overlap (same host),
  we preserve the ``coord.machines.machine_id`` because it is referenced
  by 5 inbound FK constraints (see below). The ``auth.runners.id`` →
  ``device_id`` remap is recorded in a side table
  ``_devices_migration_remap`` for post-cutover reconciliation; that
  side table can be dropped after Phase 8 verifies no straggler.
* ``user_id UUID`` — NEW; absorbed from ``auth.runners.user_id``. NULL
  for coord-only "system devices" registered before any user pairing.
* Capability flags (``capability_coord_target``,
  ``capability_user_paired``, ``capability_web_controlled``,
  ``capabilities JSONB``) — additive; a device can be coord-managed AND
  user-paired simultaneously. Drives the gate-out behaviour of the
  ``/coord/fleet/state`` (capability_coord_target=true) and
  ``/api/v1/runners`` (capability_user_paired=true) endpoints.
* Liveness columns (``state``, ``state_changed_at``, ``health_url``,
  ``last_probe_at``, ``last_probe_ok``, ``consecutive_failures``) —
  from ``coord.machines`` Row 9 Phase 3.
* Derived-status columns (``derived_status``, ``ui_error``,
  ``recent_crash``, ``restate_enabled``, ``restate_healthy``,
  ``ws_session_id``, ``ws_connected_at``) — from ``auth.runners``
  Phase 8 redo + Phase 3J.
* Capacity columns (``role``, ``cpu_cores``, ``memory_gb``,
  ``disk_*_gb``, ``max_concurrent_*``, ``budget_updated_at``) — from
  ``coord.machines`` Fleet Phase 1 budget.

Inbound FK rewires
==================

The empirical inbound-FK count to ``coord.machines.machine_id`` on
origin/main as of plan-vet (2026-05-18) is **5 FKs** (not the plan's
hand-counted "7"; the vet stamp's pg_constraint probe is authoritative):

* ``coord.claims_audit.machine_id``       ON DELETE SET NULL
* ``coord.repo_branches.head_author_machine``  ON DELETE SET NULL
* ``coord.events.machine_id``             ON DELETE SET NULL
* ``coord.agent_worktrees.machine_id``    ON DELETE SET NULL
* ``coord.build_events.machine_id``       ON DELETE CASCADE
* ``coord.machine_status.machine_id``     ON DELETE CASCADE
* ``coord.correlation_topics.created_by_machine_id``  ON DELETE SET NULL

Plus one non-FK column rename (no constraint to drop; preserves
delete-doesn't-cascade alerts):

* ``coord.alerts.machine_id``             non-FK; rename column only.

And one cross-schema rename + table relocation:

* ``auth.runner_sessions``                → ``coord.device_connections``
  (preserves the CASCADE FK; column ``runner_id`` → ``device_id``).
  Name resolved per operator decision 2026-05-18 (plan §3.2 Path α);
  avoids the ``auth.device_sessions`` Python-class collision.

Multi-head note
===============

Plan named two heads ``p2q3r4s5t6u7`` and ``v8w9x0y1z2a3`` at draft
time. Empirical re-verification at impl time (per
``feedback_verify_origin_state_before_phase_start``) showed both
heads had already been merged on origin/main by ``rp02_merge_heads``
(the Phase 4 recording-pipeline PR's sibling-head merge revision).
This revision therefore parents off ``rp02_merge_heads`` directly; no
separate ``wave_8_01_merge_heads`` is needed.

Downgrade
=========

**Irreversible.** Per operator pre-resolved decision "Backward compat
is not a factor" — this is a flag-day migration. Recovery from a bad
upgrade is restore-from-snapshot, not ``alembic downgrade``. The
``downgrade()`` body raises to make this explicit.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "ud01_unify_devices_registry"
down_revision: str = "rp02_merge_heads"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# Allowed liveness state values — keep in sync with the coord-side
# ``MachineState`` enum (``qontinui-coord/src/machine_state.rs``) which
# Phase 2 of this plan renames to ``DeviceState``.
_STATES = ("healthy", "degraded", "partitioned", "abandoned")


def upgrade() -> None:
    # ------------------------------------------------------------------
    # Step 1 — create coord.devices
    # ------------------------------------------------------------------
    op.create_table(
        "devices",
        # Identity
        sa.Column(
            "device_id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("auth.users.id", ondelete="SET NULL"),
            nullable=True,
            comment=(
                "Owning user when paired; NULL for system devices "
                "(coord-only registration)."
            ),
        ),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("hostname", sa.Text(), nullable=False),
        sa.Column("os", sa.Text(), nullable=True),
        sa.Column("os_version", sa.Text(), nullable=True),
        sa.Column("port", sa.Integer(), nullable=True),
        # Capability flags (additive)
        sa.Column(
            "capability_coord_target",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column(
            "capability_user_paired",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column(
            "capability_web_controlled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column(
            "capabilities",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        # Liveness (Row 9 Phase 3 — from coord.machines)
        sa.Column(
            "state",
            sa.Text(),
            nullable=False,
            server_default=sa.text("'healthy'"),
        ),
        sa.Column(
            "state_changed_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("health_url", sa.Text(), nullable=True),
        sa.Column("last_probe_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_probe_ok", sa.Boolean(), nullable=True),
        sa.Column(
            "consecutive_failures",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
        # Runner-side derived status (from auth.runners)
        sa.Column(
            "derived_status",
            sa.Text(),
            nullable=False,
            server_default=sa.text("'offline'"),
        ),
        sa.Column(
            "ui_error",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
        sa.Column(
            "recent_crash",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
        sa.Column(
            "restate_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column(
            "restate_healthy",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        # WS connection state (from auth.runners)
        sa.Column("ws_session_id", sa.BigInteger(), nullable=True),
        sa.Column(
            "ws_connected_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
        # Capacity (Fleet Phase 1 budget cols — from coord.machines)
        sa.Column("role", sa.Text(), nullable=True),
        sa.Column("cpu_cores", sa.Integer(), nullable=True),
        sa.Column("memory_gb", sa.Integer(), nullable=True),
        # NOTE: live ``coord.machines.disk_total_gb`` is BIGINT and
        # ``disk_reserved_gb`` is BIGINT NOT NULL DEFAULT 0. Preserve
        # types so the data migration is lossless.
        sa.Column("disk_total_gb", sa.BigInteger(), nullable=True),
        sa.Column(
            "disk_reserved_gb",
            sa.BigInteger(),
            nullable=False,
            server_default=sa.text("0"),
        ),
        sa.Column("max_concurrent_agents", sa.Integer(), nullable=True),
        sa.Column("max_concurrent_builds", sa.Integer(), nullable=True),
        sa.Column(
            "budget_updated_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
        # Audit
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_heartbeat", sa.DateTime(timezone=True), nullable=True),
        sa.Column("paired_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_ip_address", sa.Text(), nullable=True),
        sa.Column("last_user_agent", sa.Text(), nullable=True),
        # Constraints
        sa.CheckConstraint(
            "state IN ('healthy','degraded','partitioned','abandoned')",
            name="devices_state_chk",
        ),
        # ``role`` CHECK mirrors the existing ``machines_role_chk`` on
        # ``coord.machines``: {agent, build, cache, coord}. The plan's
        # draft listed {agent, builder, observer} — that's the future
        # naming Phase 2 may consider, but rolling it in here would
        # reject every row migrated from ``coord.machines``. Keep parity
        # with the live constraint on origin/main; Phase 2 can widen or
        # remap if it chooses.
        sa.CheckConstraint(
            "role IS NULL OR role IN ('agent','build','cache','coord')",
            name="devices_role_chk",
        ),
        schema="coord",
    )

    # Indexes per plan §"Target schema"
    op.create_index(
        "devices_hostname_idx",
        "devices",
        ["hostname"],
        schema="coord",
    )
    op.create_index(
        "devices_user_id_idx",
        "devices",
        ["user_id"],
        schema="coord",
        postgresql_where=sa.text("user_id IS NOT NULL"),
    )
    op.create_index(
        "devices_state_idx",
        "devices",
        ["state"],
        schema="coord",
    )
    op.create_index(
        "devices_user_paired_idx",
        "devices",
        ["user_id", "capability_user_paired"],
        schema="coord",
        postgresql_where=sa.text("capability_user_paired = true"),
    )
    op.create_index(
        "devices_last_heartbeat_idx",
        "devices",
        ["last_heartbeat"],
        schema="coord",
    )

    # ------------------------------------------------------------------
    # Step 2 — remap side-table for cross-registry identity reconciliation
    # ------------------------------------------------------------------
    # ``coord.machines.machine_id`` and ``auth.runners.id`` are
    # independently-generated UUIDs today; the same host (hostname match)
    # carries TWO UUIDs. We preserve ``coord.machines.machine_id`` (it's
    # referenced by 5 inbound FKs); ``auth.runners.id`` is mapped to that
    # ``device_id`` for any post-cutover legacy lookups.
    op.create_table(
        "_devices_migration_remap",
        sa.Column(
            "legacy_runner_id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
        ),
        sa.Column(
            "device_id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
        ),
        sa.Column(
            "remapped_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "note",
            sa.Text(),
            nullable=True,
            comment=(
                "Reason this row exists — 'hostname_match_prefer_machine_id', "
                "'no_machine_row_use_runner_id', etc."
            ),
        ),
        schema="coord",
    )

    # ------------------------------------------------------------------
    # Step 3 — populate coord.devices from coord.machines (coord-side
    # liveness + budget cols), capability_coord_target=true
    # ------------------------------------------------------------------
    op.execute(
        """
        INSERT INTO coord.devices (
            device_id,
            name,
            hostname,
            capability_coord_target,
            state, state_changed_at,
            health_url, last_probe_at, last_probe_ok, consecutive_failures,
            role, cpu_cores, memory_gb,
            disk_total_gb, disk_reserved_gb,
            max_concurrent_agents, max_concurrent_builds,
            budget_updated_at,
            created_at, last_seen_at
        )
        SELECT
            machine_id          AS device_id,
            hostname            AS name,
            hostname,
            true                AS capability_coord_target,
            state, state_changed_at,
            health_url, last_probe_at, last_probe_ok,
            consecutive_failed_probes,
            role, cpu_cores, memory_gb,
            disk_total_gb, disk_reserved_gb,
            max_concurrent_agents, max_concurrent_builds,
            budget_updated_at,
            created_at, last_seen_at
        FROM coord.machines
        """
    )

    # ------------------------------------------------------------------
    # Step 4 — merge auth.runners rows. Identity-merge policy:
    #
    # 4a — if a coord.devices row already exists at the same hostname,
    #      update-in-place (set user_id + user-paired columns + record
    #      the auth.runners.id → device_id remap).
    # 4b — otherwise insert a new coord.devices row with capability_
    #      coord_target=false, capability_user_paired=true.
    # ------------------------------------------------------------------

    # 4a: existing-by-hostname → record remap, then update.
    #
    # ``DISTINCT ON (hostname)`` collapses any multi-runner-per-host rows
    # into a single deterministic pick (most-recent paired). The
    # remap-table INSERT happens BEFORE the UPDATE to make the audit
    # trail durable even if the UPDATE is later reverted by a snapshot
    # rollback.

    # Record the auth.runners.id → device_id remap for hostname-matched rows.
    op.execute(
        """
        INSERT INTO coord._devices_migration_remap (
            legacy_runner_id, device_id, note
        )
        SELECT DISTINCT ON (r.hostname)
            r.id          AS legacy_runner_id,
            d.device_id   AS device_id,
            'hostname_match_prefer_machine_id' AS note
        FROM auth.runners r
        INNER JOIN coord.devices d ON d.hostname = r.hostname
        ORDER BY r.hostname,
                 r.last_heartbeat DESC NULLS LAST,
                 r.created_at DESC
        """
    )

    # UPDATE the existing coord.devices row with the auth.runners enrichment.
    op.execute(
        """
        UPDATE coord.devices d
        SET
            user_id              = src.user_id,
            name                 = src.name,
            os                   = COALESCE(d.os, src.os),
            os_version           = COALESCE(d.os_version, src.os_version),
            port                 = COALESCE(d.port, src.port),
            capability_user_paired = true,
            capabilities         = src.capabilities,
            derived_status       = COALESCE(src.derived_status, d.derived_status),
            ui_error             = src.ui_error,
            recent_crash         = src.recent_crash,
            restate_enabled      = src.restate_enabled,
            restate_healthy      = src.restate_healthy,
            ws_session_id        = src.ws_session_id,
            ws_connected_at      = src.ws_connected_at,
            last_heartbeat       = src.last_heartbeat,
            paired_at            = src.r_created_at
        FROM (
            SELECT DISTINCT ON (r.hostname)
                r.hostname,
                r.user_id, r.name, r.os, r.os_version, r.port,
                r.capabilities,
                r.derived_status, r.ui_error, r.recent_crash,
                r.restate_enabled, r.restate_healthy,
                r.ws_session_id, r.ws_connected_at,
                r.last_heartbeat,
                r.created_at AS r_created_at
            FROM auth.runners r
            ORDER BY r.hostname,
                     r.last_heartbeat DESC NULLS LAST,
                     r.created_at DESC
        ) AS src
        WHERE d.hostname = src.hostname
        """
    )

    # 4b: orphan-by-hostname auth.runners → INSERT a brand-new
    # coord.devices row (capability_user_paired=true,
    # capability_coord_target=false).
    op.execute(
        """
        WITH orphans AS (
            SELECT
                r.id AS device_id,
                r.user_id, r.name, r.hostname, r.os, r.os_version, r.port,
                r.capabilities,
                r.derived_status, r.ui_error, r.recent_crash,
                r.restate_enabled, r.restate_healthy,
                r.ws_session_id, r.ws_connected_at,
                r.last_heartbeat,
                r.created_at
            FROM auth.runners r
            LEFT JOIN coord.devices d ON d.hostname = r.hostname
            WHERE d.device_id IS NULL
        )
        INSERT INTO coord.devices (
            device_id,
            user_id, name, hostname, os, os_version, port,
            capability_coord_target, capability_user_paired,
            capabilities,
            derived_status, ui_error, recent_crash,
            restate_enabled, restate_healthy,
            ws_session_id, ws_connected_at,
            last_heartbeat, paired_at,
            state, state_changed_at,
            created_at
        )
        SELECT
            device_id,
            user_id, name, hostname, os, os_version, port,
            false, true,
            capabilities,
            COALESCE(derived_status, 'offline'),
            ui_error, recent_crash,
            restate_enabled, restate_healthy,
            ws_session_id, ws_connected_at,
            last_heartbeat, created_at,
            'healthy', now(),
            created_at
        FROM orphans
        """
    )

    # Record the orphan-mapping in the remap side-table for completeness
    # (legacy_runner_id == device_id in this branch — the runner UUID
    # survives because no coord.machines row pre-existed).
    op.execute(
        """
        INSERT INTO coord._devices_migration_remap (
            legacy_runner_id, device_id, note
        )
        SELECT
            r.id,
            r.id,
            'no_machine_row_use_runner_id'
        FROM auth.runners r
        LEFT JOIN coord._devices_migration_remap rm
            ON rm.legacy_runner_id = r.id
        WHERE rm.legacy_runner_id IS NULL
        """
    )

    # ------------------------------------------------------------------
    # Step 5 — Rewire 5 inbound FKs (coord.machines → coord.devices).
    # Pattern per table: RENAME COLUMN; DROP CONSTRAINT (auto-named per
    # `<table>_<column>_fkey`); ADD CONSTRAINT pointing at coord.devices.
    # ``RENAME COLUMN`` preserves the FK auto-rename only when target is
    # unchanged; we're swapping the target, so the explicit DROP/ADD is
    # required.
    # ------------------------------------------------------------------

    # coord.claims_audit.machine_id  ON DELETE SET NULL
    op.execute(
        "ALTER TABLE coord.claims_audit "
        "RENAME COLUMN machine_id TO device_id"
    )
    op.execute(
        "ALTER TABLE coord.claims_audit "
        "DROP CONSTRAINT IF EXISTS claims_audit_machine_id_fkey"
    )
    op.create_foreign_key(
        "claims_audit_device_id_fkey",
        "claims_audit",
        "devices",
        ["device_id"],
        ["device_id"],
        source_schema="coord",
        referent_schema="coord",
        ondelete="SET NULL",
    )

    # coord.repo_branches.head_author_machine  ON DELETE SET NULL
    op.execute(
        "ALTER TABLE coord.repo_branches "
        "RENAME COLUMN head_author_machine TO head_author_device"
    )
    op.execute(
        "ALTER TABLE coord.repo_branches "
        "DROP CONSTRAINT IF EXISTS repo_branches_head_author_machine_fkey"
    )
    op.create_foreign_key(
        "repo_branches_head_author_device_fkey",
        "repo_branches",
        "devices",
        ["head_author_device"],
        ["device_id"],
        source_schema="coord",
        referent_schema="coord",
        ondelete="SET NULL",
    )

    # coord.events.machine_id  ON DELETE SET NULL
    op.execute(
        "ALTER TABLE coord.events "
        "RENAME COLUMN machine_id TO device_id"
    )
    op.execute(
        "ALTER TABLE coord.events "
        "DROP CONSTRAINT IF EXISTS events_machine_id_fkey"
    )
    op.create_foreign_key(
        "events_device_id_fkey",
        "events",
        "devices",
        ["device_id"],
        ["device_id"],
        source_schema="coord",
        referent_schema="coord",
        ondelete="SET NULL",
    )

    # coord.agent_worktrees.machine_id  ON DELETE SET NULL
    op.execute(
        "ALTER TABLE coord.agent_worktrees "
        "RENAME COLUMN machine_id TO device_id"
    )
    op.execute(
        "ALTER TABLE coord.agent_worktrees "
        "DROP CONSTRAINT IF EXISTS agent_worktrees_machine_id_fkey"
    )
    op.create_foreign_key(
        "agent_worktrees_device_id_fkey",
        "agent_worktrees",
        "devices",
        ["device_id"],
        ["device_id"],
        source_schema="coord",
        referent_schema="coord",
        ondelete="SET NULL",
    )

    # coord.build_events.machine_id  ON DELETE CASCADE
    op.execute(
        "ALTER TABLE coord.build_events "
        "RENAME COLUMN machine_id TO device_id"
    )
    op.execute(
        "ALTER TABLE coord.build_events "
        "DROP CONSTRAINT IF EXISTS build_events_machine_id_fkey"
    )
    op.create_foreign_key(
        "build_events_device_id_fkey",
        "build_events",
        "devices",
        ["device_id"],
        ["device_id"],
        source_schema="coord",
        referent_schema="coord",
        ondelete="CASCADE",
    )

    # coord.machine_status.machine_id  ON DELETE CASCADE
    # NOTE: machine_status is also being relocated to coord.device_status
    # for naming consistency; coord-side code references unify the rename
    # in Phase 2.
    op.execute(
        "ALTER TABLE coord.machine_status "
        "RENAME COLUMN machine_id TO device_id"
    )
    op.execute(
        "ALTER TABLE coord.machine_status "
        "DROP CONSTRAINT IF EXISTS machine_status_machine_id_fkey"
    )
    op.execute(
        "ALTER TABLE coord.machine_status RENAME TO device_status"
    )
    op.create_foreign_key(
        "device_status_device_id_fkey",
        "device_status",
        "devices",
        ["device_id"],
        ["device_id"],
        source_schema="coord",
        referent_schema="coord",
        ondelete="CASCADE",
    )

    # coord.correlation_topics.created_by_machine_id  ON DELETE SET NULL
    op.execute(
        "ALTER TABLE coord.correlation_topics "
        "RENAME COLUMN created_by_machine_id TO created_by_device_id"
    )
    op.execute(
        "ALTER TABLE coord.correlation_topics "
        "DROP CONSTRAINT IF EXISTS correlation_topics_created_by_machine_id_fkey"
    )
    op.create_foreign_key(
        "correlation_topics_created_by_device_id_fkey",
        "correlation_topics",
        "devices",
        ["created_by_device_id"],
        ["device_id"],
        source_schema="coord",
        referent_schema="coord",
        ondelete="SET NULL",
    )

    # ------------------------------------------------------------------
    # Step 6 — coord.alerts.machine_id non-FK column rename
    # ------------------------------------------------------------------
    # Deliberately non-FK (verified on origin/main by Rust-source scan
    # in plan vet-pass) — preserves delete-doesn't-cascade alerts so
    # an alert outlives the device it concerns.
    op.execute(
        "ALTER TABLE coord.alerts "
        "RENAME COLUMN machine_id TO device_id"
    )

    # ------------------------------------------------------------------
    # Step 7 — relocate auth.runner_sessions → coord.device_connections
    # ------------------------------------------------------------------
    # Per plan: SCHEMA move + column rename. FK CASCADE preserved by
    # ALTER COLUMN RENAME + explicit FK swap to coord.devices.
    #
    # Name decision (operator-arbitrated 2026-05-18, plan §3.2 Path α):
    # the renamed table lands as ``coord.device_connections`` (NOT
    # ``coord.device_sessions``) for two reasons:
    #
    # 1. **Semantic accuracy.** The rows track WebSocket connection
    #    lifecycle (``ws_connected_at`` → disconnect events), not
    #    application sessions. "Connection" is the more accurate noun.
    #
    # 2. **Python collision avoidance.** ``auth.device_sessions``
    #    already exists for user-device fingerprinting (login detection,
    #    distinct domain). While the TABLE rename is safe under schema
    #    qualification, the Python class/file name ``DeviceSession`` /
    #    ``device_session.py`` would collide. The operator's "clean
    #    code" priority favored a distinct name (``DeviceConnection`` /
    #    ``device_connection.py``) over the schema-only hack.

    # Step 7a — apply the device-id remap to runner_sessions before
    # the column rename. Multiple ``auth.runners`` rows on the same
    # hostname collapsed into a single ``coord.devices`` row (the
    # ``hostname_match_prefer_machine_id`` strategy in Step 2); the
    # losing UUIDs are recorded in ``coord._devices_migration_remap``
    # (schema ``coord``, columns ``legacy_runner_id`` -> ``device_id``).
    # Without this UPDATE those session rows still carry the LOSING
    # runner UUIDs in ``runner_id``, and the FK creation in Step 7e
    # fails with ForeignKeyViolation because those UUIDs are not in
    # ``coord.devices``.
    #
    # Empirical case that surfaced this on the 2026-05-18 canonical-PG
    # run: 7 ``auth.runners`` on hostname ``spaceship`` collapsed to a
    # single ``coord.devices`` row; the other 6 runners' sessions
    # orphaned. The original ad-hoc workaround was
    # ``TRUNCATE auth.runner_sessions CASCADE`` (lost 205 dev sessions
    # + 9 dependent test tables). This step is the proper fix —
    # follow-up to task #31.
    op.execute(
        "UPDATE auth.runner_sessions rs "
        "SET runner_id = m.device_id "
        "FROM coord._devices_migration_remap m "
        "WHERE m.legacy_runner_id = rs.runner_id"
    )

    # Step 7b — delete sessions whose runner has no surviving device.
    # These are rows from ``auth.runners`` IDs that never matched any
    # ``coord.machines`` hostname AND were not collapsed via remap —
    # fully orphaned. Keeping them would violate the FK created in
    # Step 7e. Bias: drop the session, keep the migration green. A
    # stranded device that later re-registers via the hostname path
    # gets re-paired with a fresh session.
    op.execute(
        "DELETE FROM auth.runner_sessions "
        "WHERE runner_id NOT IN (SELECT device_id FROM coord.devices)"
    )

    # Step 7c — rename column runner_id → device_id.
    op.execute(
        "ALTER TABLE auth.runner_sessions "
        "RENAME COLUMN runner_id TO device_id"
    )
    # Step 7d — drop the old FK to auth.runners.
    op.execute(
        "ALTER TABLE auth.runner_sessions "
        "DROP CONSTRAINT IF EXISTS runner_sessions_runner_id_fkey"
    )
    # Step 7e — relocate to coord schema, rename, attach the new FK.
    # Steps 7a+7b ensured every device_id is present in coord.devices,
    # so the FK creation no longer fails.
    op.execute(
        "ALTER TABLE auth.runner_sessions SET SCHEMA coord"
    )
    op.execute(
        "ALTER TABLE coord.runner_sessions RENAME TO device_connections"
    )
    op.create_foreign_key(
        "device_connections_device_id_fkey",
        "device_connections",
        "devices",
        ["device_id"],
        ["device_id"],
        source_schema="coord",
        referent_schema="coord",
        ondelete="CASCADE",
    )

    # ------------------------------------------------------------------
    # Step 8 — drop the retired tables
    # ------------------------------------------------------------------
    # ``coord.machines`` and ``auth.runners`` are fully drained at this
    # point — every FK has been rewired, every row migrated. DROP CASCADE
    # would be wrong (it would silently drop dependent objects); we want
    # the DROP to fail-fast if any FK still references either table.
    op.execute("DROP TABLE coord.machines")
    op.execute("DROP TABLE auth.runners")


def downgrade() -> None:
    """Irreversible by operator decree.

    Per plan's pre-resolved operator decision ("Backward compat is not
    a factor"), the unified-devices flag-day cutover is a one-way door.
    Recovery from a bad upgrade is restore-from-snapshot, not alembic
    downgrade. Surface the irreversibility explicitly rather than ship
    a partially-correct downgrade that an operator might trust.
    """
    raise NotImplementedError(
        "ud01_unify_devices_registry is irreversible by operator decree. "
        "Restore from PG snapshot to roll back; do NOT alembic downgrade."
    )


# Touch unused-symbol imports so linters don't complain.
_ = _STATES
