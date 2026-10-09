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

A later publish with ``reactivate: true`` clears the column and appends the
next version; without it, publishing a retracted slug is refused, so a
retraction is never undone by accident.

Upgrade is additive: one nullable column, no backfill (every existing slug
is live). Downgrade deletes the retracted records first — see
:func:`downgrade`.
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
    """Delete every retracted record, then drop the retraction timestamp.

    Without the column a retracted slug would read as live, so dropping it
    alone would RE-PUBLISH everything an owner had retracted. The retracted
    slugs' snapshots and ownership rows are deleted first instead: losing
    retracted history is recoverable (re-publish from coord), resurrecting a
    public page its owner took down is not.
    """
    op.execute(
        "DELETE FROM web.build_record_snapshots WHERE public_slug IN ("
        "SELECT public_slug FROM web.build_record_public_slugs "
        "WHERE unpublished_at IS NOT NULL)"
    )
    op.execute(
        "DELETE FROM web.build_record_public_slugs WHERE unpublished_at IS NOT NULL"
    )
    op.drop_column("build_record_public_slugs", "unpublished_at", schema="web")
