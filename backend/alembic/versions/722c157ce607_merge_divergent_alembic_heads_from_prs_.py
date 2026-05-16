"""merge divergent alembic heads from PRs 118 + 123

Revision ID: 722c157ce607
Revises: coord_phase_1b_01_declared_overlap_paths, row_10_item_8_01_spec_check_run_id
Create Date: 2026-05-16 10:44:39.734946

"""
from collections.abc import Sequence

# revision identifiers, used by Alembic.
revision: str = '722c157ce607'
down_revision: str | Sequence[str] | None = ('coord_phase_1b_01_declared_overlap_paths', 'row_10_item_8_01_spec_check_run_id')
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
