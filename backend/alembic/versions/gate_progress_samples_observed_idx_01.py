"""coord.gate_progress_samples — (observed_at) index for the global age-prune

Revision ID: gate_progress_samples_observed_idx_01
Revises: migprov01_migration_provenance
Create Date: 2026-06-16

Adds a single-column ``(observed_at)`` index to ``coord.gate_progress_samples``
(created by ``coord_gate_progress_samples``, which only indexed
``(gate_id, observed_at)``).

The gate sweep now bounds the sample table with a once-per-tick GLOBAL age
delete (``coord::dev_overview::prune_progress_samples`` →
``DELETE FROM coord.gate_progress_samples WHERE observed_at < now() -
<retention>``), replacing the old per-gate prune. That predicate has no
``gate_id`` term, so the existing ``(gate_id, observed_at)`` composite index
does not serve it; this ``(observed_at)`` index keeps the delete from scanning
the whole table.

Deploy order is FREE: the coord delete works (just slower, a seq scan) without
this index, and the index is inert until coord starts issuing the global delete
— so coord and this migration may land in either order.

## House conventions followed

Raw ``op.execute`` with ``CREATE INDEX IF NOT EXISTS`` (collision-safe against a
canonical PG that already carries the index from a self-heal mirror), same as
the sibling ``coord_gate_progress_samples`` revision. Touches only an index on
the pre-existing table — no column/constraint changes, no IMMUTABLE-predicate
hazard.

NOTE: ``revision`` / ``down_revision`` extend the coord head
(``migprov01_migration_provenance``) — at merge time this revision must be
RESERVED via the coord migration head-claim rather than re-derived from a later
``alembic heads``.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "gate_progress_samples_observed_idx_01"
down_revision: str | Sequence[str] | None = "migprov01_migration_provenance"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_gate_progress_samples_observed
            ON coord.gate_progress_samples (observed_at)
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS coord.ix_gate_progress_samples_observed")
