"""semres 01 coord.repo_branches.touched_alembic_down_revisions — sibling-fork substrate

Revision ID: semres_01_down_revisions
Revises: twin_git_02_coord_git_write_ledger
Create Date: 2026-06-02

Phase 2 of the semantic-resource conflict-prevention plan
(``2026-06-02-coord-semantic-resource-conflict-prevention.md``).

The sibling-fork guard (coord ``claims.rs::check_forking_siblings``) detects two
open PRs that both chain a new alembic migration off the SAME head. The existing
``coord.repo_branches.touched_alembic_revisions`` array holds each branch's CHILD
revision id — the wrong side of the edge to match siblings on. This migration adds
``touched_alembic_down_revisions``: a parallel array of the PARENT head each branch's
migration chains off, populated by the coord ``enrichment`` ``git diff`` pass. The
guard scans this column (``$head = ANY (touched_alembic_down_revisions)``) so two
branches chaining off the same head appear as the same down_revision in two rows —
true siblings.

Merge/base migrations (``down_revision = (X, Y)`` or ``down_revision = None``)
intentionally contribute NO entry — they are not single-head-claimable.

Expand-only: the column is nullable so a rolled-back prior app stays compatible
(expand/contract discipline — the column is added now, never dropped on the code
merge). DDL is emitted ``ADD COLUMN IF NOT EXISTS`` (raw ``op.execute``) so a
re-apply against a partially-migrated DB is a no-op, matching the idempotent posture
of the surrounding coord.* migrations. coord Rust code only reads/writes rows here,
never DDL — this migration is alembic-sole-author for ``coord.*``.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "semres_01_down_revisions"
down_revision: str | Sequence[str] | None = "twin_git_02_coord_git_write_ledger"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # coord schema + repo_branches are created by earlier coord migrations; the
    # ADD COLUMN IF NOT EXISTS makes a re-apply a no-op.
    op.execute(
        "ALTER TABLE coord.repo_branches "
        "ADD COLUMN IF NOT EXISTS touched_alembic_down_revisions TEXT[]"
    )


def downgrade() -> None:
    op.execute(
        "ALTER TABLE coord.repo_branches "
        "DROP COLUMN IF EXISTS touched_alembic_down_revisions"
    )
