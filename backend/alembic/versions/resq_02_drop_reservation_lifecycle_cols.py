"""Drop the dead lifecycle columns from coord.migration_reservations.

The migration reservation queue was demoted to ADVISORY (plan
``2026-06-25-migration-ordering-land-time-repoint``): coord's land-time alembic
re-point engine is the fork-prevention authority now, so an advisory reservation
row carries NO lifecycle. Phase 3 (qontinui-coord) stopped WRITING these columns,
and the paired read-trim (qontinui-coord #798, deployed) stopped READING them, so
they are dead weight — drop them.

Columns dropped (all were nullable, never written, never read after #798):
``pr_number``, ``pr_url``, ``authoring_deadline``, ``bound_at``, ``merged_at``,
``terminated_at``, ``terminal_reason``.

The surviving advisory columns (``id``, ``repo``, ``revision``, ``down_revision``,
``state``, ``requested_by_machine``, ``requested_by_session``, ``tenant_id``,
``created_at``), both indexes (``ux_migration_reservations_repo_revision_live``,
``ix_migration_reservations_repo_active``), and the ``migration_reservations_state_chk``
CHECK are untouched — none reference a dropped column.

Prerequisite (satisfied before this lands): the coord read-trim (#798) is
deployed, so no running coord instance selects these columns; dropping them
cannot error a live read.

Revision ID: resq_02_drop_reservation_lifecycle_cols
Revises: coord_pr_author_nudges_01
Create Date: 2026-06-30
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "resq_02_drop_reservation_lifecycle_cols"
down_revision: str | Sequence[str] | None = "coord_pr_author_nudges_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Drop the seven dead lifecycle columns (the advisory queue carries none)."""
    op.execute(
        """
        ALTER TABLE coord.migration_reservations
            DROP COLUMN IF EXISTS pr_number,
            DROP COLUMN IF EXISTS pr_url,
            DROP COLUMN IF EXISTS authoring_deadline,
            DROP COLUMN IF EXISTS bound_at,
            DROP COLUMN IF EXISTS merged_at,
            DROP COLUMN IF EXISTS terminated_at,
            DROP COLUMN IF EXISTS terminal_reason
        """
    )


def downgrade() -> None:
    """Re-add the columns (nullable, original types) for a clean rollback."""
    op.execute(
        """
        ALTER TABLE coord.migration_reservations
            ADD COLUMN IF NOT EXISTS pr_number          INTEGER NULL,
            ADD COLUMN IF NOT EXISTS pr_url             TEXT NULL,
            ADD COLUMN IF NOT EXISTS authoring_deadline TIMESTAMPTZ NULL,
            ADD COLUMN IF NOT EXISTS bound_at           TIMESTAMPTZ NULL,
            ADD COLUMN IF NOT EXISTS merged_at          TIMESTAMPTZ NULL,
            ADD COLUMN IF NOT EXISTS terminated_at      TIMESTAMPTZ NULL,
            ADD COLUMN IF NOT EXISTS terminal_reason    TEXT NULL
        """
    )
