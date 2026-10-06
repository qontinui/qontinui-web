"""coord.sessions resume bookkeeping columns + tenant resume_unfinished_enabled

Revision ID: sessresume_01
Revises: gate_arming_02
Create Date: 2026-10-06

Phase 0 (schema only) of plan
``2026-10-06-closed-sessions-whose-work-is-unfinished-are-found-fleet-wide-and-resumed``.

coord authors zero DDL (``[policy: alembic-sole-authorship]``), so the columns
its later phases read and write land here first. Readers must degrade on a
missing column until this migration is applied to the serving database.

Adds to ``coord.sessions`` (all nullable, no default, no backfill):
``finish_reason``, ``account_label``, ``config_dir``,
``last_resume_attempt_at`` and ``resume_verdict``.

Adds to ``coord.tenant_policies``: ``resume_unfinished_enabled BOOLEAN NOT NULL
DEFAULT true``. Postgres applies the default to every existing row at
``ADD COLUMN`` time, so no separate UPDATE is needed.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "sessresume_01"
down_revision: str | Sequence[str] | None = "gate_arming_02"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the resume columns. Idempotent."""
    op.execute(
        """
        ALTER TABLE coord.sessions
            ADD COLUMN IF NOT EXISTS finish_reason TEXT NULL,
            ADD COLUMN IF NOT EXISTS account_label TEXT NULL,
            ADD COLUMN IF NOT EXISTS config_dir TEXT NULL,
            ADD COLUMN IF NOT EXISTS last_resume_attempt_at TIMESTAMPTZ NULL,
            ADD COLUMN IF NOT EXISTS resume_verdict TEXT NULL
        """
    )
    op.execute(
        """
        ALTER TABLE coord.tenant_policies
            ADD COLUMN IF NOT EXISTS resume_unfinished_enabled
                BOOLEAN NOT NULL DEFAULT true
        """
    )


def downgrade() -> None:
    """Drop the resume columns."""
    op.execute(
        """
        ALTER TABLE coord.tenant_policies
            DROP COLUMN IF EXISTS resume_unfinished_enabled
        """
    )
    op.execute(
        """
        ALTER TABLE coord.sessions
            DROP COLUMN IF EXISTS resume_verdict,
            DROP COLUMN IF EXISTS last_resume_attempt_at,
            DROP COLUMN IF EXISTS config_dir,
            DROP COLUMN IF EXISTS account_label,
            DROP COLUMN IF EXISTS finish_reason
        """
    )
