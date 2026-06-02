"""coord.agent_tool_access — per-agent MCP tool allowlist (Toolshed least-privilege).

Revision ID: agent_tool_access_01
Revises: semres_02_tool_registry_grammar
Create Date: 2026-06-02

Track B of the "Minions-Derived Bundle" plan: Per-Agent MCP Tool Curation.

Creates ``coord.agent_tool_access`` — an ADDITIVE, per-agent allowlist of the
coord-native MCP tools an agent may call. Coord's ``FilteredToolRegistry``
hydrates the allow-set from this table at ``POST /mcp`` request time, keyed by
the agent's ``agent_id`` JWT claim AND its ``tenant_id``. The presence of one
or more rows for an ``(agent_id, tenant_id)`` pair narrows that agent's
``tools/list`` + ``tools/call`` surface to exactly the listed tools; a call to
a non-listed tool returns ``METHOD_NOT_FOUND`` (indistinguishable from
"doesn't exist" — the tool's existence is never leaked).

Back-compat: when an agent has NO rows here (every agent today), the registry
falls back to ``allow = None`` — i.e. all tools, the pre-Track-B behavior.
Service / device tokens (no ``agent_id`` claim) are likewise never filtered.

Schema:

* ``agent_id``   — the agent the row scopes (the JWT ``agent:<uuid>`` subject).
* ``tenant_id``  — the agent's resolved tenant. Part of the PK so the allow-set
                   lookup is tenant-scoped (defense-in-depth: an agent_id is
                   only ever filtered against rows in its own tenant). FK to
                   ``coord.tenants`` ON DELETE CASCADE — drop a tenant, drop its
                   tool grants.
* ``tool_name``  — the coord-native MCP tool name (e.g. ``coord_orient``). Free
                   text on purpose: the tool catalog is code-defined and
                   evolves; a CHECK/enum here would couple the schema to a Rust
                   release and break additive tool rollouts.
* ``created_at`` — server clock at insert. ``DEFAULT now()`` — NOT used in any
                   partial-index predicate (cf.
                   reference_alembic_now_index_and_offline_sql_gap).

Primary key ``(agent_id, tenant_id, tool_name)`` — one row per granted tool,
idempotent re-grant via ``ON CONFLICT DO NOTHING`` on the coord side.

Reconcile / GC note: this is a standalone per-agent access table. It carries no
claim-mapped role attribution column that any coord reconcile / GC / lease
sweep consumes (unlike claim-sync ownership columns). No existing reconcile job
touches it; rows persist until the agent's tenant is deleted (FK cascade) or
the coord assignment endpoint overwrites them. (cf.
feedback_check_next_reconcile_for_side_effect_inserts — verified: no
side-effect reconcile.)

There is NO Rust self-heal mirror for this table — alembic is the sole author
of ``coord.*`` schema (tests/coord_schema_authorship.rs enforces this). Coord
asserts presence at boot via ``state::require_table``.

NOTE (coordinator-preserved 2026-06-02): this migration was authored for
minions Track B but left UNCOMMITTED + untracked in the web main checkout
working tree (pointing at the long-stale ``bridge_audit_log_01``), where it
twice misled migration-head computation during the 2026-06-02 batch. The
coordinator preserved it onto this branch and re-pointed ``down_revision`` to
the then-current head ``semres_02_tool_registry_grammar``. When Track B resumes,
re-verify the head at PR time and acquire the alembic-head claim (Plan A's new
exclusive-claim flow) before merge.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "agent_tool_access_01"
down_revision: str | Sequence[str] | None = "semres_02_tool_registry_grammar"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "agent_tool_access",
        sa.Column(
            "agent_id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
        ),
        sa.Column(
            "tenant_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("coord.tenants.tenant_id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("tool_name", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint(
            "agent_id", "tenant_id", "tool_name", name="agent_tool_access_pkey"
        ),
        schema="coord",
    )
    # Hot path: hydrate the allow-set for one (agent_id, tenant_id) on every
    # POST /mcp. The PK leads with (agent_id, tenant_id) so it already serves
    # this prefix lookup — no separate index needed.


def downgrade() -> None:
    op.drop_table("agent_tool_access", schema="coord")
