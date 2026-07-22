"""coord claude_account_usage — per-device Claude account usage twin

Revision ID: coord_claude_acct_usage_01
Revises: coord_prompt_docs_01
Create Date: 2026-07-17

Plan: ``D:/qontinui-root/plans/2026-07-17-claude-account-stats-twin-and-failover.md``.

Gives coord's digital twin the per-account Claude Code usage stats that today
live only inside each runner's in-memory snapshot: session-window (5-hour)
utilization + reset time, weekly utilization + reset time, per-model scoped
weekly limits, and the runner-computed ``exhausted`` verdict. The runner
mirrors its periodic usage refresh (``refresh_account_usage_snapshot``) to
coord's ``POST /coord/claude-accounts/usage`` ingest; ``coord_query_account_usage``
reads it back out.

Shape notes
===========

* One row per ``(tenant_id, device_id, account_label)`` — upsert semantics,
  latest snapshot wins; history is not kept here (CloudWatch/metrics cover
  trending). ``account_label`` is the config-dir basename (``.claude-gmail``),
  never a full local path.
* ``tenant_id`` carries NO foreign key to ``coord.tenants``, matching the
  other twin observation tables (coord-side writes are warn-and-continue).
* ``device_id`` is the caller's device identity from its device JWT — the
  ingest route derives it from auth, never from the body.
* Utilizations are 0.0–1.0 fractions (matching the runner's
  ``AccountUsageInfo``); ``*_resets_at`` are timestamptz.
* ``model_limits`` is the per-model scoped weekly list as JSONB
  (``[{"model": "Fable", "utilization": 0.34, "resets_at": 1784260321}]``).
* Idempotent DDL (``IF NOT EXISTS`` / ``IF EXISTS``) per house convention.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_claude_acct_usage_01"
down_revision: str = "coord_prompt_docs_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create coord.claude_account_usage."""
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.claude_account_usage (
            id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id           UUID NOT NULL,
            device_id           UUID NOT NULL,
            account_label       TEXT NOT NULL,
            weekly_utilization  DOUBLE PRECISION NOT NULL DEFAULT 0,
            weekly_resets_at    TIMESTAMPTZ,
            session_utilization DOUBLE PRECISION,
            session_resets_at   TIMESTAMPTZ,
            model_limits        JSONB NOT NULL DEFAULT '[]'::jsonb,
            exhausted           BOOLEAN NOT NULL DEFAULT FALSE,
            source              TEXT,
            error               BOOLEAN NOT NULL DEFAULT FALSE,
            updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT uq_claude_account_usage_identity
                UNIQUE (tenant_id, device_id, account_label)
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_claude_account_usage_tenant_updated
            ON coord.claude_account_usage (tenant_id, updated_at DESC)
        """
    )


def downgrade() -> None:
    """Drop coord.claude_account_usage."""
    op.execute("DROP TABLE IF EXISTS coord.claude_account_usage")
