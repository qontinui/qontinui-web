"""web.bridge_audit_log — per-write audit trail for UI Bridge co-pilot commands.

Revision ID: bridge_audit_log_01
Revises: c5d0dbe907b5
Create Date: 2026-05-31

Phase §4.8 of the production-safe UI Bridge plan
(``D:/qontinui-root/plans/2026-05-28-production-safe-ui-bridge-design.md``).

Creates ``web.bridge_audit_log``: one row per write command flowing through
``/api/ui-bridge/*`` (any POST/PUT/DELETE that's a control/AI command,
excluding the SDK's own transport endpoints — ``/heartbeat``, ``/commands``,
``/commands/stream``). Reads (GET) and transport endpoints are NOT
audited; the spec is the FACT of a write command being issued on a
user's behalf, NOT a request log.

Schema:

* ``user_id``                 — the verified caller (web.users → auth.users).
* ``session_id`` (nullable)   — JWT jti when available (Cognito access token).
* ``tab_id``    (nullable)    — the SDK-side tab the command targeted.
* ``command_name``            — extracted from the path (e.g. ``element.action``,
                                ``page.navigate``, ``ai.find``,
                                ``ai.wait-for-element``, ``batch.execute``).
* ``target_element_id``       — when the command names a specific element id.
* ``path`` / ``method``       — full ``/api/ui-bridge/<path>`` + HTTP method.
* ``origin`` (nullable)       — request ``Origin`` header (browser-set).
* ``status_code``             — final HTTP status the relay returned.
* ``occurred_at``             — server clock at insert. ``DEFAULT now()`` —
                                NOT used in any partial-index predicate
                                (cf. reference_alembic_now_index_and_offline_sql_gap).
* ``payload_summary`` JSONB   — SAFE summary only; NEVER the raw payload.
                                Acceptable: ``{action,elementId,textLength}``;
                                FORBIDDEN: the text actually typed. The
                                middleware logs the fact, not the secret.

Indexes:

* ``ix_bridge_audit_log_user_id_occurred_at`` — viewer query
  (user-scoped, ``ORDER BY occurred_at DESC``).
* ``ix_bridge_audit_log_session_id``           — incident triage
  (filter rows from one JWT jti).

``web`` schema is created here ``IF NOT EXISTS``; this is the first web-scoped
domain table. Public objects (``auth.users``) are referenced by FK with
``ON DELETE CASCADE`` — if an account is deleted, its audit rows go with it.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "bridge_audit_log_01"
down_revision: str | Sequence[str] | None = "c5d0dbe907b5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("CREATE SCHEMA IF NOT EXISTS web")

    op.create_table(
        "bridge_audit_log",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("auth.users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("session_id", sa.String(length=128), nullable=True),
        sa.Column("tab_id", sa.String(length=128), nullable=True),
        sa.Column("command_name", sa.String(length=128), nullable=False),
        sa.Column("target_element_id", sa.String(length=256), nullable=True),
        sa.Column("path", sa.String(length=512), nullable=False),
        sa.Column("method", sa.String(length=16), nullable=False),
        sa.Column("origin", sa.String(length=256), nullable=True),
        sa.Column("status_code", sa.Integer(), nullable=False),
        sa.Column(
            "occurred_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
        sa.Column("payload_summary", postgresql.JSONB, nullable=True),
        schema="web",
    )

    op.create_index(
        "ix_bridge_audit_log_user_id_occurred_at",
        "bridge_audit_log",
        ["user_id", sa.text("occurred_at DESC")],
        schema="web",
    )
    op.create_index(
        "ix_bridge_audit_log_session_id",
        "bridge_audit_log",
        ["session_id"],
        schema="web",
    )


def downgrade() -> None:
    op.drop_index(
        "ix_bridge_audit_log_session_id",
        table_name="bridge_audit_log",
        schema="web",
    )
    op.drop_index(
        "ix_bridge_audit_log_user_id_occurred_at",
        table_name="bridge_audit_log",
        schema="web",
    )
    op.drop_table("bridge_audit_log", schema="web")
