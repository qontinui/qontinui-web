"""merge 06 — linearize the commit_effect / restack head fork

Revision ID: merge_06_commit_effect_restack_heads
Revises: commit_effect_01_coord_commit_tables, restack_01_coord_restack_signatures
Create Date: 2026-06-03

Pure merge revision (no DDL). ``commit_effect_01_coord_commit_tables`` and
``restack_01_coord_restack_signatures`` landed concurrently off different
ancestors, leaving web main with two alembic heads — the semantic
(non-textual) fork class: distinct filenames merge cleanly in git, so nothing
forced a re-point at land time. ``alembic upgrade head`` is ambiguous (and the
migrate workflow would fail) until the heads are merged. This revision re-joins
the DAG; ``twin_06_coord_route_serving_observations`` chains off it.

Mirrors the dedicated-merge-revision convention (and the exact
``down_revision`` declaration format the alembic-heads-pr / verify-claim
gates parse) of ``twin_merge_05_release_config_ci_heads``.
"""
from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = 'merge_06_commit_effect_restack_heads'
down_revision: Union[str, None] = ('commit_effect_01_coord_commit_tables', 'restack_01_coord_restack_signatures')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
