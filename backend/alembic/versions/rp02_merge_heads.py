"""merge heads: rp01 + strategy_p2_01

Revision ID: rp02_merge_heads
Revises: rp01_add_recording_pipeline_runs, strategy_p2_01_collab_tables
Create Date: 2026-05-18

Joins the two alembic heads present on origin/main after the Phase 4
``recording_pipeline_runs`` migration lands alongside the strategy P2
collab tables. Empty merge revision per
``[[feedback_alembic_sibling_head_merge]]``; ``down_revision`` is a
single-line tuple per
``[[feedback_alembic_merge_revision_single_line_tuple]]``.
"""

from collections.abc import Sequence

revision: str = "rp02_merge_heads"
down_revision: tuple[str, str] = ("rp01_add_recording_pipeline_runs", "strategy_p2_01_collab_tables")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
