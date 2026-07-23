"""coord.session_handles + coord.session_handle_lineage (session-fabric Phase 1)

Revision ID: coord_session_handles
Revises: coord_alerts_subject_tenant_backfill_01
Create Date: 2026-07-23

Phase 1 (web slice) of plan
``D:/qontinui-root/plans/2026-07-05-session-identity-messaging-restore-fabric.md``
(§4.2). Authored by alembic in ``qontinui-web`` — coord authors zero
``coord.*`` DDL (memory ``reference_coord_rust_authors_zero_coord_schema``).

Stands up the fleet session-handle registry: a first-class table decoupling a
STABLE, coord-minted handle (``fsh_<uuid>``) from the volatile per-boot
process/terminal ids that break addressing today.

``coord.session_handles``:

* ``handle TEXT PRIMARY KEY``          — ``fsh_<uuid>``, coord-minted, immutable.
* ``claude_session_id TEXT UNIQUE NOT NULL`` — THE anchor/rebind key: the
  runner's durable lifecycle-store PK (``terminal-sessions.json``), present for
  EVERY session (pinned chat AND sniffed interactive). UNIQUE makes
  "look up before mint" atomic — a runner that lost its handle file re-finds
  the existing handle by this key instead of minting-then-colliding (§4.1).
* ``tenant_id UUID NOT NULL``          — SESSION-scoped tenant (Option A),
  deliberately NOT derived from the device.
* ``device_id UUID NOT NULL``          — FK to ``coord.devices(device_id)``.
* ``task_run_id UUID``                 — nullable SECONDARY id
  (== claude_session_id on the pinned chat plane; NULL for sniffed
  interactive terminals).
* ``promptable BOOLEAN NOT NULL DEFAULT false`` — true iff a live runner
  terminal backs this handle (§7).
* ``accept_tenant_peer_prompts BOOLEAN NOT NULL DEFAULT false`` — target-side
  consent for cross-device prompting (§7).
* ``name TEXT``                        — human alias (tag-session); unique per
  (tenant, name) among non-closed handles only.
* ``current_agent_session_id UUID``    — current volatile
  ``coord.agent_sessions.id``, rebound on restart.
* ``current_terminal_id TEXT``         — current runner terminal id, rebound
  on restart.
* ``machine_id UUID``
* ``status TEXT``                      — ``live`` | ``stale`` | ``closed``.
* ``first_bound_at`` / ``last_heartbeat_at`` / ``closed_at TIMESTAMPTZ``.

Indices:

* ``uq_session_handles_tenant_name``   — partial UNIQUE ``(tenant_id, name)``
  WHERE ``closed_at IS NULL`` — a name resolves to at most one live handle
  per tenant; closed handles free their name.
* ``idx_session_handles_device_live``  — ``(device_id)`` WHERE
  ``status = 'live'`` — the "live handles on this device" resolver path.

``coord.session_handle_lineage`` — every agent_session uuid a handle has
owned across boots. Powers the §6.1 UNION drain so legacy ``to_session``
messages addressed to an earlier boot's uuid never strand:

* ``handle TEXT``                      — FK to ``coord.session_handles``.
* ``agent_session_id UUID``
* ``bound_at TIMESTAMPTZ``
* ``PRIMARY KEY (handle, agent_session_id)``
* ``idx_session_handle_lineage_agent_session`` — reverse lookup: coord
  resolves an injected agent_session_id to its handle via lineage.

Idempotency: ``CREATE TABLE/INDEX IF NOT EXISTS`` (``coord_session_messages``
posture) so coord's consumer PR (separate, downstream) and this migration
land in either order without a boot-gate crash-loop.

Chains off the current single head ``coord_alerts_subject_tenant_backfill_01``
(origin/main head 2026-07-23, verified after rebase; coord re-points
down_revision at land time and ``alembic-graph-pr.yml`` blocks forks).
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_session_handles"
down_revision: str | Sequence[str] | None = "coord_alerts_subject_tenant_backfill_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create ``coord.session_handles`` + ``coord.session_handle_lineage``. Idempotent."""
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.session_handles (
            handle                      TEXT PRIMARY KEY,
            claude_session_id           TEXT UNIQUE NOT NULL,
            tenant_id                   UUID NOT NULL,
            device_id                   UUID NOT NULL
                                            REFERENCES coord.devices(device_id),
            task_run_id                 UUID,
            promptable                  BOOLEAN NOT NULL DEFAULT false,
            accept_tenant_peer_prompts  BOOLEAN NOT NULL DEFAULT false,
            name                        TEXT,
            current_agent_session_id    UUID,
            current_terminal_id         TEXT,
            machine_id                  UUID,
            status                      TEXT,
            first_bound_at              TIMESTAMPTZ,
            last_heartbeat_at           TIMESTAMPTZ,
            closed_at                   TIMESTAMPTZ
        )
        """
    )
    # A name resolves to at most one non-closed handle per tenant; closing a
    # handle frees its name for reuse.
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_session_handles_tenant_name
            ON coord.session_handles (tenant_id, name)
            WHERE closed_at IS NULL
        """
    )
    # Resolver path: live handles backed by a given device.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_session_handles_device_live
            ON coord.session_handles (device_id)
            WHERE status = 'live'
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.session_handle_lineage (
            handle            TEXT REFERENCES coord.session_handles(handle),
            agent_session_id  UUID,
            bound_at          TIMESTAMPTZ,
            PRIMARY KEY (handle, agent_session_id)
        )
        """
    )
    # Reverse lookup: resolve an injected agent_session_id to its handle
    # (the §6.1 legacy to_session UNION drain).
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_session_handle_lineage_agent_session
            ON coord.session_handle_lineage (agent_session_id)
        """
    )


def downgrade() -> None:
    """Drop lineage then handles (reverse dependency order)."""
    op.execute("DROP INDEX IF EXISTS coord.idx_session_handle_lineage_agent_session")
    op.execute("DROP TABLE IF EXISTS coord.session_handle_lineage")
    op.execute("DROP INDEX IF EXISTS coord.idx_session_handles_device_live")
    op.execute("DROP INDEX IF EXISTS coord.uq_session_handles_tenant_name")
    op.execute("DROP TABLE IF EXISTS coord.session_handles")
