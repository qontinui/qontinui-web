"""coord.agent_tool_access — per-agent MCP tool curation (Toolshed least privilege)

Revision ID: agent_tool_access_01
Revises: coord_conflict_res_auto_rewrite_method
Create Date: 2026-06-03

Track B of the "Minions-Derived Bundle" plan. Stands up
``coord.agent_tool_access``: the per-agent least-privilege allow-list backing
``qontinui-coord``'s ``mcp::tools::FilteredToolRegistry``.

Coord exposes its MCP tool catalog (``phaseN()`` builders, served at
``POST /mcp``) to any caller with a valid JWT — historically with NO per-agent
allow-list, so every spawned agent saw (and could call) every tool. This table
is the curation seam: at request time coord SELECTs the set of tool names an
agent may use, keyed by the request's ``agent_id`` claim AND ``tenant_id``, and
narrows both ``tools/list`` and the ``tools/call`` lookup to that set. A
non-allowed tool is masked as the unknown-tool path (``METHOD_NOT_FOUND``) so
curation never leaks which tools an agent is merely barred from.

Back-compat: an agent with ZERO rows hydrates to "no curation" (all tools), so
behavior is byte-identical to the pre-Track-B surface until rows exist. The
``agent_id`` is only ever a LOOKUP KEY — the allow-set is DB-resolved here,
never derived from the (advisory) JWT claim alone.

Schema:

* ``agent_id   UUID NOT NULL`` — the agent (``sub = "agent:<uuid>"`` token).
* ``tenant_id  UUID NOT NULL`` — tenant scope; grants are tenant-isolated, so
  the same ``agent_id`` under a different tenant is independent.
* ``tool_name  TEXT NOT NULL`` — a coord-native MCP tool name (validated
  against the live registry at assignment time by the coord endpoint).
* ``created_at TIMESTAMPTZ NOT NULL DEFAULT now()`` — grant creation (server
  clock).

Primary key: ``(agent_id, tenant_id, tool_name)`` — natural grant grain; the
assignment endpoint ``ON CONFLICT ... DO NOTHING`` is idempotent against it.

Index:

* ``idx_agent_tool_access_lookup`` — the request-time hydration scan filters on
  ``(agent_id, tenant_id)``. The PK's leading ``(agent_id, tenant_id, ...)``
  columns already serve that prefix scan, so no extra index is created — the
  composite PK IS the hydration index.

## Schema authoring posture

alembic is the SOLE author of ``coord.*`` schema; ``qontinui-coord`` authors
ZERO ``coord.*`` DDL in its production binary (enforced by
``tests/coord_schema_authorship.rs``) and asserts this table's presence at boot
via ``require_table`` — no Rust self-heal. This migration deploys BEFORE the
coord build that reads the table (deploy-ordered, same posture as the other
single-authored coord tables).

Chains off ``coord_conflict_res_auto_rewrite_method`` — the verified single
head of the alembic graph at authoring time — so the graph does NOT fork.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "agent_tool_access_01"
# CRITICAL: chain off the current single head so the alembic graph does NOT
# fork. coord_conflict_res_auto_rewrite_method is the verified head.
down_revision: str | Sequence[str] | None = "coord_conflict_res_auto_rewrite_method"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Idempotent: skip if a prior partial apply already created the table.
    if sa.inspect(op.get_bind()).has_table("agent_tool_access", schema="coord"):
        return
    op.create_table(
        "agent_tool_access",
        sa.Column("agent_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("tool_name", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint(
            "agent_id",
            "tenant_id",
            "tool_name",
            name="pk_agent_tool_access",
        ),
        schema="coord",
    )


def downgrade() -> None:
    op.drop_table("agent_tool_access", schema="coord")
