"""coord.merge_proposals — migrate single-authored Rust column self-heals

Revision ID: coord_singleauthored_09_merge_proposals_columns
Revises: coord_singleauthored_08_work_plans
Create Date: 2026-05-29

Final revision of the allowlist-drain chain. ``coord.merge_proposals`` itself
is alembic-owned (``wave_6_01_coord_merge_batches``); these five columns were
added by two single-authored Rust self-heals:
* ``conflict_ref`` / ``metadata`` — the inline self-heal in
  ``merge_scheduler.rs`` (conflict-pointer columns), and
* ``leased_by`` / ``lease_fenced_token`` / ``leased_at`` —
  ``merge_scheduler.rs::ensure_lease_columns`` (Coord HA Phase B lease state).

Mirrors both byte-for-byte. ``require_table`` already asserts the table at
boot; there is no column-level boot assertion (matching the existing posture),
so the fresh-DB test is the guard that these columns landed.
Collision-safe raw ``ADD COLUMN IF NOT EXISTS``.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "coord_singleauthored_09_merge_proposals_columns"
down_revision: str | Sequence[str] | None = "coord_singleauthored_08_work_plans"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("CREATE SCHEMA IF NOT EXISTS coord")
    op.execute(
        "ALTER TABLE coord.merge_proposals "
        "ADD COLUMN IF NOT EXISTS conflict_ref TEXT"
    )
    op.execute(
        "ALTER TABLE coord.merge_proposals "
        "ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb"
    )
    op.execute(
        "ALTER TABLE coord.merge_proposals "
        "ADD COLUMN IF NOT EXISTS leased_by UUID NULL"
    )
    op.execute(
        "ALTER TABLE coord.merge_proposals "
        "ADD COLUMN IF NOT EXISTS lease_fenced_token BIGINT NULL"
    )
    op.execute(
        "ALTER TABLE coord.merge_proposals "
        "ADD COLUMN IF NOT EXISTS leased_at TIMESTAMPTZ NULL"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE coord.merge_proposals DROP COLUMN IF EXISTS leased_at")
    op.execute("ALTER TABLE coord.merge_proposals DROP COLUMN IF EXISTS lease_fenced_token")
    op.execute("ALTER TABLE coord.merge_proposals DROP COLUMN IF EXISTS leased_by")
    op.execute("ALTER TABLE coord.merge_proposals DROP COLUMN IF EXISTS metadata")
    op.execute("ALTER TABLE coord.merge_proposals DROP COLUMN IF EXISTS conflict_ref")
