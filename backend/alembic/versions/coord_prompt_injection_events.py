"""coord.prompt_injection_events (Unified Coord Prompt-Injection Audit Log — Phase 1)

Revision ID: coord_prompt_injection_events
Revises: coord_consistent_snapshots_01
Create Date: 2026-07-04

Phase 1 of the "Unified Coord Prompt-Injection Audit Log" plan.

Stands up ``coord.prompt_injection_events``: the single, tenant-scoped audit log
of every prompt injected into an agent/terminal session (auto-response,
usage-limit continuation, directive delivery, operator push …). One row per
injection, capturing WHO/WHERE it landed (session / terminal / agent / device),
WHY it fired (``trigger_kind`` + optional ``trigger_text``), the exact
``injected_prompt`` text, and the governing policy/rule if any.

coord OWNS reads/writes of this table; web only proxies. Per fleet policy coord
authors ZERO ``coord.*`` DDL, so THIS web migration is the sole DDL author.

Schema:

* ``event_id UUID PRIMARY KEY``       — synthetic id.
* ``tenant_id UUID NOT NULL``         — owning tenant (no cross-tenant reads).
* ``source TEXT NOT NULL``            — injector subsystem (auto-response,
  usage-limit, directive, operator …).
* ``agent_session_id UUID`` / ``session_name TEXT`` — best-effort session
  identity of the target.
* ``terminal_id TEXT`` / ``agent_id UUID`` / ``device_id UUID`` — where it
  landed.
* ``trigger_kind TEXT NOT NULL``      — why it fired.
* ``trigger_text TEXT``               — optional captured trigger detail.
* ``injected_prompt TEXT NOT NULL``   — the exact text injected.
* ``policy_id UUID`` / ``rule_id TEXT`` — governing policy/rule if any.
* ``created_at TIMESTAMPTZ NOT NULL`` — when the injection happened.
* ``metadata JSONB``                  — optional typed extras.

Indices:

* ``idx_pie_tenant_created`` — ``(tenant_id, created_at DESC)`` — the hot
  per-tenant reverse-chronological audit scan.
* ``idx_pie_session``        — ``(agent_session_id)`` partial on
  ``agent_session_id IS NOT NULL`` — per-session injection history.
* ``idx_pie_source``         — ``(tenant_id, source)`` — filter a tenant's log
  by injector subsystem.

Idempotency: ``CREATE TABLE/INDEX IF NOT EXISTS`` (``coord_session_messages``
posture). coord reads/writes BEST-EFFORT (graceful degradation, NOT in the boot
``require_table`` gate) so coord + this migration land in either order without a
boot-gate crash-loop.

Chains off ``coord_tenant_backfill_01`` (the live single head of the coord
alembic chain on main). Originally reserved to stack behind
``coord_consistent_snapshots_01`` (qontinui-web#713), but that predecessor
went stale (open, red, BEHIND since 2026-07-03) and the two migrations are
semantically independent (distinct tables), so this re-points onto the
current head to land on its own merits. If #713 later revives it re-points
onto this migration (or coord auto-rebase reconciles the fork).
"""

from collections.abc import Sequence

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "coord_prompt_injection_events"
down_revision: str | Sequence[str] | None = "coord_tenant_backfill_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create ``coord.prompt_injection_events`` + indices. Idempotent."""
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.prompt_injection_events (
            event_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id         UUID NOT NULL,
            source            TEXT NOT NULL,
            agent_session_id  UUID,
            session_name      TEXT,
            terminal_id       TEXT,
            agent_id          UUID,
            device_id         UUID,
            trigger_kind      TEXT NOT NULL,
            trigger_text      TEXT,
            injected_prompt   TEXT NOT NULL,
            policy_id         UUID,
            rule_id           TEXT,
            created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
            metadata          JSONB
        )
        """
    )
    # Hot per-tenant reverse-chronological audit scan.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_pie_tenant_created
            ON coord.prompt_injection_events (tenant_id, created_at DESC)
        """
    )
    # Per-session injection history.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_pie_session
            ON coord.prompt_injection_events (agent_session_id)
            WHERE agent_session_id IS NOT NULL
        """
    )
    # Filter a tenant's log by injector subsystem.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_pie_source
            ON coord.prompt_injection_events (tenant_id, source)
        """
    )


def downgrade() -> None:
    """Drop ``coord.prompt_injection_events`` + indices."""
    op.execute("DROP INDEX IF EXISTS coord.idx_pie_source")
    op.execute("DROP INDEX IF EXISTS coord.idx_pie_session")
    op.execute("DROP INDEX IF EXISTS coord.idx_pie_tenant_created")
    op.execute("DROP TABLE IF EXISTS coord.prompt_injection_events")
