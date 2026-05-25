"""coord.handoff_requests (Coord-Native Coordination MCP — Phase 4)

Revision ID: coord_handoff_requests
Revises: coord_agent_status
Create Date: 2026-05-24

Phase 4 (the active-negotiation layer) of plan
``D:/qontinui-root/qontinui-dev-notes/plans/2026-05-24-coord-native-coordination-mcp-plan.md``,
implementing a focused subset of the VETTED L3a design
(``plans/2026-05-14-active-agent-coordination-design.md`` §2C/§3.1/§3.2/§3.5).

Stands up ``coord.handoff_requests``: the durable wait-for graph that backs
the negotiation tools at ``POST /mcp`` (``coord_request_handoff`` /
``coord_yield`` / ``coord_declare_intent``). A *pending* row IS a wait-for
edge ``requester_device_id → holder_device_id``: requester A is blocked
waiting for holder B to yield ``work_unit_id``. The set of pending rows for
a tenant is a directed graph; a cycle in it is a deadlock, surfaced (not
silently refused — §3.5) via ``coord_orient``'s ``deadlock_warnings`` and
the ``coord_request_handoff`` response's ``deadlock_warning``.

Why PG-backed (not in-memory): the graph must survive coord restarts and be
consistent across HA replicas — every coord instance reads the same
canonical edge set from the shared RDS.

Schema (mirrors the Rust self-heal mirror EXACTLY — keep in lockstep):

* ``request_id UUID PK DEFAULT gen_random_uuid()`` — the request identity.
* ``tenant_id UUID NOT NULL``           — tenant scope, from the JWT. All
  graph loads + cycle detection are tenant-scoped on this column.
* ``work_unit_id TEXT NOT NULL``        — the contended work unit.
* ``requester_device_id UUID NOT NULL`` — device A (wants the work unit).
* ``holder_device_id UUID NOT NULL``    — device B (currently holds it).
* ``reason TEXT NOT NULL``              — free-text justification.
* ``status TEXT NOT NULL DEFAULT 'pending'`` — pending|granted|declined|expired.
  Only ``pending`` rows are live wait-for edges.
* ``created_at TIMESTAMPTZ``            — insertion (server clock).
* ``expires_at TIMESTAMPTZ NOT NULL``   — TTL backstop (§3.5 "all edges have
  a TTL"). The insert sets ``now() + interval '1 hour'``; the graph loads
  filter ``expires_at > now()`` so a stale request stops being an edge
  without a sweeper.
* ``resolved_at TIMESTAMPTZ``           — set when the row leaves ``pending``
  (granted/declined/expired). NULL while pending.

Indices:

* ``idx_handoff_requests_tenant_status``     — tenant-scoped status scans
  (cycle detection loads ``WHERE tenant_id = $1 AND status = 'pending'``).
* ``idx_handoff_requests_holder_pending``    — partial; ``coord_orient``'s
  "requests awaiting MY response" (``holder = caller AND status='pending'``).
* ``idx_handoff_requests_requester_status``  — a requester's outstanding asks.
* ``idx_handoff_requests_work_unit``         — yield resolution by work unit.

Idempotency: ``create_table`` / ``create_index`` are guarded by the coord
runtime self-heal (``mcp::negotiation::ensure_handoff_requests_table``) which
uses ``CREATE TABLE / INDEX IF NOT EXISTS`` — alembic is canonical, the Rust
DDL keeps fresh/dev DBs + pre-migration boots from crashing
(``[[feedback_canonical_db_behind_alembic]]``). The two MUST stay in
lockstep: this file mirrors
``qontinui-coord/src/mcp/negotiation.rs::ensure_handoff_requests_table``.

Chains off ``coord_agent_status`` — Phase 1's leaf on the coord branch — so
the alembic graph does NOT fork.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_handoff_requests"
# CRITICAL: chain off Phase 1's leaf (coord_agent_status) so the alembic
# graph does NOT fork.
down_revision: str = "coord_agent_status"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Idempotent: skip if coord self-heal / a prior partial apply already
    # created this table out-of-band (the table + indexes are present).
    if sa.inspect(op.get_bind()).has_table("handoff_requests", schema="coord"):
        return
    op.create_table(
        "handoff_requests",
        sa.Column(
            "request_id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("work_unit_id", sa.Text(), nullable=False),
        sa.Column("requester_device_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("holder_device_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column(
            "status",
            sa.Text(),
            nullable=False,
            server_default=sa.text("'pending'"),
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("request_id"),
        schema="coord",
    )

    op.create_index(
        "idx_handoff_requests_tenant_status",
        "handoff_requests",
        ["tenant_id", "status"],
        schema="coord",
    )
    op.create_index(
        "idx_handoff_requests_holder_pending",
        "handoff_requests",
        ["holder_device_id", "status"],
        schema="coord",
        postgresql_where=sa.text("status = 'pending'"),
    )
    op.create_index(
        "idx_handoff_requests_requester_status",
        "handoff_requests",
        ["requester_device_id", "status"],
        schema="coord",
    )
    op.create_index(
        "idx_handoff_requests_work_unit",
        "handoff_requests",
        ["work_unit_id"],
        schema="coord",
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS coord.idx_handoff_requests_work_unit")
    op.execute("DROP INDEX IF EXISTS coord.idx_handoff_requests_requester_status")
    op.execute("DROP INDEX IF EXISTS coord.idx_handoff_requests_holder_pending")
    op.execute("DROP INDEX IF EXISTS coord.idx_handoff_requests_tenant_status")
    op.drop_table("handoff_requests", schema="coord")
