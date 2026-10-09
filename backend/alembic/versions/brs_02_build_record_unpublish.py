"""web.build_record_public_slugs.unpublished_at — the D7 one-step unpublish.

Revision ID: brs_02_build_record_unpublish
Revises: brs_01_build_record_snapshots
Create Date: 2026-10-09

Phase 1 of plan ``2026-10-09-factory-built-product-portfolio-and-launch-kit``,
design decision D7: a batch publishes on automated gates, and the operator is
handed a one-step unpublish instead of an approval queue.

Retraction is a property of the public ADDRESS, so it lives on the ownership
row rather than on any snapshot:

* ``unpublished_at`` NULL — the slug is live; the public reader serves its
  latest snapshot.
* ``unpublished_at`` set — retracted; the public reader 404s at once. Every
  snapshot row is KEPT as history, and the owning tenant keeps the slug (a
  retraction never frees it for another tenant to claim).

A later publish clears the column and appends the next version, so
re-activation is the ordinary publish path.

Additive only: one nullable column, no backfill (every existing slug is live).
Hand-authored, never ``--autogenerate``d.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "brs_02_build_record_unpublish"
down_revision: str | Sequence[str] | None = "brs_01_build_record_snapshots"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the nullable retraction timestamp."""
    op.add_column(
        "build_record_public_slugs",
        sa.Column("unpublished_at", sa.DateTime(timezone=True), nullable=True),
        schema="web",
    )


def downgrade() -> None:
    """Drop the retraction timestamp (retracted slugs become live again)."""
    op.drop_column("build_record_public_slugs", "unpublished_at", schema="web")
