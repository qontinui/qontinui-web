"""coord.gates.agent_session_id — close the session-attribution capture gap

Revision ID: coord_sesscompl_03
Revises: coord_sesscompl_02
Create Date: 2026-07-30

Phase 2 (§A3) of plan
``D:/qontinui-root/qontinui-dev-notes/plans/2026-07-30-session-compliance-report-enforcement.md``.

The gap
=======

``coord.gates`` carries ``registered_by`` (a **device_id**) and
``registered_by_agent_id`` — but **no originating session id**
(``qontinui-coord/src/gates.rs:7293-7309``). The MCP ``CallerIdentity`` at gate
registration carries no session claim, so nothing upstream ever captured one.
That is why reconciliation of a ``state: gated`` compliance claim can today only
say *"the gate_id exists and is open"*, with no proof the claiming session is
the gate's parent.

This migration adds the storage side. coord threads the Claude session UUID
into ``CallerIdentity`` and populates the column at registration in its own PR,
which merges AFTER this one (``[policy: alembic-sole-authorship]`` — a coord
read of a new ``coord.*`` column needs its qontinui-web migration to land
first).

**There is deliberately NO backfill.**
======================================

Every existing ``coord.gates`` row predates capture, and the only way to fill
them retroactively is the ``(device, tenant) → most-recent-active-session``
heuristic that **coord's own source explicitly rejects**: it attributes the
wrong parent under concurrent sessions, which is this fleet's normal state.
That heuristic already exists as a callable function
(``qontinui-coord/src/gates.rs:10353``, "looks up the ``agent_session_id`` from
the most recent ``coord.claims_audit``") sitting one call away — do not reach
for it here or in the coord PR. If it is used at all, its result must be
labelled ``attribution: "heuristic"`` in the reconciliation payload and must
**never** promote a compliance claim to ``verified``
(``[policy: design-tradeoff-ranking#3]``).

So: NULL on an existing row means "unknown, and honestly so" — never "no
session". Reconciliation must report that degradation rather than silently
accepting the claim.

Type / FK choices
=================

* ``UUID``, not TEXT — verified against the existing schema, not guessed.
  ``agent_session_id`` is ``UUID`` on every coord table that carries it:
  ``coord.agent_worktrees``, ``coord.claims_audit``, ``coord.build_events``,
  ``coord.merge_proposals``, ``coord.coordinator_decisions``, ``coord.devices``
  (``coord_agent_session_id_lineage.py:154``), plus ``coord.agent_logs:73``,
  ``coord.prompt_injection_events:79`` and
  ``coord.footprint_drift_events:103``. It holds the **Claude Code session
  UUID** — the id space keying ``coord.agent_sessions``, not
  ``coord.sessions.id``.

* **No FK** to ``coord.agent_sessions(id)``, matching the newer lineage tables
  (``agent_logs``, ``prompt_injection_events``, ``footprint_drift_events``),
  which all treat the column as a best-effort link. Gate registration must not
  fail because the ``coord.agent_sessions`` upsert for a brand-new session has
  not landed yet — a gate that cannot be registered is strictly worse than a
  gate whose parent cannot be joined.

* Partial index on the non-NULL subset, matching
  ``idx_agent_logs_session`` / ``idx_pie_session``: attribution queries always
  filter on a known session UUID and must never scan the NULL majority (which,
  with no backfill, is every pre-existing row).

Idempotency: ``ADD COLUMN IF NOT EXISTS`` / ``CREATE INDEX IF NOT EXISTS`` via
raw ``op.execute`` — the convention the sibling ``coord.gates`` column
migrations already use (``coord_gates_observation_cols``,
``coord_gates_progress_cols_01``).
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_sesscompl_03"
down_revision: str | Sequence[str] | None = "coord_sesscompl_02"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the nullable session-attribution column to coord.gates."""
    op.execute(
        """
        ALTER TABLE coord.gates
            ADD COLUMN IF NOT EXISTS agent_session_id UUID
        """
    )

    op.execute(
        """
        COMMENT ON COLUMN coord.gates.agent_session_id IS
            'Claude Code session UUID that registered this gate (the id space '
            'keying coord.agent_sessions, NOT coord.sessions.id). Nullable and '
            'DELIBERATELY NEVER BACKFILLED: every pre-capture row would have '
            'to be filled by the (device,tenant) -> most-recent-active-session '
            'heuristic that coord explicitly rejects as attributing the wrong '
            'parent under concurrency. NULL means unknown, not no-session.'
        """
    )

    # Attribution queries always filter on a known session UUID; the NULL
    # majority (every pre-capture row) is never scanned.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_gates_agent_session
            ON coord.gates (agent_session_id)
            WHERE agent_session_id IS NOT NULL
        """
    )


def downgrade() -> None:
    """Drop the index and the column."""
    op.execute("DROP INDEX IF EXISTS coord.idx_gates_agent_session")
    op.execute("ALTER TABLE coord.gates DROP COLUMN IF EXISTS agent_session_id")
