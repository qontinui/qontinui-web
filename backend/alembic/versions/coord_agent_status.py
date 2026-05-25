"""coord.agent_status (Coord-Native Coordination MCP — Phase 1)

Revision ID: coord_agent_status
Revises: coord_hooks_03_attempt_audits
Create Date: 2026-05-24

Phase 1 of plan
``D:/qontinui-root/qontinui-dev-notes/plans/2026-05-24-coord-native-coordination-mcp-plan.md``.

Stands up ``coord.agent_status``: the work-unit-level, mutable agent
coordination-status table backing the coord-native MCP surface
(``coord_report_status`` / ``coord_orient`` at ``POST /mcp``). It replaces
v1's claim-audit-metadata-via-DISTINCT-ON storage (churn + fragile latest-
wins reconstruction) with a first-class upsert surface keyed at the work-
unit grain so multiple concurrent work units on one device are distinct
rows, and so peers can orient on each other by ``correlation_topic``.

Distinct from ``coord.device_status`` (machine-level, one row per device):
this table is per (device, work_unit). It also carries the coordination
free-text (``status_text`` / ``blocked_on``) and the ``intent_globs`` a
later phase (``coord_declare_intent``) derives server-side.

Schema (mirrors the Rust self-heal mirror EXACTLY — keep in lockstep):

* ``device_id UUID NOT NULL``        — caller identity, from the validated
  JWT (never arguments). FK ``coord.devices(device_id) ON DELETE CASCADE``
  so a deregistered device's status disappears with it.
* ``tenant_id UUID NOT NULL``        — tenant scope, from the JWT. NOT NULL
  here (vs the nullable JWT claim): a tenant-blind token cannot write this
  table — the MCP tool returns an error instead of default-filling.
* ``correlation_topic TEXT NOT NULL``— the coordination session that groups
  an agent with its peers (``coord_orient`` peers = same topic).
* ``work_unit_id TEXT NOT NULL``     — what the agent is working on (file
  path, task name, ...). Part of the PK so one device can report multiple
  concurrent work units.
* ``status_text TEXT NOT NULL``      — free-text: what + why.
* ``blocked_on TEXT``                — what the agent needs to proceed;
  NULL when not blocked.
* ``intent_globs TEXT[]``            — globs derived from declared intent
  (``coord_declare_intent``, a later phase). NULL until declared.
* ``updated_at TIMESTAMPTZ``         — last upsert (server clock).
* ``expires_at TIMESTAMPTZ NOT NULL``— TTL eviction. The upsert sets this
  to ``now() + interval '1 hour'`` (matching the ``coord.device_status``
  ``prune_stale`` posture); ``coord_orient`` filters on ``expires_at >
  now()`` so stale rows drop out without a sweeper.

Primary key: ``(device_id, work_unit_id, tenant_id)`` — the upsert key.

Indices:

* ``idx_agent_status_topic``         — O(1) peer lookup by topic.
* ``idx_agent_status_tenant``        — tenant-scoped scans.
* ``idx_agent_status_expires``       — TTL prune / freshness filter.
* ``idx_agent_status_blocked``       — partial; "who is blocked?" triage
  (``coord_blockers``, a later phase).

Idempotency: ``create_table`` / ``create_index`` are guarded by the
coord runtime self-heal (``mcp::agent_status::ensure_agent_status_table``)
which uses ``CREATE TABLE / INDEX IF NOT EXISTS`` — alembic is canonical,
the Rust DDL keeps fresh/dev DBs + pre-migration boots from crashing
(``[[feedback_canonical_db_behind_alembic]]``). The two MUST stay in
lockstep: this file mirrors
``qontinui-coord/src/mcp/agent_status.rs::ensure_agent_status_table``.

Chains off ``coord_hooks_03_attempt_audits`` — the verified head of the
coord branch at authoring time — so the alembic graph does NOT fork.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_agent_status"
# CRITICAL: chain off the current head of the coord branch so the alembic
# graph does NOT fork. coord_hooks_03_attempt_audits is the verified head.
down_revision: str = "coord_hooks_03_attempt_audits"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Idempotent: skip if coord self-heal / a prior partial apply already
    # created this table out-of-band (the table + indexes are present).
    if sa.inspect(op.get_bind()).has_table("agent_status", schema="coord"):
        return
    op.create_table(
        "agent_status",
        sa.Column("device_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("correlation_topic", sa.Text(), nullable=False),
        sa.Column("work_unit_id", sa.Text(), nullable=False),
        sa.Column("status_text", sa.Text(), nullable=False),
        sa.Column("blocked_on", sa.Text(), nullable=True),
        sa.Column("intent_globs", postgresql.ARRAY(sa.Text()), nullable=True),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["device_id"],
            ["coord.devices.device_id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("device_id", "work_unit_id", "tenant_id"),
        schema="coord",
    )

    op.create_index(
        "idx_agent_status_topic",
        "agent_status",
        ["correlation_topic"],
        schema="coord",
    )
    op.create_index(
        "idx_agent_status_tenant",
        "agent_status",
        ["tenant_id"],
        schema="coord",
    )
    op.create_index(
        "idx_agent_status_expires",
        "agent_status",
        ["expires_at"],
        schema="coord",
    )
    op.create_index(
        "idx_agent_status_blocked",
        "agent_status",
        ["blocked_on"],
        schema="coord",
        postgresql_where=sa.text("blocked_on IS NOT NULL"),
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS coord.idx_agent_status_blocked")
    op.execute("DROP INDEX IF EXISTS coord.idx_agent_status_expires")
    op.execute("DROP INDEX IF EXISTS coord.idx_agent_status_tenant")
    op.execute("DROP INDEX IF EXISTS coord.idx_agent_status_topic")
    op.drop_table("agent_status", schema="coord")
