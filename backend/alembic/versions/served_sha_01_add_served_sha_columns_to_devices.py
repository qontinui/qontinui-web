"""Add runner served-sha observability columns to coord.devices

Revision ID: served_sha_01_devices_columns
Revises: dry_run_retire_01_backfill
Create Date: 2026-07-24

Phase 1 of the coord runner served-sha observability + gate plan
(``2026-07-20-coord-runner-served-sha-observability-and-gate``). Extends
``coord.devices`` with four nullable columns so coord can record which git
sha each runner binary is actually serving (its embedded
``QONTINUI_GIT_SHA``) and how far behind ``origin/main`` that binary is —
the inputs to the new ``runner_served_sha`` gate predicate.

- ``served_git_sha TEXT NULL`` — the git sha the runner binary is currently
  serving (its embedded ``QONTINUI_GIT_SHA``, 12-char short sha).
- ``served_git_sha_at TIMESTAMPTZ NULL`` — when coord last recorded the
  served sha (set to ``now()`` on the register write).
- ``served_main_sha TEXT NULL`` — ``origin/main``'s sha as the runner last
  resolved it (drift observability).
- ``served_commits_behind INT NULL`` — how many commits behind main the
  runner's binary is (drift observability).

All four columns are nullable, so existing devices are unaffected and coord
degrades gracefully before any runner has written a served sha (the gate
predicate treats NULL as "unknown / not yet reported"). This alembic
revision is the SOLE author of these columns — coord authors zero
``coord.*`` DDL (enforced by ``coord_schema_authorship.rs``); the old
``ensure_ci_runner_columns``-style Rust self-heal is deprecated and is NOT
replicated here.
"""

from collections.abc import Sequence

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "served_sha_01_devices_columns"
down_revision: str = "failureclass_01_merge_proposals"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add runner served-sha observability columns to coord.devices. Idempotent."""
    op.execute(
        """
        ALTER TABLE coord.devices
            ADD COLUMN IF NOT EXISTS served_git_sha        TEXT        NULL,
            ADD COLUMN IF NOT EXISTS served_git_sha_at     TIMESTAMPTZ NULL,
            ADD COLUMN IF NOT EXISTS served_main_sha       TEXT        NULL,
            ADD COLUMN IF NOT EXISTS served_commits_behind INT         NULL
        """
    )


def downgrade() -> None:
    """Remove runner served-sha observability columns from coord.devices."""
    op.execute(
        """
        ALTER TABLE coord.devices
            DROP COLUMN IF EXISTS served_commits_behind,
            DROP COLUMN IF EXISTS served_main_sha,
            DROP COLUMN IF EXISTS served_git_sha_at,
            DROP COLUMN IF EXISTS served_git_sha
        """
    )
