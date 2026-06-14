"""coord.plans.ingested_status — plan-ingest worker edge-trigger substrate

Revision ID: coord_plans_ingested_status
Revises: gate_action_02_notificationtype_enum
Create Date: 2026-06-12

Phase 1 of plan
``D:/qontinui-root/dev-notes/plans/2026-06-11-plan-ingest-registry-authority.md``.

``ingested_status`` is the status the plan-ingest worker last derived from
the file — enables edge-triggered status application (coord #564).

Today the worker level-triggers: every 60s tick it re-applies the
file-derived status to ``coord.plans.status``, stomping any direct
registry upsert made within the same tick (file always wins). With this
column the worker can compare the freshly derived status against
``ingested_status`` and only write ``status`` when the FILE changed
(edge trigger), leaving registry-authored transitions alone otherwise.

Backfill sets ``ingested_status = status`` for ALL existing rows so the
worker's first post-deploy comparison sees no spurious edge. Rows the
worker never touches (registry-only plans with no archived file) keep a
frozen ``ingested_status`` — harmless, the worker never reads them.

The column is nullable TEXT (no default): new rows created by direct
registry upserts start with NULL, which the worker treats as
"never ingested" and stamps on first file ingest.
"""

from collections.abc import Sequence

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "coord_plans_ingested_status"
down_revision: str = "gate_action_02_notificationtype_enum"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add ``coord.plans.ingested_status`` + backfill from ``status``. Idempotent."""
    op.execute(
        """
        ALTER TABLE coord.plans
            ADD COLUMN IF NOT EXISTS ingested_status TEXT
        """
    )
    # Backfill every row so the worker's first edge-comparison after the
    # coord Phase 3 deploy is a no-op (no spurious re-application storm).
    op.execute(
        """
        UPDATE coord.plans
        SET ingested_status = status
        WHERE ingested_status IS NULL
        """
    )


def downgrade() -> None:
    """Drop ``coord.plans.ingested_status``."""
    op.execute(
        """
        ALTER TABLE coord.plans
            DROP COLUMN IF EXISTS ingested_status
        """
    )
