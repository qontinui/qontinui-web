"""Drop retired legacy dry-run boolean columns

Revision ID: dry_run_retire_02_drop_bools
Revises: served_sha_01_devices_columns
Create Date: 2026-07-24

Phase 6 of the dry_run_override audit + legacy-bool retirement plan
(``2026-07-23-dry-run-override-audit-and-retirement``). Drops the two legacy
BOOLEAN columns that the pr-merge rollout resolver no longer reads:

- ``coord.tenant_repo_profiles.dry_run_override``
- ``coord.tenant_merge_settings.dry_run``

Why this is safe
----------------
1. **Backfill landed and verified.** ``dry_run_retire_01_backfill``
   (qontinui-web#849) copied every load-bearing boolean value into the
   equally-or-higher-ranked ``rollout_state`` TEXT tier
   (true → ``'dry_run'``, false → ``'live'``). Verified applied on prod
   2026-07-24: ``tenant_repo_profiles`` reads 30 ``dry_run`` / 13 ``live`` /
   1 ``shadow`` / 0 NULL — the booleans are dead weight on every row.
2. **Zero remaining readers/writers.** qontinui-coord#1203 deletes the
   resolver's legacy boolean tiers (2 and 4), the ``from_legacy_dry_run``
   bridge, and every SQL read/write of both columns; ``profile.dry_run`` is
   now derived from ``rollout_state`` alone.

Deploy-order invariant
----------------------
This migration MUST NOT run until qontinui-coord#1203 is VERIFIED SERVING on
prod ECS (task-def image tag + serving SHA check). A serving coord binary
built before #1203 still SELECTs these columns and would fail every settings
query with ``column does not exist`` the moment they are dropped. The PR
carrying this migration stays DRAFT until that verification.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "dry_run_retire_02_drop_bools"
down_revision: str = "served_sha_01_devices_columns"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Drop both legacy boolean columns.

    ``rollout_state`` (TEXT) on both tables is the single authoritative
    rollout representation from here on.
    """
    op.drop_column("tenant_repo_profiles", "dry_run_override", schema="coord")
    op.drop_column("tenant_merge_settings", "dry_run", schema="coord")


def downgrade() -> None:
    """Re-add both columns as nullable BOOLEAN, without data.

    No data restore is possible or needed: the ``dry_run_retire_01_backfill``
    migration mirrored every non-NULL boolean into ``rollout_state`` before
    this drop, so the booleans carried no information the TEXT tier lacks.
    Post-#1203 coord neither reads nor writes them, so NULL values are
    behaviourally identical to the pre-drop state.
    """
    op.add_column(
        "tenant_repo_profiles",
        sa.Column("dry_run_override", sa.Boolean(), nullable=True),
        schema="coord",
    )
    op.add_column(
        "tenant_merge_settings",
        sa.Column("dry_run", sa.Boolean(), nullable=True),
        schema="coord",
    )
