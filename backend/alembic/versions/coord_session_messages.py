"""coord.session_messages (Session Bus Phase 3 — durable directed mailbox)

Revision ID: coord_session_messages
Revises: coord_findings
Create Date: 2026-06-15

Phase 3 of plan
``D:/qontinui-root/plans/2026-06-15-inter-session-session-bus.md``.

Stands up ``coord.session_messages``: the durable, addressable mailbox that lets
one session send a directed message to another (plan problems 1 + 4). Unlike the
transient JetStream ``events.agent.<device>.inbox`` (handoff-only,
fire-and-forget), this table PERSISTS, so a CLOSED target still receives the
message when it next resumes / is woken. Generalizes the handoff
``NegotiationMessage`` — a handoff becomes one ``kind`` over this table.

Addressing (``to_address`` symbolic, resolved to ``to_session``):
* ``session:<claude_session_id>``  — direct (resolved at send time, Phase 3).
* ``claim:<kind>:<resource_key>``  — route to the current claim holder (Phase 4
  resolver — reach the blocker without knowing who they are).
* ``resource:<glob|pr|plan>``      — fan-out to overlapping sessions (Phase 4).

Schema:

* ``message_id UUID PRIMARY KEY``     — synthetic id; what an ack targets.
* ``tenant_id UUID NOT NULL``         — owning tenant (no cross-tenant delivery).
* ``from_session UUID`` / ``from_device UUID`` — best-effort sender identity.
* ``to_address TEXT NOT NULL``        — the symbolic address as sent.
* ``to_session UUID``                 — resolved target session; NULL until a
  resolver binds it (Phase 4 for claim:/resource:; set immediately for
  session:).
* ``kind TEXT NOT NULL``              — ``directive`` (default) | ``fyi`` |
  ``handoff`` | ``ack_request``.
* ``priority TEXT NOT NULL``          — ``fyi`` | ``normal`` (default) |
  ``blocking`` (drives the wake path in Phase 4).
* ``body TEXT NOT NULL``              — the message the target reads.
* ``action JSONB``                    — optional typed continuation
  (``run_skill`` / ``merge_pr`` / ``notify_only`` …), composing with the gate
  continuation shape (review item 2). NULL for a plain message.
* ``requires_ack BOOLEAN NOT NULL``   — when true the message stays pending
  until ``coord_ack_message`` (default false).
* ``created_at TIMESTAMPTZ``          — when sent.
* ``expires_at TIMESTAMPTZ NOT NULL`` — TTL horizon (by kind/priority). The
  inbox read filters ``expires_at > now()``.
* ``delivered_at TIMESTAMPTZ``        — first time the target drained it
  (executor inject / inbox read). NULL = undelivered.
* ``read_at TIMESTAMPTZ``             — read receipt (review item 4): re-surface
  until set, never fire-and-forget.
* ``acked_at TIMESTAMPTZ`` / ``ack_response TEXT`` — set by the addressee's ack.

Indices:

* ``idx_session_messages_inbox``      — ``(to_session, expires_at)`` partial on
  ``acked_at IS NULL`` — the hot drain path: a session's pending mailbox.
* ``idx_session_messages_address``    — ``(to_address)`` partial on
  ``to_session IS NULL`` — the Phase-4 resolver's "unresolved by address" scan.
* ``idx_session_messages_tenant``     — ``(tenant_id)``.

Idempotency: ``CREATE TABLE/INDEX IF NOT EXISTS`` (``coord_agent_questions``
posture). coord reads/writes BEST-EFFORT (graceful degradation, NOT in the boot
``require_table`` gate) so coord + this migration land in either order without a
boot-gate crash-loop (review item 16).

NOTE (land-time): ``down_revision`` chains off ``coord_findings`` (Phase 2,
same branch). Before merging, re-point the HEAD of this stack via
``coord_migration_reserve`` (memory
``feedback_migration_reservation_withdraw_cascade_repoint_hazard``).

Chains off ``coord_findings``.
"""

from collections.abc import Sequence

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "coord_session_messages"
down_revision: str | Sequence[str] | None = "coord_findings"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create ``coord.session_messages`` + indices. Idempotent."""
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.session_messages (
            message_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id     UUID NOT NULL,
            from_session  UUID,
            from_device   UUID,
            to_address    TEXT NOT NULL,
            to_session    UUID,
            kind          TEXT NOT NULL DEFAULT 'directive',
            priority      TEXT NOT NULL DEFAULT 'normal',
            body          TEXT NOT NULL,
            action        JSONB,
            requires_ack  BOOLEAN NOT NULL DEFAULT false,
            created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
            expires_at    TIMESTAMPTZ NOT NULL,
            delivered_at  TIMESTAMPTZ,
            read_at       TIMESTAMPTZ,
            acked_at      TIMESTAMPTZ,
            ack_response  TEXT
        )
        """
    )
    # Hot drain path: a session's pending (un-acked, not-expired) mailbox.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_session_messages_inbox
            ON coord.session_messages (to_session, expires_at)
            WHERE acked_at IS NULL
        """
    )
    # Phase-4 resolver scan: messages addressed symbolically but not yet bound.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_session_messages_address
            ON coord.session_messages (to_address)
            WHERE to_session IS NULL
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_session_messages_tenant
            ON coord.session_messages (tenant_id)
        """
    )


def downgrade() -> None:
    """Drop ``coord.session_messages`` + indices."""
    op.execute("DROP INDEX IF EXISTS coord.idx_session_messages_tenant")
    op.execute("DROP INDEX IF EXISTS coord.idx_session_messages_address")
    op.execute("DROP INDEX IF EXISTS coord.idx_session_messages_inbox")
    op.execute("DROP TABLE IF EXISTS coord.session_messages")
