"""coord.plans.slug — partial UNIQUE index

Revision ID: coord_plans_slug_unique
Revises: coord_sso_rbac
Create Date: 2026-05-20

Promotes the existing non-unique ``idx_plans_slug`` (created in
``coord_plans``) to a partial UNIQUE index. The plan_ingest_worker now
populates ``slug`` for new rows, and coord's ``plan_registry.rs`` relies
on ``ON CONFLICT (slug) DO UPDATE`` semantics — which require a unique
constraint on that column.

The index is partial (``WHERE slug IS NOT NULL``) so legacy rows with
NULL slugs (created before the plan_ingest_worker backfilled them) do
not block the migration. NULL is not considered equal to NULL by SQL
UNIQUE semantics anyway, but the explicit ``WHERE`` makes the intent
clear and lets PostgreSQL skip those rows entirely.

Pre-migration cleanup: for the unusual case where two non-NULL rows
share the same slug, keep one (lowest ``ctid``, i.e. earliest physical
row) and NULL out the rest. This is a one-shot data fix; the
plan_ingest_worker's slug-generation must avoid duplicates going
forward, which is enforced by this new UNIQUE constraint.

Note on CONCURRENTLY: the spec suggested ``CREATE UNIQUE INDEX
CONCURRENTLY`` to avoid blocking writers, but that requires running
outside a transaction (alembic wraps each migration in a tx by default).
``coord.plans`` is small (low-write coord-side registry); a plain
``CREATE UNIQUE INDEX`` inside the transactional migration is faster
and simpler, and the brief lock is acceptable.
"""

from collections.abc import Sequence

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "coord_plans_slug_unique"
down_revision: str = "coord_sso_rbac"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Replace ``idx_plans_slug`` with a partial UNIQUE variant."""
    # Pre-clean: for any duplicate non-NULL slugs, keep the lowest-ctid
    # row and NULL out the rest. PostgreSQL ctid is per-row physical
    # location; lowest ctid is the earliest row in the table page-wise.
    # This is a best-effort recovery for environments where the
    # plan_ingest_worker double-assigned a slug before this constraint
    # landed; canonical-PG is expected to have zero affected rows.
    op.execute(
        """
        UPDATE coord.plans
        SET slug = NULL
        WHERE slug IS NOT NULL
          AND ctid NOT IN (
              SELECT min(ctid)
                FROM coord.plans
               WHERE slug IS NOT NULL
               GROUP BY slug
          )
        """
    )

    # Drop the non-unique slug index from coord_plans.py and replace
    # with the partial UNIQUE form. The unique partial index serves
    # both the lookup and the constraint role.
    op.execute("DROP INDEX IF EXISTS coord.idx_plans_slug")
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_plans_slug
            ON coord.plans(slug) WHERE slug IS NOT NULL
        """
    )


def downgrade() -> None:
    """Revert to the non-unique slug index."""
    op.execute("DROP INDEX IF EXISTS coord.uq_plans_slug")
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_plans_slug
            ON coord.plans(slug) WHERE slug IS NOT NULL
        """
    )
