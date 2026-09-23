"""coord.device_connections — per-instance key, role, port and liveness per socket

Revision ID: devconn_inst_01_device_connections_instance
Revises: coord_agent_questions_withdrawn
Create Date: 2026-09-23

Phase 6 (web half) of plan
``2026-09-20-runner-selector-drives-a-transport-not-a-target``.

Why
===

Every runner instance on one machine — the primary on ``:9876`` and each
supervisor-spawned secondary on ``:9877-9899`` — presents the SAME machine
``device_id`` (qontinui-runner ``machine_identity.rs``), so they collapse into
one ``coord.devices`` row (plan reading A0.2 = ONE ROW). Before this revision
the web backend's registration wrote ``coord.devices.port`` and the relay
pointer ``coord.devices.ws_session_id`` from whichever instance connected LAST,
so a temp runner connecting silently took over the device's port AND its relay
socket.

``coord.device_connections`` already holds one row per socket, so that is where
the instance identity goes — one row per LIVE instance under the one device:

``instance_key TEXT NULL``
    The runner's namespaced per-instance key (``primary`` / ``runner:<id>`` /
    ``name:<name>`` / ``port:<port>``), reported top-level in ``runner_info``
    as ``instanceKey``. NULL for a runner that predates the field.
``instance_role TEXT NULL``
    ``primary`` | ``secondary`` — the EFFECTIVE role the backend registered
    the socket under (a legacy runner with no ``instanceRole`` is recorded as
    ``primary``). CHECK-constrained to the two values or NULL; NULL only on
    rows written before this revision.
``port INTEGER NULL``
    The instance's own HTTP API port. ``coord.devices.port`` stays the
    primary's; this column is the only place a secondary's port is kept.
``last_seen_at TIMESTAMPTZ NULL``
    Stamped on every heartbeat of every socket. A secondary that does not own
    the device's pointer has no other liveness record, so without it an open
    row orphaned by a backend crash would be indistinguishable from a live
    instance forever (a temp runner's key is never reused, so no reconnect
    would ever close it); the ``connection_cleanup`` sweep and the
    ``Runner.instances`` read age secondary rows by it. A heartbeat whose stamp
    finds its own row closed closes the socket so the runner re-registers.

Plus one partial UNIQUE index, ``(device_id, instance_key) WHERE
disconnected_at IS NULL AND instance_key IS NOT NULL``: two LIVE sockets on one
device reporting the same key are a conflict (the runner documents that two
processes that each believe themselves primary both report ``primary``), never
a silent overwrite. ``devices_ws.py`` decides the conflict (refuse the newcomer
when the holder answers a liveness probe, else close the holder's row with a
logged supersede); the index makes the database arbitrate the race two concurrent
handshakes would otherwise both win. Legacy (NULL-key) rows are outside it, so
an existing open row can never make this revision fail to build.

Coord does not read these columns (the wire ``Runner.instances`` is built by
the web backend from them), so there is no coord-side ordering constraint; any
future coord read must land after this revision (served policy
``production-and-cost`` ``alembic-sole-authorship``).

Locking. The column adds are catalog-only (nullable, no default). The two
CHECKs are added ``NOT VALID`` (a millisecond ``ACCESS EXCLUSIVE``, and they
enforce on new writes from that moment) and then ``VALIDATE``d in their own
autocommit transactions under ``SHARE UPDATE EXCLUSIVE``, which does not block
the device-socket writers; the partial unique index is built ``CONCURRENTLY``
in an ``autocommit_block`` — the repo convention (e.g.
``coord_alerts_pagedidx_01_paged_at_partial_index``,
``coord_tenant_fk_01_repair_missing_tenant_fks``). Raw SQL is plain literals so
the ``alembic-schema-arg-gate`` hook can read every schema-qualified name.

Every statement is idempotent (``IF NOT EXISTS`` / drop-then-add for the
constraints) so a partially applied pipeline run can be re-run. One caveat of
``CONCURRENTLY`` stated rather than hidden: a build interrupted mid-way leaves
an INVALID index that ``IF NOT EXISTS`` will not rebuild — drop it by hand and
re-run.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "devconn_inst_01_device_connections_instance"
# KEEP THIS ASSIGNMENT ON ONE LINE. Coord's alembic-graph parser (its mirror of
# this branch feeds deploy-coord.yml's drift gate) is line-scoped, so a
# formatter-wrapped `down_revision = (\n "..."\n)` yields no parent at all and
# counts as a second head — see plan_library_06_scan_root_slug_census.py.
down_revision: str | Sequence[str] | None = "coord_agent_questions_withdrawn"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Four nullable columns, two CHECKs (NOT VALID → VALIDATE), one index."""
    op.execute(
        "ALTER TABLE coord.device_connections "
        "ADD COLUMN IF NOT EXISTS instance_key TEXT NULL"
    )
    op.execute(
        "ALTER TABLE coord.device_connections "
        "ADD COLUMN IF NOT EXISTS instance_role TEXT NULL"
    )
    op.execute(
        "ALTER TABLE coord.device_connections ADD COLUMN IF NOT EXISTS port INTEGER NULL"
    )
    op.execute(
        "ALTER TABLE coord.device_connections "
        "ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ NULL"
    )

    op.execute(
        "ALTER TABLE coord.device_connections "
        "DROP CONSTRAINT IF EXISTS ck_device_connections_instance_role"
    )
    op.execute(
        "ALTER TABLE coord.device_connections "
        "ADD CONSTRAINT ck_device_connections_instance_role "
        "CHECK (instance_role IS NULL OR instance_role IN ('primary', 'secondary')) "
        "NOT VALID"
    )
    op.execute(
        "ALTER TABLE coord.device_connections "
        "DROP CONSTRAINT IF EXISTS ck_device_connections_port_range"
    )
    op.execute(
        "ALTER TABLE coord.device_connections "
        "ADD CONSTRAINT ck_device_connections_port_range "
        "CHECK (port IS NULL OR (port >= 0 AND port <= 65535)) NOT VALID"
    )

    with op.get_context().autocommit_block():
        op.execute(
            "ALTER TABLE coord.device_connections "
            "VALIDATE CONSTRAINT ck_device_connections_instance_role"
        )
        op.execute(
            "ALTER TABLE coord.device_connections "
            "VALIDATE CONSTRAINT ck_device_connections_port_range"
        )
        op.execute(
            """
            CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS
                uq_device_connections_live_instance_key
            ON coord.device_connections (device_id, instance_key)
            WHERE disconnected_at IS NULL AND instance_key IS NOT NULL
            """
        )


def downgrade() -> None:
    """Drop exactly what upgrade added. Nothing outside the web backend reads it."""
    with op.get_context().autocommit_block():
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS "
            "coord.uq_device_connections_live_instance_key"
        )
    op.execute(
        "ALTER TABLE coord.device_connections "
        "DROP CONSTRAINT IF EXISTS ck_device_connections_port_range"
    )
    op.execute(
        "ALTER TABLE coord.device_connections "
        "DROP CONSTRAINT IF EXISTS ck_device_connections_instance_role"
    )
    op.execute(
        "ALTER TABLE coord.device_connections DROP COLUMN IF EXISTS last_seen_at"
    )
    op.execute("ALTER TABLE coord.device_connections DROP COLUMN IF EXISTS port")
    op.execute(
        "ALTER TABLE coord.device_connections DROP COLUMN IF EXISTS instance_role"
    )
    op.execute(
        "ALTER TABLE coord.device_connections DROP COLUMN IF EXISTS instance_key"
    )
