"""coord.repo_branches.touched_hunks -- Phase 4 line/hunk conflict prediction

Revision ID: phase4_touched_hunks
Revises: workflow_mirror_2026_05_23
Create Date: 2026-05-23

Substrate Phase 4 (line/hunk conflict prediction + workspace-state surface).
Adds the ``touched_hunks JSONB`` column to ``coord.repo_branches``. The branch
enrichment job (``qontinui-coord/src/enrichment.rs::enrich``) runs a
``git diff -U0 <base>..<head_sha>`` against the repo mirror, parses the
``@@ -a,b +c,d @@`` hunk headers into per-file changed line ranges, and
persists them here in the shape::

    { "<path>": [{"start": N, "count": M}, ...] }

The ``/coord/file-conflicts`` predictor then upgrades from file-glob overlap to
line/hunk overlap: two unmerged branches that touch the SAME file conflict only
if their ``touched_hunks`` for that file actually intersect (disjoint hunks in
the same file are NOT a conflict -- the precision win).

Mirrors the coord-side self-heal at
``qontinui-coord/src/enrichment.rs::ensure_touched_hunks_column`` (and the
lazy column self-heal inside ``enrich``). The Rust service runs an idempotent
``ALTER TABLE ... ADD COLUMN IF NOT EXISTS touched_hunks JSONB`` at boot AND on
each enrichment run; this migration is the authoritative alembic record so a
fresh canonical PG ends up with the same shape without depending on a coord
boot.

## Why raw ``op.execute`` with ``IF NOT EXISTS``

This migration MUST be collision-safe with the coord self-heal: coord may have
already added the column (via ``ensure_touched_hunks_column`` / a lazy
``enrich`` run) before this migration runs. ``ADD COLUMN IF NOT EXISTS`` makes
the two artifacts converge regardless of order. The two **must** stay
equivalent in shape; a change here must be mirrored in
``ensure_touched_hunks_column`` and vice versa.

## Single head

At authoring time the single alembic head is ``workflow_mirror_2026_05_23``
(verified via the revision-graph scan). The Phase 0/1/2/3 substrate sibling
drafts also chain off this same head; that is intentional -- the coordinator
linearizes the substrate chain at land time (re-pointing each sibling's
``down_revision`` so there is exactly one head, the alembic "merge heads"
semantics performed structurally). Per ``feedback_alembic_sibling_head_merge``,
if the siblings land via plain PRs instead, an empty merge-heads revision joins
the heads.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "phase4_touched_hunks"
down_revision: str | Sequence[str] | None = "phase2_conflict_resolutions"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Collision-safe raw SQL -- equivalent in shape to the coord self-heal so
    # the two artifacts converge regardless of run order.
    op.execute("CREATE SCHEMA IF NOT EXISTS coord")
    op.execute(
        "ALTER TABLE coord.repo_branches "
        "ADD COLUMN IF NOT EXISTS touched_hunks JSONB"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE coord.repo_branches DROP COLUMN IF EXISTS touched_hunks")
