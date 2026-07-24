"""coord.session_messages to_handle/from_handle + parked-delivery columns (fabric Phase 2)

Revision ID: coord_sm_to_handle
Revises: coord_prompt_docs_02
Create Date: 2026-07-24

Phase 2 (web slice) of plan
``D:/qontinui-root/plans/2026-07-05-session-identity-messaging-restore-fabric.md``
(§6.1). Authored by alembic in ``qontinui-web`` — coord authors zero
``coord.*`` DDL (memory ``reference_coord_rust_authors_zero_coord_schema``).

Extends ``coord.session_messages`` (revision ``coord_session_messages``) with
handle-addressed durable delivery + parked claim:/resource: delivery. All
columns are ADDITIVE AND NULLABLE — coord tolerates their absence (42703
degraded mode) and legacy rows simply carry NULLs, so this deploys before
coord's Phase-2 reader in the standard web→coord order and in either order
without breakage.

Columns:

* ``to_handle TEXT``       — the stable ``fsh_`` fleet session handle the
  message is addressed to (§6.1 drain-time resolution). NULL for legacy
  ``to_session``-only rows and for parked rows awaiting a resolver.
* ``from_handle TEXT``     — best-effort sender attribution by stable handle
  (never replaces ``from_session``; rides alongside it).
* ``park_plan_slug TEXT``  — the SENDER's plan-slug/correlation context
  recorded when a ``claim:``/``resource:`` send had no live holder and was
  parked (§6.1 context-bound parked delivery: a later acquirer receives the
  row only when its own context matches, guarding against stale mis-targeted
  directives). NULL = no context bound (deliver to any matching acquirer).
* ``park_expires_at TIMESTAMPTZ`` — the SHORT park TTL horizon (coord stamps
  ``now() + 24 hours`` at park time; ≤ every message-priority TTL). A parked
  row past this instant is never delivered; ``expires_at`` continues to govern
  post-delivery drain visibility.

Index:

* ``idx_session_messages_to_handle`` — ``(to_handle)`` partial on
  ``acked_at IS NULL`` — keeps the hot UNION-drain inbox path index-backed
  (the existing ``idx_session_messages_inbox`` on ``to_session`` covers the
  other arm of the OR; the existing ``idx_session_messages_address`` on
  ``(to_address) WHERE to_session IS NULL`` continues to back the parked
  scan).

Idempotency: ``ADD COLUMN IF NOT EXISTS`` / ``CREATE INDEX IF NOT EXISTS``
(``coord_session_messages`` posture). NOT in coord's boot ``require_table``
gate — the bus degrades gracefully.

Chains off the current single head ``coord_prompt_docs_02``
(origin/main head 2026-07-24).
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_sm_to_handle"
down_revision: str | Sequence[str] | None = "coord_prompt_docs_02"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add handle-delivery + parked-delivery columns. Idempotent."""
    op.execute(
        """
        ALTER TABLE coord.session_messages
            ADD COLUMN IF NOT EXISTS to_handle TEXT
        """
    )
    op.execute(
        """
        ALTER TABLE coord.session_messages
            ADD COLUMN IF NOT EXISTS from_handle TEXT
        """
    )
    op.execute(
        """
        ALTER TABLE coord.session_messages
            ADD COLUMN IF NOT EXISTS park_plan_slug TEXT
        """
    )
    op.execute(
        """
        ALTER TABLE coord.session_messages
            ADD COLUMN IF NOT EXISTS park_expires_at TIMESTAMPTZ
        """
    )
    # Hot UNION-drain path: a handle's pending (un-acked) mailbox.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_session_messages_to_handle
            ON coord.session_messages (to_handle)
            WHERE acked_at IS NULL
        """
    )


def downgrade() -> None:
    """Drop the Phase-2 columns + index."""
    op.execute("DROP INDEX IF EXISTS coord.idx_session_messages_to_handle")
    op.execute(
        "ALTER TABLE coord.session_messages DROP COLUMN IF EXISTS park_expires_at"
    )
    op.execute(
        "ALTER TABLE coord.session_messages DROP COLUMN IF EXISTS park_plan_slug"
    )
    op.execute("ALTER TABLE coord.session_messages DROP COLUMN IF EXISTS from_handle")
    op.execute("ALTER TABLE coord.session_messages DROP COLUMN IF EXISTS to_handle")
