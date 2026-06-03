"""merge sibling heads — commit-action + restack effect-signature tables

Revision ID: merge_heads_commit_restack_01
Revises: commit_effect_01_coord_commit_tables, restack_01_coord_restack_signatures
Create Date: 2026-06-03

Empty bookkeeping revision joining the two sibling heads left on ``main``
after two coord effect-signature migrations landed concurrently off the
same parent:

* ``commit_effect_01_coord_commit_tables`` — coord.commit_* tables
  (commit-action plan Phase 0, web #411).
* ``restack_01_coord_restack_signatures`` — coord.restack_signatures +
  restack_verifications (web #408).

Neither PR authored a merge against the other, so ``origin/main`` carried
2 heads and the ``alembic-heads-pr`` gate blocked every subsequent PR.
This revision closes the chain back to a single head.

Per [[feedback_alembic_sibling_head_merge]]: a PR adding an alembic
migration off a then-single head must, when a sibling head exists, author
an empty merge revision joining both heads — otherwise ``alembic-heads-pr``
fails and the canonical-stack migrator container refuses to start. Shape
mirrors ``wave_7_01_merge_heads``.

Nothing happens at upgrade time beyond stamping the new head.
"""

from collections.abc import Sequence

revision: str = "merge_heads_commit_restack_01"
# Single-line tuple is intentional — the `alembic-graph-pr.yml` gate's offline
# parser regex matches `^down_revision: ... = (...)$` on one physical line. A
# multi-line tuple defeats the parser and the gate fails with "N heads" even
# though alembic itself accepts the merge.
# See [[feedback_alembic_merge_revision_single_line_tuple]].
down_revision: tuple[str, str] = ("commit_effect_01_coord_commit_tables", "restack_01_coord_restack_signatures")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
