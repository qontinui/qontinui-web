"""overview.cost_categories: parent_id, so categories can have subcategories

Revision ID: overview_06_cost_category_parent
Revises: overlord_04_runner_start_and_nudge_time
Create Date: 2026-11-14

A category may sit under another ("Computers" > "spaceship"), to any depth, so
the Costs page can show spend per machine and the rollup per heading. The
store (``app.overview.costs``) keeps the tree acyclic and inside one project;
the database holds the two rules it can hold itself:

* ``parent_id`` references ``overview.cost_categories (id)`` ``ON DELETE
  RESTRICT`` — a heading with subcategories cannot vanish under them (the
  store refuses first, with a sentence);
* a category is never its own parent (``ck_overview_cost_categories_not_own_
  parent``). Longer cycles and cross-project parents are the store's to refuse.

Names stay unique per project, ignoring case, across the whole tree
(``uq_overview_cost_categories_name`` is untouched).

Locking. The column is ``ADD COLUMN IF NOT EXISTS``, NULLABLE, no default:
catalog-only. The FK and the CHECK are added ``NOT VALID`` (no scan; enforced
on every write from then on), each only when the table has no constraint of
that name yet so a re-run after a partial upgrade converges, then ``VALIDATE``d
inside ``autocommit_block`` under ``SHARE UPDATE EXCLUSIVE``. The supporting
index is ``CONCURRENTLY IF NOT EXISTS`` in the same block. Every existing row
reads ``parent_id IS NULL``: a top-level category, exactly as before.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "overview_06_cost_category_parent"
down_revision: str | Sequence[str] | None = "overlord_04_runner_start_and_nudge_time"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_FK = "fk_overview_cost_categories_parent"
_CK = "ck_overview_cost_categories_not_own_parent"


def _add_constraint_not_valid(name: str, contype: str, definition: str) -> None:
    """Add constraint ``name`` to ``overview.cost_categories`` NOT VALID,
    unless the table already has one of that name (no ``ADD CONSTRAINT IF NOT
    EXISTS`` in PostgreSQL)."""
    op.execute(
        f"""
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1
                  FROM pg_constraint
                 WHERE conrelid = 'overview.cost_categories'::regclass
                   AND conname = '{name}'
                   AND contype = '{contype}'
            ) THEN
                ALTER TABLE overview.cost_categories
                    ADD CONSTRAINT {name} {definition} NOT VALID;
            END IF;
        END
        $$
        """
    )


def upgrade() -> None:
    # Fail fast rather than queue an ACCESS EXCLUSIVE request in front of every
    # reader and writer; env.py resets it after this revision.
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute(
        "ALTER TABLE overview.cost_categories ADD COLUMN IF NOT EXISTS parent_id uuid"
    )
    _add_constraint_not_valid(
        _FK,
        "f",
        "FOREIGN KEY (parent_id) REFERENCES overview.cost_categories (id) "
        "ON DELETE RESTRICT",
    )
    _add_constraint_not_valid(_CK, "c", "CHECK (parent_id IS NULL OR parent_id <> id)")
    with op.get_context().autocommit_block():
        op.execute(f"ALTER TABLE overview.cost_categories VALIDATE CONSTRAINT {_FK}")
        op.execute(f"ALTER TABLE overview.cost_categories VALIDATE CONSTRAINT {_CK}")
        op.execute(
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS "
            "ix_overview_cost_categories_parent "
            "ON overview.cost_categories (parent_id) WHERE parent_id IS NOT NULL"
        )


def downgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS "
            "overview.ix_overview_cost_categories_parent"
        )
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute(f"ALTER TABLE overview.cost_categories DROP CONSTRAINT IF EXISTS {_CK}")
    op.execute(f"ALTER TABLE overview.cost_categories DROP CONSTRAINT IF EXISTS {_FK}")
    op.execute("ALTER TABLE overview.cost_categories DROP COLUMN IF EXISTS parent_id")
