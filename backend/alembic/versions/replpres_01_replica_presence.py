"""coord.replica_presence — per-replica liveness written on the DEDICATED lease pool

Revision ID: replpres_01
Revises: memseq_01
Create Date: 2026-08-19

Phase W1 of plan
``2026-08-11-wedged-follower-indistinguishable-from-departed-replica``.

Why this table exists
=====================

``worker_ledger::rollup()`` gates every irreversible, worker-liveness-derived
lever on ``worst_replica_rolled_off``. That gate has to separate two states
that are byte-identical in ``coord.worker_heartbeats`` and demand OPPOSITE
remedies:

* **Deploy roll** — the process exited. Nothing to restart; a bounce is noise.
* **Shared-pool exhaustion** — the process is ALIVE and wedged. The merge train
  is frozen and a bounce IS the remedy.

The discriminator coord already has is the ``coord.leader_lease`` holder, and
it works — *for the leader only*. A wedged **leader** keeps its lease, because
the election loop runs on a dedicated tiny PG pool built precisely so
leadership survives ``state.pg`` exhaustion. A wedged **follower** holds no
lease, so it is indistinguishable from a departed replica: its heartbeat rows
age into ``stale``/``dead``, the healthy leader satisfies the "holder is still
writing this worker" conjunct, and the verdict is written off as a deploy roll
— withholding the bounce from a live process that is running nothing.

Every fact that gate reads is written through ``state.pg``
(``worker_ledger::write_row``, ``load_lease_holder``), so shared-pool
exhaustion silences exactly the evidence that would prove the process alive.
Adding another ``state.pg`` signal cannot work: it is wedged too, by
construction. The signal that CAN answer it is the election loop, which
already runs on every replica on the dedicated pool — it just never persists
anything when it loses. This table is that persisted trace.

Columns
=======

``replica_id``
    The per-boot identity. It is the SAME value as
    ``coord.worker_heartbeats.replica_id`` and ``coord.leader_lease.holder_id``
    — coord derives all three from ``LeaderHandle::holder_id()`` — so joining
    presence to the ledger needs no mapping table.

``heartbeat_at``
    Advanced every election cadence (``COORD_LEADER_HEARTBEAT_SECS``, default
    5s). A row is read as *stale* once its age exceeds the lease TTL
    (``COORD_LEADER_TTL_SECS``, default 15s) — the same bound that already
    defines an expired lease, giving three writes of headroom per bound so a
    single missed tick cannot flip a live follower to "departed".

``boot_at``
    When this replica's process started. NOT a reuse guard —
    ``replica_id`` is a per-boot ``Uuid::new_v4()`` and is never reused. It
    buys a truthful uptime for the ``coord_query_workers`` drill-down and a
    second axis for the retention sweep.

``dedicated_pool``
    **The load-bearing one.** ``leader.rs`` degrades gracefully to the shared
    ``state.pg`` pool when the dedicated lease pool cannot be built (DSN
    unreadable, RDS cold). Presence written on the shared pool dies with the
    very thing it is meant to be independent of, so it is NOT trustworthy —
    and the consumer reads a fleet-wide table about OTHER replicas, so that
    fact cannot be communicated in-process. It has to be a column.

    Both alternatives fail in the UNSAFE direction. A degraded replica that
    writes nothing reads as absent → DEPARTED → the gate fires and the lever
    is withheld from a possibly-wedged process. One that writes on the shared
    pool unmarked reads identically once the pool wedges. Marked, the consumer
    reads it as UNKNOWN, and UNKNOWN never licenses withholding a remedy.

Retention lives in coord, not here
==================================

Rows are per-boot and every redeploy mints new ids, so this table grows
without bound. Alembic authors schema and nothing else — a migration cannot
sweep continuously — so the deletion loop is coord code (Phase C1), mirroring
``prune_progress_samples``. What belongs here is the index that keeps that
sweep off a full scan. It is a speed-up, not a correctness dependency: the
delete works (just slower) without it, so coord may deploy ahead of this
migration, exactly as the ``gate_progress_samples`` prune documents.

Deploy ordering
===============

Alembic is the sole author of ``coord.*`` schema, and a coord read of a new
``coord.*`` object needs its qontinui-web migration to land AND BE APPLIED in
prod first (the 2026-07-13 missing-column incident). Coord's consumer degrades
to UNKNOWN on a missing table rather than erroring, but that is a safety net,
not a licence to invert the order.
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "replpres_01"
down_revision: str | Sequence[str] | None = "memseq_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "replica_presence",
        # Per-boot replica identity — the same value coord writes into
        # coord.worker_heartbeats.replica_id and coord.leader_lease.holder_id.
        # One row per replica, upserted on the election cadence, so the PK is
        # the identity itself rather than a surrogate.
        sa.Column("replica_id", postgresql.UUID(as_uuid=True), primary_key=True),
        # Advanced every election tick, win or lose. Written with the SERVER's
        # now() so a replica with a skewed clock cannot forge freshness.
        sa.Column("heartbeat_at", sa.DateTime(timezone=True), nullable=False),
        # Process start. Immutable for the life of the row.
        sa.Column("boot_at", sa.DateTime(timezone=True), nullable=False),
        # false = written on the DEGRADED shared pool; the consumer must read
        # such a row as UNKNOWN, never as evidence the replica is alive. No
        # server_default: a writer that cannot state which pool it used must
        # fail loudly rather than inherit an optimistic default.
        sa.Column("dedicated_pool", sa.Boolean(), nullable=False),
        schema="coord",
    )
    # Supports coord's retention sweep (DELETE ... WHERE heartbeat_at < ...).
    # Advisory, not load-bearing — see the module docstring.
    op.create_index(
        "replica_presence_heartbeat_at_idx",
        "replica_presence",
        ["heartbeat_at"],
        schema="coord",
    )


def downgrade() -> None:
    op.drop_index(
        "replica_presence_heartbeat_at_idx",
        table_name="replica_presence",
        schema="coord",
    )
    op.drop_table("replica_presence", schema="coord")
