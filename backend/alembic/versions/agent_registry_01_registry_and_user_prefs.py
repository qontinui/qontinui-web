"""coord agent_registry + agent_user_prefs — per-tenant agent definition registry

Revision ID: agent_registry_01
Revises: coord_plan_pr_citations_3a_backfill
Create Date: 2026-07-28

Phase 4a of the CLAUDE.md-into-qontinui migration plan
(``qontinui-dev-notes/plans/2026-07-28-migrate-claude-md-into-qontinui.md``):
move the fleet's agent definitions (``.claude/agents/*.md``) into a
tenant-scoped registry that coord can serve, gate, and let users override.

What this migration does
========================

1. Creates ``coord.agent_registry`` — one row per ``(tenant_id, agent_name)``
   agent definition. Carries the canonical definition markdown
   (``definition_body``), spawn semantics (``spawn_path``,
   ``fanout_bound``), consent posture (``default_enabled``,
   ``policy_required``, ``allowed_dispositions``) and optional model/effort
   overrides.

2. Creates ``coord.agent_user_prefs`` — per-user overrides keyed
   ``(tenant_id, user_id, agent_name)``: an explicit ``enabled`` toggle and
   an optional ``disposition`` (NULL = unset → coord's degrade default).

Design notes
============

* ``tenant_id`` carries NO foreign key to ``coord.tenants``, matching the
  ancestor pattern (``coord.prompt_documents``, ``coord.policy_rules``):
  coord-side seeding is warn-and-continue and an FK would silently
  re-introduce the inert-feature failure class.
* ``spawn_path`` (``in_session_subagent`` | ``parallel_fanout`` |
  ``standing_continuation``) and ``disposition`` (``block`` | ``degrade`` |
  ``warn_proceed``) vocabularies are **Rust-enforced, deliberately NOT DB
  CHECK constraints** — per the coord ``sessions.rs:356-377`` design
  rationale, vocab columns stay CHECK-free so vocabulary evolution never
  requires a migration.
* ``allowed_dispositions`` is a JSONB array defaulting to the full
  vocabulary; coord narrows it per agent.
* No cost fields anywhere — deliberate: the consent unit is the spawn, not
  tokens.
* Idempotency: every DDL uses ``IF NOT EXISTS`` / ``IF EXISTS``.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "agent_registry_01"
down_revision: str = "coord_plan_pr_citations_3a_backfill"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create agent_registry + agent_user_prefs."""
    # 1. One row per (tenant, agent definition).
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.agent_registry (
            id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id            UUID NOT NULL,
            agent_name           TEXT NOT NULL,
            purpose              TEXT NOT NULL DEFAULT '',
            trigger_condition    TEXT NOT NULL DEFAULT '',
            spawn_path           TEXT NOT NULL DEFAULT 'in_session_subagent',
            model                TEXT,
            effort               TEXT,
            default_enabled      BOOLEAN NOT NULL DEFAULT true,
            policy_required      BOOLEAN NOT NULL DEFAULT false,
            allowed_dispositions JSONB NOT NULL
                DEFAULT '["block","degrade","warn_proceed"]'::jsonb,
            fanout_bound         INTEGER NOT NULL DEFAULT 15,
            definition_body      TEXT NOT NULL DEFAULT '',
            created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )

    # Required by the seeder's ON CONFLICT (tenant_id, agent_name) DO UPDATE
    # upsert, and serves the by-tenant list read (tenant_id leading).
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_registry_tenant_agent
            ON coord.agent_registry (tenant_id, agent_name)
        """
    )

    # 2. Per-user override rows. The composite PK is also the upsert target
    #    and the only read path (point lookups by tenant+user).
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.agent_user_prefs (
            tenant_id   UUID NOT NULL,
            user_id     UUID NOT NULL,
            agent_name  TEXT NOT NULL,
            enabled     BOOLEAN NOT NULL,
            disposition TEXT,
            updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
            PRIMARY KEY (tenant_id, user_id, agent_name)
        )
        """
    )


def downgrade() -> None:
    """Drop both agent-registry tables (no data migrated in, plain drop)."""
    op.execute("DROP TABLE IF EXISTS coord.agent_user_prefs")
    op.execute("DROP INDEX IF EXISTS coord.uq_agent_registry_tenant_agent")
    op.execute("DROP TABLE IF EXISTS coord.agent_registry")
