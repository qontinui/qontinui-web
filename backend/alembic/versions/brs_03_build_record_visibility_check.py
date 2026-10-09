"""web.build_record_public_slugs.last_visibility_check_at — the reconcile cursor.

Revision ID: brs_03_build_record_visibility_check
Revises: brs_02_build_record_unpublish
Create Date: 2026-10-09

Phase 1 of plan ``2026-10-09-factory-built-product-portfolio-and-launch-kit``.

The scheduled build-record reconcile (``app/jobs/build_record_reconcile.py``)
re-asks GitHub, anonymously, whether every repo on each LIVE public page is
still public, and retracts a page whose repo went private. Anonymous GitHub
reads are capped at 60 per hour per egress IP, so each tick checks only a
bounded number of slugs, oldest-checked first. This column is that cursor.

Why a column and not process memory: the backend redeploys more often than
hourly and runs more than one replica. An in-memory cursor would restart from
the same slugs after every deploy and differ per replica, so the tail of the
list could go unchecked indefinitely — the starvation the bound exists to
avoid. A NULL sorts first, so a never-checked slug is checked before any
re-check.

Additive only: one nullable column, no backfill. Hand-authored, never
``--autogenerate``d.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "brs_03_build_record_visibility_check"
down_revision: str | Sequence[str] | None = "brs_02_build_record_unpublish"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the nullable visibility-check cursor."""
    op.add_column(
        "build_record_public_slugs",
        sa.Column(
            "last_visibility_check_at", sa.DateTime(timezone=True), nullable=True
        ),
        schema="web",
    )


def downgrade() -> None:
    """Drop the cursor (the next check order is simply re-derived)."""
    op.drop_column(
        "build_record_public_slugs", "last_visibility_check_at", schema="web"
    )
